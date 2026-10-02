import mongoose from 'mongoose';
import { env } from '../config/env';

/**
 * One connection per Mongoose instance — and one Mongoose instance at a time.
 *
 * In development the web app recompiles the API whenever a file under `apps/api` changes,
 * and the recompiled module graph carries its own copy of Mongoose with no connection.
 * Models bound to that copy buffer every query until it times out, ten seconds later, and
 * the symptom is an API that answered a moment ago and now hangs. So:
 *
 *   - the connection belongs to the Mongoose instance that opened it, and
 *     `connectDatabase()` returns at once when this instance is already connected —
 *     which makes it safe to call on every request;
 *   - when a new instance appears, the previous one's connection is closed, so a long
 *     editing session does not leave a pool open per save.
 *
 * In production there is one instance for the life of the process, and both rules are
 * no-ops.
 */
const slot = globalThis as { __landcallerMongoose?: typeof mongoose };
if (slot.__landcallerMongoose && slot.__landcallerMongoose !== mongoose) {
  void slot.__landcallerMongoose.disconnect().catch(() => undefined);
}
slot.__landcallerMongoose = mongoose;

/** Shared by concurrent callers, so a burst of cold requests opens one pool, not several. */
let connecting: Promise<void> | undefined;

export function connectDatabase(): Promise<void> {
  if (mongoose.connection.readyState === 1) return Promise.resolve();

  connecting ??= openConnection().catch((err) => {
    // A failed attempt must not stay cached as resolved, or every later call on this
    // instance would run against a dead client.
    connecting = undefined;
    throw err;
  });
  return connecting;
}

async function openConnection(): Promise<void> {
  mongoose.set('strictQuery', true);

  // `id` is exposed instead of `_id`/`__v` so API responses match the shared entity
  // types the frontend is written against.
  mongoose.set('toJSON', {
    virtuals: true,
    versionKey: false,
    transform: (_doc, ret: Record<string, unknown>) => {
      // Only rewrite when there is an `_id` to rewrite. Subdocuments declared with
      // `{ _id: false }` carry their own string `id` — pipeline stages do, and every
      // opportunity references it — so an unconditional assignment overwrote a real
      // identifier with `undefined` and silently detached every card from its stage.
      if (ret._id !== undefined) {
        ret.id = ret._id;
        delete ret._id;
      }
      return ret;
    },
  });

  // The database is MongoDB Atlas, so every query crosses a network. These defaults are
  // tuned for that rather than for a local socket: a longer selection timeout absorbs
  // Atlas failovers and free-tier cold starts, and the pool is capped so a burst of
  // requests cannot exhaust the cluster's connection limit.
  mongoose.connection.on('disconnected', () => {
    console.warn('[db] disconnected from Atlas — the driver will retry');
  });
  mongoose.connection.on('reconnected', () => {
    console.log('[db] reconnected to Atlas');
  });

  /**
   * Pool size depends on how many processes there are.
   *
   * One long-lived server can afford a real pool. On a serverless platform there may be
   * dozens of instances at once, each with its own pool, so the same numbers multiply into
   * Atlas's connection cap — the usual way a Mongoose app dies under load there. A small
   * pool and no minimum keeps a cold instance cheap.
   */
  const serverless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

  try {
    await mongoose.connect(env.MONGODB_URI, {
      serverSelectionTimeoutMS: 15_000,
      maxPoolSize: serverless ? 5 : 20,
      minPoolSize: serverless ? 0 : 2,
      retryWrites: true,
    });
  } catch (err) {
    // The driver's own error here is a wall of topology JSON. With Atlas the cause is
    // almost always one of three things, so name them in the order worth checking.
    console.error(`\n[db] could not reach MongoDB at ${redact(env.MONGODB_URI)}\n`);
    console.error('  With MongoDB Atlas, check in this order:');
    console.error("    1. Is this machine's IP on the cluster's Network Access list?");
    console.error('    2. Are the database user and password correct, and the password');
    console.error('       URL-encoded if it contains @ : / ? # [ ] or % ?');
    console.error('    3. Is the cluster running? A paused free-tier cluster refuses');
    console.error('       every connection until it is resumed.\n');
    // Thrown rather than exiting: the standalone server exits on it, but inside the web
    // app's dev server a failed connection should fail the request, not the whole server.
    throw err;
  }

  console.log(`[db] connected to ${redact(env.MONGODB_URI)}`);
}

export async function disconnectDatabase(): Promise<void> {
  connecting = undefined;
  await mongoose.disconnect();
}

/** Strip the password from a connection string before it reaches a log. */
function redact(uri: string): string {
  return uri.replace(/\/\/([^:]+):([^@]+)@/, '//$1:***@');
}
