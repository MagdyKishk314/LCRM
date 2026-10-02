import { createHash } from 'node:crypto';
import type { Request } from 'express';
import {
  ipKeyGenerator,
  rateLimit,
  type ClientRateLimitInfo,
  type Options,
  type Store,
} from 'express-rate-limit';
import { RateLimitHit } from '../models';

/**
 * Rate limiting for the endpoints that can be reached without a session.
 *
 * Login, refresh, invite lookup and Google sign-in all sit in front of authentication, so
 * nothing else slows a guessing attack down.
 */

/**
 * A fixed-window counter in MongoDB.
 *
 * The library's default store is a Map in this process. That is fine for one server and
 * meaningless on a serverless platform, where ten instances mean ten independent counters.
 *
 * One atomic upsert per request: the `_id` is the key plus the window it falls in, so there
 * is no read-then-write to race, and a closed window is removed by the collection's TTL
 * index rather than by anything that could fail to run.
 */
class MongoStore implements Store {
  private windowMs = 60_000;

  constructor(readonly prefix: string) {}

  init(options: Options): void {
    this.windowMs = options.windowMs;
  }

  private window(key: string) {
    const bucket = Math.floor(Date.now() / this.windowMs);
    return {
      id: `${this.prefix}:${key}:${bucket}`,
      resetTime: new Date((bucket + 1) * this.windowMs),
    };
  }

  async increment(key: string): Promise<ClientRateLimitInfo> {
    const { id, resetTime } = this.window(key);

    const bump = () =>
      RateLimitHit.findOneAndUpdate(
        { _id: id },
        { $inc: { hits: 1 }, $setOnInsert: { expiresAt: resetTime } },
        { upsert: true, new: true },
      ).lean();

    let doc;
    try {
      doc = await bump();
    } catch (err) {
      // Two first requests in a window can both try to insert; the loser retries as an update.
      if ((err as { code?: number }).code !== 11000) throw err;
      doc = await bump();
    }

    return { totalHits: doc?.hits ?? 1, resetTime };
  }

  async decrement(key: string): Promise<void> {
    await RateLimitHit.updateOne({ _id: this.window(key).id }, { $inc: { hits: -1 } });
  }

  async resetKey(key: string): Promise<void> {
    await RateLimitHit.deleteOne({ _id: this.window(key).id });
  }
}

interface LimiterOptions {
  /** Names the counter. Must be unique per limiter — a shared name shares the count. */
  name: string;
  windowMs: number;
  limit: number;
  /** What to count by. Defaults to the caller's address. */
  key?: (req: Request) => string | undefined;
  message: string;
}

function limiter(opts: LimiterOptions) {
  return rateLimit({
    windowMs: opts.windowMs,
    limit: opts.limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    store: new MongoStore(opts.name),
    keyGenerator: (req) => opts.key?.(req) ?? ipKeyGenerator(req.ip ?? 'unknown'),
    // The same envelope every other error uses, so the web app can show the message.
    handler: (_req, res) => {
      res.status(429).json({ error: { code: 'RATE_LIMITED', message: opts.message } });
    },
  });
}

const MINUTE = 60_000;

/** Never put a raw credential in a database key. */
const digest = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 32);

/**
 * Password attempts against one account.
 *
 * Counted by the email being tried, not only by address. The web app calls the API
 * server-to-server, so on some deployments every login arrives from the same IP; and an
 * attacker spreading guesses across many addresses is still guessing at one account. The
 * cost is that someone can lock a colleague out for the window by failing on purpose —
 * accepted, because the alternative is unlimited guesses.
 */
export const loginByEmail = limiter({
  name: 'login-email',
  windowMs: 15 * MINUTE,
  limit: 10,
  key: (req) => {
    const email = (req.body as { email?: unknown } | undefined)?.email;
    return typeof email === 'string' ? digest(email.toLowerCase().trim()) : undefined;
  },
  message: 'Too many sign-in attempts for this account. Try again in 15 minutes.',
});

/** One address trying many different accounts. */
export const loginByIp = limiter({
  name: 'login-ip',
  windowMs: 15 * MINUTE,
  limit: 100,
  message: 'Too many sign-in attempts. Try again in 15 minutes.',
});

/**
 * Refreshes, counted per token.
 *
 * A healthy session refreshes about once every fourteen minutes. Counting by the token
 * rather than the address means one busy office behind a NAT does not share a budget.
 */
export const refreshByToken = limiter({
  name: 'refresh',
  windowMs: MINUTE,
  limit: 30,
  key: (req) => {
    const token =
      (req.cookies as Record<string, string> | undefined)?.lc_refresh ??
      (req.body as { refreshToken?: unknown } | undefined)?.refreshToken;
    return typeof token === 'string' ? digest(token) : undefined;
  },
  message: 'Too many refresh attempts. Please sign in again.',
});

/** Invite lookup and acceptance. The token is unguessable; this bounds the probing anyway. */
export const inviteByIp = limiter({
  name: 'invite',
  windowMs: 15 * MINUTE,
  limit: 60,
  message: 'Too many attempts. Try again in 15 minutes.',
});

/** Google sign-in: each attempt costs a round trip to Google on our credentials. */
export const googleByIp = limiter({
  name: 'google',
  windowMs: 15 * MINUTE,
  limit: 60,
  message: 'Too many sign-in attempts. Try again in 15 minutes.',
});

/** Confirming a sending address by emailed link. */
export const verifyByIp = limiter({
  name: 'verify',
  windowMs: 15 * MINUTE,
  limit: 60,
  message: 'Too many attempts. Try again in 15 minutes.',
});
