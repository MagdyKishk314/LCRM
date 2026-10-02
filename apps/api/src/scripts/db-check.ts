/**
 * Verify the configured MongoDB connection.
 *
 * Useful on a fresh VPS or after rotating Atlas credentials: it separates "the app is
 * broken" from "the database is unreachable", and reports which of the usual Atlas
 * causes applies rather than leaving you to read driver topology output.
 *
 *   pnpm --filter @landcaller/api db:check
 */
import mongoose from 'mongoose';
import { env } from '../config/env';

function redact(uri: string): string {
  return uri.replace(/\/\/([^:]+):([^@]+)@/, '//$1:***@');
}

async function main() {
  console.log(`[db:check] ${redact(env.MONGODB_URI)}\n`);

  const started = Date.now();
  await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 20_000 });
  const elapsed = Date.now() - started;

  const db = mongoose.connection.db!;
  const collections = await db.listCollections().toArray();

  console.log(`  connected   ${elapsed}ms`);
  console.log(`  host        ${mongoose.connection.host}`);
  console.log(`  database    ${mongoose.connection.name}`);

  // A missing database name is the single most common misconfiguration: the driver
  // silently uses `test`, and the app comes up looking like every record vanished.
  if (mongoose.connection.name === 'test') {
    console.warn(
      '\n  WARNING: connected to the default `test` database. The connection string is\n' +
        '  missing its /<database> path segment — add /landcaller before the ? in MONGODB_URI.',
    );
  }

  if (collections.length === 0) {
    console.log('  collections (none — run `pnpm seed`)');
  } else {
    console.log(`  collections ${collections.length}`);
    for (const c of collections.map((c) => c.name).sort()) {
      const n = await db.collection(c).countDocuments();
      console.log(`    ${c.padEnd(18)} ${n}`);
    }
  }

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(`\n[db:check] FAILED: ${err instanceof Error ? err.message.split('\n')[0] : err}\n`);
  console.error('  With Atlas, check in this order:');
  console.error("    1. Is this machine's IP on the cluster's Network Access list?");
  console.error('    2. Are the user and password correct, and URL-encoded if they');
  console.error('       contain @ : / ? # [ ] or % ?');
  console.error('    3. Is the cluster running, or is a free-tier cluster paused?');
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
