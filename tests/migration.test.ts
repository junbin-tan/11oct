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
      .replace('  captured_at INTEGER,\n', '');
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
    migrated.prepare('UPDATE players SET captured_at = 1900, radar_snapshot = ?, radar_at = 2100').run('{"new":true}');
    migrated.close();
    const reopened = openDb(file);
    expect(reopened.prepare('SELECT captured_at, radar_snapshot FROM players').get())
      .toEqual({ captured_at: 1900, radar_snapshot: '{"new":true}' });
    expect(reopened.prepare('SELECT COUNT(*) AS n FROM games').get()).toEqual({ n: 1 });
    reopened.close();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
