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
  // SQLite cannot alter a CHECK constraint. Rebuild only the parent table with
  // foreign keys temporarily disabled, so its children are never cascaded away.
  const gamesSql = (db.prepare("SELECT sql FROM sqlite_master WHERE name = 'games'").get() as { sql: string }).sql;
  if (!gamesSql.includes("'time_up'")) {
    db.pragma('foreign_keys = OFF');
    try {
      db.transaction(() => {
        const definition = schema.slice(0, schema.indexOf(');') + 2)
          .replace('CREATE TABLE IF NOT EXISTS games', 'CREATE TABLE games_timed');
        db.exec(definition);
        db.exec(`INSERT INTO games_timed
          (id, code, status, host_player_id, created_at, started_at, ended_at, end_reason, duration_minutes, ends_at)
          SELECT id, code, status, host_player_id, created_at, started_at, ended_at, end_reason, 30,
            CASE WHEN status = 'active' THEN started_at + 1800000 ELSE NULL END FROM games;
          DROP TABLE games;
          ALTER TABLE games_timed RENAME TO games;`);
        if ((db.pragma('foreign_key_check') as unknown[]).length > 0) throw new Error('Game migration broke foreign keys');
      })();
    } finally {
      db.pragma('foreign_keys = ON');
    }
  }
  db.exec("CREATE INDEX IF NOT EXISTS games_deadline_idx ON games (ends_at) WHERE status = 'active'");
  return db;
}
