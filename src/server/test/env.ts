/**
 * Environment for the test process.
 *
 * Imported before anything else in the harness: `config/env` parses `process.env` the moment
 * it is loaded and exits on a missing secret, so these have to exist first. The database URI
 * is a placeholder — the harness swaps in the in-memory server's address before connecting.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Where the mongod binary lives.
 *
 * It is downloaded the first time the tests run — not during `npm install`, which is why
 * the dependency is `mongodb-memory-server-core`: the full package fetches a few hundred
 * megabytes in a postinstall hook, and that would run in every Docker and Vercel build of
 * the app for the sake of a test dependency.
 *
 * Pinned to the project's `node_modules/.cache` so every working directory shares one copy
 * rather than each starting its own download.
 */
process.env.MONGOMS_DOWNLOAD_DIR ??= path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../node_modules/.cache/mongodb-memory-server',
);

// Next's types declare NODE_ENV read-only; the tests are the one place it is set by hand.
Object.assign(process.env, { NODE_ENV: 'test' });
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/landcaller-test';
process.env.JWT_ACCESS_SECRET = 'test-access-secret-0123456789abcdef';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-0123456789abcdef';
process.env.SMTP_HOST = '';
