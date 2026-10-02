/**
 * Clear recorded import usage, releasing the hourly quota.
 *
 * Verification spends real quota; without this a sub-account stays throttled for an hour
 * after a test run. Usage rows expire on their own via TTL — this is only for the impatient.
 */
import mongoose from 'mongoose';
import { env } from '../config/env';
import { UsageEvent } from '../models';

async function main() {
  await mongoose.connect(env.MONGODB_URI);
  const cleared = await UsageEvent.deleteMany({ kind: 'import' }).setOptions({
    bypassTenantScope: true,
  });
  console.log(`cleared ${cleared.deletedCount} import usage record(s)`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => mongoose.disconnect());
