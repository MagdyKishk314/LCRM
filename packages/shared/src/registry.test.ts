import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildNavigation,
  dependentsOf,
  resolveModules,
  resolvePermissions,
  validateModuleSet,
  withDependencies,
} from './modules/registry';
import { hasPermission, permissionMatches } from './permissions';

const PRO_PLAN = ['core', 'contacts', 'pipelines', 'email', 'telephony'] as const;

test('permission wildcards match at each segment', () => {
  assert.equal(permissionMatches('*', 'contacts:contact:read'), true);
  assert.equal(permissionMatches('contacts:*:*', 'contacts:contact:read'), true);
  assert.equal(permissionMatches('contacts:*:read', 'contacts:contact:read'), true);
  assert.equal(permissionMatches('contacts:*:read', 'contacts:contact:delete'), false);
  assert.equal(permissionMatches('contacts:contact:read', 'pipelines:contact:read'), false);
  // A wildcard must not match across a differing segment count.
  assert.equal(permissionMatches('contacts:*', 'contacts:contact:read'), false);
});

test('deny beats a wildcard grant from the role', () => {
  const effective = resolvePermissions({
    rolePermissions: ['contacts:*:*'],
    deny: ['contacts:contact:export'],
  });

  // The wildcard is expanded to concrete permissions, so everything it covered
  // survives except the one capability that was explicitly denied.
  assert.equal(hasPermission(effective, 'contacts:contact:read'), true);
  assert.equal(hasPermission(effective, 'contacts:contact:delete'), true);
  assert.equal(hasPermission(effective, 'contacts:contact:export'), false);
});

test('a sub-account cannot exceed its agency ceiling', () => {
  const effective = resolveModules({
    planModules: [...PRO_PLAN],
    agency: { enabled: ['core', 'contacts', 'pipelines'] },
    // The sub-account asks for email, which the agency has not enabled.
    account: { enabled: ['core', 'contacts', 'pipelines', 'email'] },
  });

  assert.ok(!effective.includes('email'), 'email must not leak past the agency ceiling');
  assert.ok(effective.includes('contacts'));
});

test('a per-account grant cannot exceed the agency ceiling either', () => {
  const effective = resolveModules({
    planModules: [...PRO_PLAN],
    agency: { enabled: ['core', 'contacts'] },
    account: { enabled: ['core', 'contacts'], grants: ['telephony'] },
  });

  assert.ok(!effective.includes('telephony'), 'an upsell still respects the ceiling');
});

test('an account deny removes a module the agency allows', () => {
  const effective = resolveModules({
    planModules: [...PRO_PLAN],
    agency: { enabled: ['core', 'contacts', 'email'] },
    account: { enabled: ['core', 'contacts', 'email'], denies: ['email'] },
  });

  assert.ok(!effective.includes('email'));
  assert.ok(effective.includes('contacts'));
});

test('core modules are always present regardless of toggles', () => {
  const effective = resolveModules({
    planModules: [],
    agency: { enabled: [] },
    account: { enabled: [] },
  });

  // These three are the product, not upsells: contacts holds every record, pipelines is
  // what makes it a CRM, core carries auth and settings. None can be sold separately.
  assert.ok(effective.includes('core'));
  assert.ok(effective.includes('contacts'));
  assert.ok(effective.includes('pipelines'));
});

test('a core module survives an explicit deny', () => {
  const effective = resolveModules({
    planModules: ['core', 'contacts', 'pipelines'],
    agency: { enabled: ['core', 'contacts', 'pipelines'] },
    // Someone tries to switch contacts off for this sub-account.
    account: { enabled: ['core'], denies: ['contacts', 'pipelines'] },
  });

  assert.ok(effective.includes('contacts'), 'contacts cannot be denied');
  assert.ok(effective.includes('pipelines'), 'pipelines cannot be denied');
});

test('a core module is not blocked by the plan or the agency ceiling', () => {
  const effective = resolveModules({
    // A plan that sells nothing at all.
    planModules: [],
    agency: { enabled: [], denies: ['contacts'] },
    account: { enabled: [] },
  });

  assert.ok(effective.includes('contacts'));
  assert.ok(effective.includes('pipelines'));
  // Optional modules are still correctly excluded.
  assert.ok(!effective.includes('email'));
});

test('optional modules stay optional', () => {
  const effective = resolveModules({
    planModules: ['core', 'contacts', 'pipelines', 'email'],
    agency: { enabled: ['core', 'contacts', 'pipelines', 'email'] },
    account: { enabled: ['core', 'contacts', 'pipelines'], denies: ['email'] },
  });

  assert.ok(!effective.includes('email'), 'email is still switchable');
});

test('a module outside the plan is not enabled even if the agency lists it', () => {
  const effective = resolveModules({
    planModules: ['core', 'contacts'],
    agency: { enabled: ['core', 'contacts', 'campaigns'] },
    account: { enabled: ['core', 'contacts', 'campaigns'] },
  });

  assert.ok(!effective.includes('campaigns'), 'the plan is the outermost limit');
});

test('dependencies expand transitively', () => {
  // campaigns -> telephony -> contacts
  const expanded = withDependencies(['campaigns']);
  assert.ok(expanded.includes('campaigns'));
  assert.ok(expanded.includes('telephony'));
  assert.ok(expanded.includes('contacts'));
});

test('dependents block a disable', () => {
  const blockers = dependentsOf('contacts', ['core', 'contacts', 'pipelines', 'email']);
  assert.deepEqual(blockers.sort(), ['email', 'pipelines']);

  assert.deepEqual(dependentsOf('contacts', ['core', 'contacts']), []);
});

test('validateModuleSet catches a broken combination', () => {
  const broken = validateModuleSet(['core', 'pipelines']); // pipelines needs contacts
  assert.equal(broken.valid, false);
  assert.equal(broken.missing[0]?.module, 'pipelines');
  assert.deepEqual(broken.missing[0]?.requires, ['contacts']);

  assert.equal(validateModuleSet(['core', 'contacts', 'pipelines']).valid, true);
});

const labelsIn = (nav: ReturnType<typeof buildNavigation>, group: string) =>
  nav.find((s) => s.group === group)?.items.map((i) => i.label) ?? [];

test('core, contacts and pipelines share one Main section', () => {
  const nav = buildNavigation(['core', 'contacts', 'pipelines'], ['*']);

  // The whole point of nav groups: three modules, one heading.
  assert.deepEqual(
    nav.map((s) => s.group),
    ['Main'],
    'no separate Contacts or Pipelines headings',
  );
  assert.deepEqual(labelsIn(nav, 'Main'), ['Dashboard', 'Settings', 'Contacts', 'Pipelines']);
});

test('email files under Marketing, not a heading of its own', () => {
  const nav = buildNavigation(['core', 'contacts', 'pipelines', 'email'], ['*']);

  assert.deepEqual(nav.map((s) => s.group), ['Main', 'Marketing']);
  assert.deepEqual(labelsIn(nav, 'Marketing'), ['Email']);
  // An "Email" heading is not merely absent — `NavGroup` has no such member, so the
  // type system rules it out before a test can.
});

test('a group disappears when its only module is off', () => {
  const nav = buildNavigation(['core', 'contacts', 'pipelines'], ['*']);
  assert.ok(!nav.some((s) => s.group === 'Marketing'), 'Marketing is empty without email');
});

test('navigation still respects permissions', () => {
  // Modules on, but the user holds nothing that reveals their entries.
  const nav = buildNavigation(['core', 'contacts', 'pipelines'], ['core:settings:read']);
  const main = labelsIn(nav, 'Main');

  assert.ok(main.includes('Settings'));
  assert.ok(!main.includes('Contacts'), 'no contacts permission, no Contacts entry');
  assert.ok(!main.includes('Pipelines'));
});

test('a partial permission keeps only the entries it covers', () => {
  const nav = buildNavigation(['core', 'contacts'], ['contacts:list:read']);
  const contacts = nav.find((s) => s.group === 'Main')?.items.find((i) => i.label === 'Contacts');

  assert.ok(contacts, 'the Contacts entry should survive');
  assert.deepEqual(
    contacts!.children?.map((c) => c.label),
    ['Lists'],
    'only Lists is visible',
  );
});

test('planned modules never appear in navigation', () => {
  const nav = buildNavigation(['core', 'contacts', 'telephony'], ['*']);
  assert.ok(!nav.some((s) => s.group === 'Calling'), 'telephony is planned, so Calling is empty');
});

test('the caller role cannot export contacts', () => {
  // The commercial reason this role exists: a cold-call seat that cannot walk off
  // with a client's skip-traced lead list.
  const caller = resolvePermissions({
    rolePermissions: [
      'contacts:contact:read',
      'contacts:contact:update',
      'telephony:call:place',
    ],
  });

  assert.equal(hasPermission(caller, 'contacts:contact:read'), true);
  assert.equal(hasPermission(caller, 'contacts:contact:export'), false);
  assert.equal(hasPermission(caller, 'core:settings:update'), false);
});
