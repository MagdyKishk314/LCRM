/**
 * Seed a working LandCaller agency with two sub-accounts, roles and sample data.
 *
 * Idempotent: re-running wipes the seeded tenant and rebuilds it, so it is safe to
 * point at a dev database repeatedly. It refuses to run against production.
 */
import { randomUUID } from 'node:crypto';
import { SYSTEM_ROLES } from '@/shared';
import { env } from './config/env';
import { connectDatabase, disconnectDatabase } from './core/db';
import { runUnscoped } from './core/tenancy/context';
import { buildSearchTokens } from './modules/contacts/search';
import {
  Account,
  Activity,
  Agency,
  Contact,
  ContactList,
  EmailIdentity,
  EmailTemplate,
  Membership,
  Opportunity,
  Pipeline,
  Plan,
  Role,
  User,
  hashPassword,
} from './models';

const AGENCY_SLUG = 'landcaller';

async function seed() {
  if (env.isProd) {
    console.error('Refusing to seed a production database.');
    process.exit(1);
  }

  await connectDatabase();

  const existing = await Agency.findOne({ slug: AGENCY_SLUG });
  if (existing) {
    console.log('[seed] clearing previous seed data…');
    const accounts = await Account.find({ agencyId: String(existing._id) });
    const accountIds = accounts.map((a) => String(a._id));

    await Promise.all([
      Contact.deleteMany({ accountId: { $in: accountIds } }).setOptions({ bypassTenantScope: true }),
      ContactList.deleteMany({ accountId: { $in: accountIds } }).setOptions({ bypassTenantScope: true }),
      Pipeline.deleteMany({ accountId: { $in: accountIds } }).setOptions({ bypassTenantScope: true }),
      Opportunity.deleteMany({ accountId: { $in: accountIds } }).setOptions({ bypassTenantScope: true }),
      Activity.deleteMany({ accountId: { $in: accountIds } }).setOptions({ bypassTenantScope: true }),
      EmailTemplate.deleteMany({ accountId: { $in: accountIds } }).setOptions({ bypassTenantScope: true }),
      EmailIdentity.deleteMany({ accountId: { $in: accountIds } }).setOptions({ bypassTenantScope: true }),
      Account.deleteMany({ agencyId: String(existing._id) }),
      Membership.deleteMany({ agencyId: String(existing._id) }),
      Agency.deleteOne({ _id: existing._id }),
    ]);
  }

  // ── Plan ──────────────────────────────────────────────────────────────────
  const plan = await Plan.findOneAndUpdate(
    { name: 'Agency Pro' },
    {
      name: 'Agency Pro',
      modules: ['core', 'contacts', 'pipelines', 'email', 'telephony', 'campaigns', 'reporting'],
      limits: { accounts: 50, users: 200, contacts: 500_000 },
      pricePerMonth: 497,
    },
    { upsert: true, new: true },
  );

  // ── Roles ─────────────────────────────────────────────────────────────────
  const roles = new Map<string, string>();
  for (const def of SYSTEM_ROLES) {
    const role = await Role.findOneAndUpdate(
      { key: def.key, agencyId: null },
      {
        key: def.key,
        name: def.name,
        description: def.description,
        scope: def.scope,
        permissions: def.permissions,
        isSystem: true,
        agencyId: null,
      },
      { upsert: true, new: true },
    );
    roles.set(def.key, String(role._id));
  }
  console.log(`[seed] ${roles.size} system roles`);

  // ── Agency ────────────────────────────────────────────────────────────────
  const agency = await Agency.create({
    name: 'LandCaller',
    slug: AGENCY_SLUG,
    planId: String(plan._id),
    status: 'active',
    // Matches landcaller.com's brand vermilion.
    branding: { primaryColor: '#E8523A', customDomain: 'crm.landcaller.com' },
    enabledModules: ['core', 'contacts', 'pipelines', 'email', 'telephony', 'campaigns', 'reporting'],
    moduleGrants: [],
    moduleDenies: [],
  });
  const agencyId = String(agency._id);

  // ── Users ─────────────────────────────────────────────────────────────────
  const passwordHash = await hashPassword('LandCaller2026!');

  const owner = await User.findOneAndUpdate(
    { email: 'joe@landcaller.com' },
    {
      email: 'joe@landcaller.com',
      passwordHash,
      firstName: 'Joe',
      lastName: 'Roberts',
      status: 'active',
      mfaEnabled: false,
    },
    { upsert: true, new: true },
  );

  const caller = await User.findOneAndUpdate(
    { email: 'marcus@landcaller.com' },
    {
      email: 'marcus@landcaller.com',
      passwordHash,
      firstName: 'Marcus',
      lastName: 'Ortega',
      status: 'active',
    },
    { upsert: true, new: true },
  );

  // ── Sub-accounts ──────────────────────────────────────────────────────────
  const ridgeline = await Account.create({
    agencyId,
    name: 'Ridgeline Land Co.',
    slug: 'ridgeline',
    status: 'active',
    timezone: 'America/Denver',
    markets: ['Costilla County, CO', 'Apache County, AZ'],
    enabledModules: ['core', 'contacts', 'pipelines', 'email', 'telephony'],
    moduleGrants: [],
    moduleDenies: [],
  });

  // Deliberately narrower, so the module gate is observable straight after seeding:
  // this sub-account has no email module and its /api/v1/email routes return 403.
  const summit = await Account.create({
    agencyId,
    name: 'Summit Parcel Group',
    slug: 'summit',
    status: 'active',
    timezone: 'America/Chicago',
    markets: ['Hudspeth County, TX'],
    enabledModules: ['core', 'contacts', 'pipelines'],
    moduleGrants: [],
    moduleDenies: ['email'],
  });

  // ── Memberships ───────────────────────────────────────────────────────────
  await Membership.create({
    userId: String(owner._id),
    scope: 'agency',
    agencyId,
    roleId: roles.get('agency_owner'),
    permissionOverrides: { grant: [], deny: [] },
    status: 'active',
  });

  await Membership.create({
    userId: String(caller._id),
    scope: 'account',
    agencyId,
    accountId: String(ridgeline._id),
    roleId: roles.get('caller'),
    permissionOverrides: { grant: [], deny: [] },
    status: 'active',
  });

  // ── Tenant data ───────────────────────────────────────────────────────────
  // Seeding writes across two sub-accounts, so it runs unscoped and sets the tenant
  // fields explicitly rather than relying on the request-scoped plugin.
  for (const account of [ridgeline, summit]) {
    const accountId = String(account._id);

    await runUnscoped(
      { userId: String(owner._id), agencyId, accountId, scope: 'agency', permissions: ['*'], enabledModules: [] },
      async () => {
        const stages = [
          { id: randomUUID(), name: 'New lead', order: 0, color: 'info', probability: 10 },
          { id: randomUUID(), name: 'Contact made', order: 1, color: 'info', probability: 25 },
          { id: randomUUID(), name: 'Offer sent', order: 2, color: 'warning', probability: 45 },
          { id: randomUUID(), name: 'Negotiating', order: 3, color: 'warning', probability: 65 },
          { id: randomUUID(), name: 'Under contract', order: 4, color: 'brand', probability: 85 },
          { id: randomUUID(), name: 'Closed', order: 5, color: 'success', probability: 100 },
        ];

        const pipeline = await Pipeline.create({
          agencyId,
          accountId,
          name: 'Land acquisition',
          stages,
          isDefault: true,
        });

        const contacts = await Contact.insertMany(
          buildContacts(agencyId, accountId, account.slug === 'ridgeline' ? 40 : 20).map((c) => ({
            ...c,
            // Set explicitly rather than left to middleware, so seeded contacts are
            // searchable whichever hooks a bulk insert happens to run.
            searchTokens: buildSearchTokens(c),
          })),
        );

        await ContactList.insertMany([
          {
            agencyId,
            accountId,
            name: 'Hot leads',
            description: 'Qualified owners who asked for an offer.',
            type: 'smart',
            filter: { status: ['qualified'] },
          },
          {
            agencyId,
            accountId,
            name: 'Do not call',
            description: 'Scrubbed against DNC and known TCPA litigators. Never dial.',
            type: 'smart',
            filter: { dnc: true },
          },
        ]);

        await Opportunity.insertMany(
          contacts.slice(0, 12).map((c, i) => ({
            agencyId,
            accountId,
            pipelineId: String(pipeline._id),
            stageId: stages[i % stages.length]!.id,
            contactId: String(c._id),
            name: `${c.property?.acres ?? 5} ac — ${c.property?.county} Co, ${c.property?.state}`,
            value: 4_000 + i * 2_300,
            currency: 'USD',
            status: 'open',
            order: i,
          })),
        );

        await EmailIdentity.create({
          agencyId,
          accountId,
          fromName: account.name,
          fromEmail: `offers@${account.slug}.example.com`,
          verified: true,
          isDefault: true,
        });

        await EmailTemplate.create({
          agencyId,
          accountId,
          name: 'Cash offer follow-up',
          subject: 'Your {{contact.property.acres}} acres in {{contact.property.county}} County',
          body:
            'Hi {{contact.firstName}},\n\nThanks for taking my call. We can close on your ' +
            '{{contact.property.acres}}-acre parcel (APN {{contact.property.apn}}) in cash, as-is.\n\n' +
            'Our offer is attached and stands for 14 days.\n\n— {{user.firstName}}',
          mergeFields: [
            'contact.firstName',
            'contact.property.acres',
            'contact.property.county',
            'contact.property.apn',
            'user.firstName',
          ],
          category: 'Offers',
        });

        console.log(`[seed] ${account.name}: ${contacts.length} contacts, 12 opportunities`);
      },
    );
  }

  console.log('\n[seed] done.');
  console.log('  Agency owner : joe@landcaller.com / LandCaller2026!');
  console.log('  Caller seat  : marcus@landcaller.com / LandCaller2026!');
  console.log(`  Sub-accounts : ${ridgeline._id} (all modules), ${summit._id} (email disabled)`);

  await disconnectDatabase();
}

const FIRST = ['Wayne', 'Doris', 'Hector', 'Marlene', 'Curtis', 'Yolanda', 'Stan', 'Ruth', 'Odell', 'Bernice'];
const LAST = ['Kowalski', 'Bautista', 'Nakamura', 'Whitfield', 'Ortega', 'Lindqvist', 'Abernathy', 'Okafor'];
const COUNTIES: [string, string][] = [
  ['Costilla', 'CO'],
  ['Apache', 'AZ'],
  ['Hudspeth', 'TX'],
  ['Mohave', 'AZ'],
  ['Luna', 'NM'],
];
const STATUSES = ['new', 'contacted', 'qualified', 'unqualified', 'do_not_call'] as const;

function buildContacts(agencyId: string, accountId: string, count: number) {
  return Array.from({ length: count }, (_, i) => {
    const firstName = FIRST[i % FIRST.length]!;
    const lastName = LAST[i % LAST.length]!;
    const [county, state] = COUNTIES[i % COUNTIES.length]!;
    const status = STATUSES[i % STATUSES.length]!;

    return {
      agencyId,
      accountId,
      firstName,
      lastName,
      email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}${i}@example.com`,
      phone: `(${300 + (i % 600)}) ${200 + (i % 700)}-${String(1000 + i).padStart(4, '0')}`,
      status,
      source: 'Skip trace list',
      tags: i % 3 === 0 ? ['callback'] : i % 5 === 0 ? ['motivated'] : [],
      address: { city: 'Denver', state, postalCode: '80211', country: 'US' },
      property: {
        apn: `${100 + i}-${20 + (i % 60)}-${String(100 + i).padStart(3, '0')}`,
        county,
        state,
        acres: Math.round((1 + (i % 40) * 1.3) * 100) / 100,
        assessedValue: 3_000 + i * 450,
      },
      customFields: {},
      dnc: status === 'do_not_call',
      lastActivityAt: new Date(),
      sourceSystem: 'import' as const,
    };
  });
}

seed().catch((err) => {
  console.error('[seed] failed:', err);
  process.exit(1);
});
