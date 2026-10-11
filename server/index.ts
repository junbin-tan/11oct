import path from 'node:path';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { openDb } from './db.js';

const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;

const config = loadConfig();
const db = openDb(path.join(config.dataDir, 'game.sqlite'));
const { app, service } = await buildApp({ db, config, logger: true });

const runCleanup = () => {
  try {
    const { deletedGames } = service.cleanup();
    if (deletedGames > 0) app.log.info({ deletedGames }, 'pruned expired games');
  } catch (error) {
    app.log.error(error, 'cleanup failed');
  }
};
runCleanup();
setInterval(runCleanup, CLEANUP_INTERVAL_MS).unref();

const shutdown = async () => {
  await app.close();
  db.close();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

await app.listen({ port: config.port, host: config.host });
app.log.info(`database: ${path.join(config.dataDir, 'game.sqlite')}`);
