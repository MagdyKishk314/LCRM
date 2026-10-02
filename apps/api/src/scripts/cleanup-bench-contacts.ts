/** Remove contacts left behind by import benchmarking. Matches only synthetic markers. */
import mongoose from 'mongoose';
import { env } from '../config/env';
import { Contact } from '../models';

async function main() {
  await mongoose.connect(env.MONGODB_URI);
  const bypass = { bypassTenantScope: true };

  const byEmail = await Contact.deleteMany({ email: /@landcaller\.test$/i }).setOptions(bypass);
  const bySource = await Contact.deleteMany({ sourceId: /^(PARCEL|BENCH)-/ }).setOptions(bypass);
  const byPhone = await Contact.deleteMany({ phone: /^\+1(720500|888100)/ }).setOptions(bypass);

  console.log(
    `removed  by email ${byEmail.deletedCount}  by sourceId ${bySource.deletedCount}  by phone ${byPhone.deletedCount}`,
  );
  console.log(`contacts remaining: ${await Contact.countDocuments({}).setOptions(bypass)}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => mongoose.disconnect());
