/**
 * A MongoDB server on this machine, for development.
 *
 *   npm run db:local
 *
 * Atlas is the right database to deploy against, but from a developer's desk every query
 * crosses the internet — a hundred-odd milliseconds each way, and far more on a lossy link —
 * and a page that asks five things in a row takes seconds. Served from this machine the
 * same queries take a millisecond.
 *
 * No install and no Docker: this starts the same `mongod` binary the tests download, with
 * its data kept in `.mongo-data/` (gitignored) so it survives restarts. Point `MONGODB_URI`
 * at the address it prints, and run `npm run db:copy` once to bring your Atlas data over.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

process.env.MONGOMS_DOWNLOAD_DIR ??= path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../node_modules/.cache/mongodb-memory-server',
);

const PORT = Number(process.env.LOCAL_MONGO_PORT ?? 27017);
const DB_PATH = path.resolve(process.cwd(), '.mongo-data');

async function main() {
  const { MongoMemoryServer } = await import('mongodb-memory-server-core');

  fs.mkdirSync(DB_PATH, { recursive: true });

  const server = await MongoMemoryServer.create({
    instance: { port: PORT, dbPath: DB_PATH, storageEngine: 'wiredTiger' },
  });

  console.log(`\n  MongoDB is running at mongodb://127.0.0.1:${PORT}`);
  console.log(`  data: ${DB_PATH}`);
  console.log(`\n  .env:  MONGODB_URI=mongodb://127.0.0.1:${PORT}/landcaller`);
  console.log('\n  Press Ctrl+C to stop.\n');

  const stop = async () => {
    // The data directory is ours, not a temp dir, so `stop` leaves it in place.
    await server.stop();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
