/**
 * Copy every collection from one database to another.
 *
 *   npm run db:copy -- --from "<atlas uri>/landcaller" --to mongodb://127.0.0.1:27017/landcaller
 *
 * For bringing a deployment's data to a local server (see `local-mongo.ts`): the source is
 * only read, and each target collection is replaced wholesale, so running it again simply
 * refreshes the copy. Indexes are not copied — run `npm run sync-indexes` against the
 * target afterwards; it builds them from the schemas.
 *
 * `--to` must name a different server or database from `--from`, and the target must not
 * be an Atlas address unless `--allow-remote-target` is given: this exists to pull data
 * down, not to overwrite production by a slip of the hand.
 */
import mongoose from 'mongoose';

// The driver is reached through Mongoose rather than depended on directly.
const { MongoClient } = mongoose.mongo;

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i]!;
  if (!arg.startsWith('--')) continue;
  const next = process.argv[i + 1];
  if (next && !next.startsWith('--')) {
    args.set(arg.slice(2), next);
    i++;
  } else {
    args.set(arg.slice(2), 'true');
  }
}

const BATCH = 1_000;

async function main() {
  const from = args.get('from') ?? process.env.MONGODB_URI;
  const to = args.get('to');
  if (!from || !to) {
    console.error('usage: npm run db:copy -- --from <source uri> --to <target uri>');
    process.exit(1);
  }
  if (from === to) {
    console.error('--from and --to are the same database.');
    process.exit(1);
  }
  if (/mongodb\.net/i.test(to) && !args.has('allow-remote-target')) {
    console.error('--to looks like an Atlas cluster. Pass --allow-remote-target if you mean it.');
    process.exit(1);
  }

  const source = await MongoClient.connect(from);
  const target = await MongoClient.connect(to);
  const sourceDb = source.db();
  const targetDb = target.db();

  if (sourceDb.databaseName === 'test' || !sourceDb.databaseName) {
    console.error(`--from has no database name (connected to '${sourceDb.databaseName}').`);
    process.exit(1);
  }

  const collections = (await sourceDb.listCollections({}, { nameOnly: true }).toArray())
    .map((c) => c.name)
    .filter((name) => !name.startsWith('system.'))
    .sort();

  console.log(`Copying ${collections.length} collections: ${sourceDb.databaseName} → ${to.replace(/\/\/[^@]+@/, '//***@')}\n`);

  for (const name of collections) {
    const docs = sourceDb.collection(name).find();
    const targetCollection = targetDb.collection(name);
    await targetCollection.deleteMany({});

    let batch: Record<string, unknown>[] = [];
    let copied = 0;
    for await (const doc of docs) {
      batch.push(doc);
      if (batch.length >= BATCH) {
        await targetCollection.insertMany(batch);
        copied += batch.length;
        batch = [];
      }
    }
    if (batch.length > 0) {
      await targetCollection.insertMany(batch);
      copied += batch.length;
    }
    console.log(`  ${name.padEnd(24)} ${copied}`);
  }

  await source.close();
  await target.close();
  console.log('\nDone. Now run: npm run sync-indexes');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
