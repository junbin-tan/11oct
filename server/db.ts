import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export type Db = Database.Database;

const schema = fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');

export function openDb(file: string): Db {
  if (file !== ':memory:') {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.exec(schema);
  // CREATE TABLE IF NOT EXISTS does not upgrade an existing installation.
  db.transaction(() => {
    const columns = db.pragma('table_info(players)') as Array<{ name: string }>;
    if (!columns.some((column) => column.name === 'left_at')) {
      db.exec('ALTER TABLE players ADD COLUMN left_at INTEGER');
    }
    const gameColumns = db.pragma('table_info(games)') as Array<{ name: string }>;
    if (!gameColumns.some((column) => column.name === 'end_reason')) {
      db.exec("ALTER TABLE games ADD COLUMN end_reason TEXT CHECK (end_reason IN ('host_left', 'players_left'))");
    }
    if (!columns.some((column) => column.name === 'captured_at')) {
      db.exec('ALTER TABLE players ADD COLUMN captured_at INTEGER');
      // Old samples only have receipt times; leave capture time explicitly unknown.
      db.exec('UPDATE players SET radar_snapshot = NULL, radar_at = NULL');
    }
  })();
  return db;
}
