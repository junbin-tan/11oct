import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { expect, it } from 'vitest';
import { openDb } from '../server/db';

it('upgrades an existing database, invalidates old radar, and is idempotent', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gps-migration-'));
  const file = path.join(dir, 'old.sqlite');
  try {
    const old = new Database(file);
    const schema = fs.readFileSync(new URL('../server/schema.sql', import.meta.url), 'utf8')
      .replace('  captured_at INTEGER,\n', '')
      .replace('  left_at INTEGER,\n', '')
      .replace(/  ended_at INTEGER,\n  end_reason TEXT[^;]+?  ends_at INTEGER/, '  ended_at INTEGER');
    old.exec(schema);
    old.prepare('INSERT INTO games (id, code, created_at) VALUES (?, ?, ?)').run('g', 'ABCDEF', 1000);
    old.prepare(`INSERT INTO players
      (id, game_id, display_name, role, joined_at, tag_token, tag_code, latitude, longitude, location_at, radar_snapshot, radar_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run('p', 'g', 'Ada', 'catcher', 1000, 'secret', 'TAG123', 1.3, 103.8, 2000, '{"old":true}', 2000);
    old.close();
    const migrated = openDb(file);
    expect(migrated.prepare('SELECT captured_at, location_at, latitude, radar_snapshot, radar_at FROM players').get())
      .toEqual({ captured_at: null, location_at: 2000, latitude: 1.3, radar_snapshot: null, radar_at: null });
    expect(migrated.prepare('SELECT left_at FROM players').get()).toEqual({ left_at: null });
    expect(migrated.prepare('SELECT end_reason FROM games').get()).toEqual({ end_reason: null });
    migrated.prepare('UPDATE players SET left_at = 2500').run();
    migrated.prepare("UPDATE games SET end_reason = 'host_left'").run();
    migrated.prepare('UPDATE players SET captured_at = 1900, radar_snapshot = ?, radar_at = 2100').run('{"new":true}');
    migrated.close();
    const reopened = openDb(file);
    expect(reopened.prepare('SELECT captured_at, radar_snapshot FROM players').get())
      .toEqual({ captured_at: 1900, radar_snapshot: '{"new":true}' });
    expect(reopened.prepare('SELECT left_at FROM players').get()).toEqual({ left_at: 2500 });
    expect(reopened.prepare('SELECT end_reason FROM games').get()).toEqual({ end_reason: 'host_left' });
    expect(reopened.prepare('SELECT COUNT(*) AS n FROM games').get()).toEqual({ n: 1 });
    reopened.close();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});


it('migrates timed rounds without losing child rows or altering finished results', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gps-timer-migration-'));
  const file = path.join(dir, 'old.sqlite');
  try {
    const old = new Database(file);
    old.pragma('foreign_keys = ON');
    const legacySchema = fs.readFileSync(new URL('../server/schema.sql', import.meta.url), 'utf8')
      .replace(/  end_reason TEXT[^;]+?  ends_at INTEGER/, "  end_reason TEXT CHECK (end_reason IN ('host_left', 'players_left'))");
    old.exec(legacySchema);
    old.exec(`INSERT INTO games (id, code, status, created_at, started_at, ended_at, end_reason) VALUES
      ('waiting', 'WAIT01', 'waiting', 1000, NULL, NULL, NULL),
      ('active', 'PLAY01', 'active', 1000, 2000, NULL, NULL),
      ('ended', 'DONE01', 'ended', 1000, 2000, 3000, 'host_left');
      INSERT INTO players (id, game_id, display_name, role, joined_at, tag_token, tag_code) VALUES
      ('a', 'active', 'Alice', 'catcher', 1000, 'secret-a', 'TAG001'),
      ('b', 'active', 'Bob', 'catcher', 1000, 'secret-b', 'TAG002');
      INSERT INTO tag_events VALUES ('tag', 'active', 'a', 'b', 2500);`);
    old.close();
    const migrated = openDb(file);
    expect(migrated.prepare('SELECT duration_minutes, ends_at FROM games WHERE id = ?').get('waiting'))
      .toEqual({ duration_minutes: 30, ends_at: null });
    expect(migrated.prepare('SELECT duration_minutes, ends_at FROM games WHERE id = ?').get('active'))
      .toEqual({ duration_minutes: 30, ends_at: 1802000 });
    expect(migrated.prepare('SELECT status, ended_at, end_reason, ends_at FROM games WHERE id = ?').get('ended'))
      .toEqual({ status: 'ended', ended_at: 3000, end_reason: 'host_left', ends_at: null });
    expect(migrated.prepare('SELECT COUNT(*) AS n FROM players').get()).toEqual({ n: 2 });
    expect(migrated.prepare('SELECT * FROM tag_events').get())
      .toEqual({ id: 'tag', game_id: 'active', catcher_player_id: 'a', tagged_player_id: 'b', created_at: 2500 });
    expect(migrated.pragma('foreign_key_check')).toEqual([]);
    expect(migrated.pragma('foreign_keys', { simple: true })).toBe(1);
    migrated.exec("UPDATE games SET duration_minutes = 90, ends_at = 5402000, end_reason = 'time_up' WHERE id = 'active'");
    migrated.close();
    const reopened = openDb(file);
    expect(reopened.prepare('SELECT duration_minutes, ends_at, end_reason FROM games WHERE id = ?').get('active'))
      .toEqual({ duration_minutes: 90, ends_at: 5402000, end_reason: 'time_up' });
    expect(reopened.pragma('foreign_key_check')).toEqual([]);
    reopened.exec("DELETE FROM games WHERE id = 'active'");
    expect(reopened.prepare('SELECT COUNT(*) AS n FROM players').get()).toEqual({ n: 0 });
    expect(reopened.prepare('SELECT COUNT(*) AS n FROM tag_events').get()).toEqual({ n: 0 });
    reopened.close();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
