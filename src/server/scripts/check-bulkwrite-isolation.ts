/**
 * Prove that `bulkWrite` cannot cross a tenant boundary.
 *
 * The tenancy plugin rewrites every operation in a bulkWrite before it reaches the driver:
 * inserts get stamped, filters get narrowed. That rewrite is the isolation boundary for the
 * one call that skips every other hook, so it is checked against a real database rather than
 * reasoned about — a mistake here is a silent cross-tenant write, not an error.
 *
 *   npm run check:bulkwrite
 */
import mongoose from 'mongoose';
import { env } from '../config/env';
import { Account, Contact } from '../models';
import { runInTenantContext, type TenantContext } from '../core/tenancy/context';

let failures = 0;

function check(label: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

/**
 * The tenant fields are added by the plugin at runtime via `schema.add()`, so the inferred
 * schema type does not carry them. This is the shape the check actually reads.
 */
type TenantedContact = { _id: unknown; agencyId: string; accountId: string; company?: string };

/** Read a contact ignoring tenant scoping, to observe what was really written. */
function readRaw(filter: Record<string, unknown>) {
  return Contact.findOne(filter)
    .setOptions({ bypassTenantScope: true })
    .lean<TenantedContact | null>();
}

function contextFor(agencyId: string, accountId?: string): TenantContext {
  return {
    userId: 'isolation-check',
    agencyId,
    accountId,
    scope: accountId ? 'account' : 'agency',
    permissions: [],
    enabledModules: [],
  };
}

async function main() {
  await mongoose.connect(env.MONGODB_URI);

  const accounts = await Account.find().limit(2);
  if (accounts.length < 2) throw new Error('Need two sub-accounts to test isolation');

  const [a, b] = accounts;
  const agencyId = String(a!.agencyId);
  const A = contextFor(agencyId, String(a!._id));
  const B = contextFor(agencyId, String(b!._id));
  const salt = `bulkcheck-${Date.now().toString(36)}`;

  // 1. An insert through bulkWrite is stamped with the caller's tenant.
  await runInTenantContext(A, async () => {
    await Contact.bulkWrite([
      { insertOne: { document: { firstName: 'Iso', lastName: salt, sourceId: `${salt}-A` } } },
    ]);
  });

  const inserted = await readRaw({ sourceId: `${salt}-A` });
  check('bulkWrite insert is stamped with the tenant', inserted?.accountId === String(a!._id),
    `accountId ${inserted?.accountId}`);
  check('bulkWrite insert is stamped with the agency', inserted?.agencyId === agencyId);

  // 2. Account B cannot see it.
  const fromB = await runInTenantContext(B, async () => Contact.findOne({ sourceId: `${salt}-A` }));
  check('the other sub-account cannot read it', fromB === null);

  // 3. Account B cannot update it, even naming it by _id.
  await runInTenantContext(B, async () => {
    await Contact.bulkWrite([
      { updateOne: { filter: { _id: inserted!._id }, update: { $set: { company: 'STOLEN' } } } },
    ]);
  });
  const afterCross = await readRaw({ _id: inserted!._id });
  check('a cross-tenant bulkWrite update writes nothing', afterCross?.company !== 'STOLEN',
    `company ${afterCross?.company ?? '(unset)'}`);

  // 4. The owner can update it.
  await runInTenantContext(A, async () => {
    await Contact.bulkWrite([
      { updateOne: { filter: { _id: inserted!._id }, update: { $set: { company: 'OWNED' } } } },
    ]);
  });
  const afterOwn = await readRaw({ _id: inserted!._id });
  check('the owning sub-account can update it', afterOwn?.company === 'OWNED',
    `company ${afterOwn?.company}`);

  // 5. A filter that would match everything is still narrowed to the caller.
  await runInTenantContext(B, async () => {
    await Contact.bulkWrite([
      { updateMany: { filter: {}, update: { $set: { company: 'MASS' } } } },
    ]);
  });
  const afterMass = await readRaw({ _id: inserted!._id });
  check('an empty filter does not reach another tenant', afterMass?.company === 'OWNED',
    `company ${afterMass?.company}`);

  // 6. No context at all is refused rather than run unscoped.
  let threw = false;
  try {
    await Contact.bulkWrite([
      { updateMany: { filter: {}, update: { $set: { company: 'NOCTX' } } } },
    ]);
  } catch {
    threw = true;
  }
  check('bulkWrite without a tenant context throws', threw);

  // 7. An account-scoped model cannot be bulk-written from an agency-scoped request.
  let agencyThrew = false;
  try {
    await runInTenantContext(contextFor(agencyId), async () =>
      Contact.bulkWrite([{ insertOne: { document: { firstName: 'No', lastName: salt } } }]),
    );
  } catch {
    agencyThrew = true;
  }
  check('an agency-scoped request cannot bulk-insert into an account', agencyThrew);

  await Contact.deleteMany({ lastName: salt }).setOptions({ bypassTenantScope: true });
  console.log(`\n${failures === 0 ? 'isolation holds' : failures + ' FAILED'}`);
  if (failures > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
