/**
 * Bring every collection's indexes in line with its schema. Safe to re-run.
 *
 * `syncIndexes` drops indexes the schema no longer declares as well as building new ones,
 * which is what retires the old sparse membership index and the untenanted contact text
 * index. Building an index on a large collection takes a while and is done in the
 * background by the server; this waits for each.
 */
import mongoose from 'mongoose';
import { env } from '../config/env';
import '../models';

async function main() {
  await mongoose.connect(env.MONGODB_URI);

  for (const [name, model] of Object.entries(mongoose.models)) {
    const dropped = await model.syncIndexes();
    console.log(`${name}: synced${dropped.length ? ` — dropped ${dropped.join(', ')}` : ''}`);
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => mongoose.disconnect());
