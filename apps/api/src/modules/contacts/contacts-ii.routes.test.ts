import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import * as XLSX from 'xlsx';
import { as, inAccount, startHarness, stopHarness, type World } from '../../test/harness';
import { Activity, Contact, EmailIdentity } from '../../models';

/**
 * Contacts II (Plans/CONTACTS-PLAN.md): the record, its history, lists and filters, tasks
 * and appointments, import strategies, export columns, merge and duplicates.
 */
let world: World;
let admin: ReturnType<typeof as>;
let user: ReturnType<typeof as>;

before(async () => {
  world = await startHarness();
  admin = as(world.users.adminA1, world.accounts.A1);
  user = as(world.users.userA1, world.accounts.A1);
});
after(stopHarness);

let n = 0;
async function createContact(body: Record<string, unknown> = {}, client = admin) {
  n++;
  const res = await client.post('/contacts').send({ firstName: `Owner${n}`, lastName: `Test${n}`, ...body });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body as { id: string } & Record<string, any>;
}
const detail = async (id: string) => {
  const res = await admin.get(`/contacts/${id}`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body;
};

// ── Phase 0: derived fields ─────────────────────────────────────────────────

test('phones are stored normalised and parcels get ids and a primary', async () => {
  const c = await createContact({
    phone: '(303) 555-0101',
    altPhones: ['719.555.0102', '+44 20 7946 0958'],
    properties: [{ apn: '1-1', county: 'Costilla', state: 'CO', acres: 5 }, { apn: '2-2', county: 'Alamosa', state: 'CO', acres: 40 }],
  });
  assert.equal(c.phoneDigits, '13035550101');
  assert.deepEqual(c.altPhoneDigits, ['17195550102']);
  assert.equal(c.properties.length, 2);
  assert.ok(c.properties.every((p: { id: string }) => p.id));
  assert.equal(c.properties[0].isPrimary, true);
  assert.equal(c.property.apn, '1-1', 'the primary is mirrored to `property`');
});

test('the legacy single `property` is still accepted and becomes the primary parcel', async () => {
  const c = await createContact({ property: { apn: '9-9', county: 'Luna', state: 'NM', acres: 10 } });
  assert.equal(c.properties.length, 1);
  assert.equal(c.property.county, 'Luna');

  // Editing through `property` updates the primary and keeps the rest.
  await admin.patch(`/contacts/${c.id}`).send({ properties: [...c.properties, { apn: '8-8', county: 'Grant', state: 'NM' }] });
  await admin.patch(`/contacts/${c.id}`).send({ property: { acres: 12 } });
  const d = await detail(c.id);
  assert.equal(d.properties.length, 2);
  assert.equal(d.property.acres, 12);
  assert.equal(d.property.apn, '9-9');
});

// ── The record (CNT-14, CNT-15, CNT-17, CNT-25, CNT-26) ─────────────────────

test('the detail endpoint returns the record with everything around it', async () => {
  const c = await createContact({ ownerId: world.users.userA1.id });
  for (let i = 0; i < 3; i++) {
    await admin.post(`/contacts/${c.id}/activities`).send({ type: 'note', body: `note ${i}` });
  }
  await admin.post(`/contacts/${c.id}/activities`).send({ type: 'call', metadata: { direction: 'outbound', durationSeconds: 90, outcome: 'voicemail' } });

  const d = await detail(c.id);
  assert.equal(d.owner.id, world.users.userA1.id);
  assert.match(d.owner.name, /userA1/);
  assert.equal(d.historyCounts.note, 3);
  assert.equal(d.historyCounts.call, 1);
  assert.equal(d.historyCounts.created, 1);
  assert.ok(Array.isArray(d.history.data));
  assert.equal(d.history.data[0].type, 'call');
  assert.equal(d.history.data[0].metadata.outcome, 'voicemail');
  assert.ok(d.history.data[0].actor.name, 'the actor is resolved to a name');
  assert.ok(Array.isArray(d.lists));
  assert.ok(Array.isArray(d.openTasks));
});

test('an owner must be a member of the sub-account', async () => {
  const res = await admin.post('/contacts').send({ firstName: 'X', lastName: 'Y', ownerId: world.users.ownerB.id });
  assert.equal(res.status, 400);
});

test('history pages by cursor and filters by type', async () => {
  const c = await createContact();
  for (let i = 0; i < 7; i++) {
    await admin.post(`/contacts/${c.id}/activities`).send({ type: i % 2 ? 'call' : 'note', body: `entry ${i}` });
  }

  const first = await admin.get(`/contacts/${c.id}/history?limit=3`);
  assert.equal(first.body.data.length, 3);
  assert.ok(first.body.nextCursor);

  const second = await admin.get(`/contacts/${c.id}/history?limit=3&before=${first.body.nextCursor}`);
  assert.equal(second.body.data.length, 3);
  const ids = new Set([...first.body.data, ...second.body.data].map((e: { id: string }) => e.id));
  assert.equal(ids.size, 6, 'no entry repeats across pages');

  const calls = await admin.get(`/contacts/${c.id}/history?type=call`);
  assert.ok(calls.body.data.every((e: { type: string }) => e.type === 'call'));
  assert.equal(calls.body.data.length, 3);
});

test('a malformed history entry is refused rather than stored', async () => {
  const c = await createContact();
  const res = await admin.post(`/contacts/${c.id}/activities`).send({ type: 'call', metadata: { direction: 'sideways' } });
  assert.equal(res.status, 400);
});

test('notes can be pinned, edited and deleted; other entries cannot', async () => {
  const c = await createContact();
  const note = await admin.post(`/contacts/${c.id}/activities`).send({ type: 'note', body: 'Speaks Spanish' });
  const pinned = await admin.patch(`/contacts/${c.id}/activities/${note.body.id}`).send({ pinned: true, body: 'Speaks Spanish only' });
  assert.equal(pinned.status, 200);

  const d = await detail(c.id);
  assert.equal(d.pinnedNotes.length, 1);
  assert.equal(d.pinnedNotes[0].body, 'Speaks Spanish only');

  const created = d.history.data.find((e: { type: string }) => e.type === 'created');
  assert.equal((await admin.patch(`/contacts/${c.id}/activities/${created.id}`).send({ body: 'x' })).status, 400);
  assert.equal((await admin.delete(`/contacts/${c.id}/activities/${created.id}`)).status, 400);
  assert.equal((await admin.delete(`/contacts/${c.id}/activities/${note.body.id}`)).status, 204);
});

test('field edits are recorded as a change entry', async () => {
  const c = await createContact({ company: 'Old Co' });
  await admin.patch(`/contacts/${c.id}`).send({ company: 'New Co', tags: ['a'] });
  const d = await detail(c.id);
  const change = d.history.data.find((e: { type: string }) => e.type === 'field_change');
  assert.ok(change);
  assert.match(change.title, /company/);
  assert.match(change.title, /tags/);
  const fields = change.metadata.changes.map((x: { field: string }) => x.field);
  assert.deepEqual(fields.sort(), ['company', 'tags']);
});

test('lists on the record: static membership and matching smart lists, add and remove', async () => {
  const c = await createContact({ status: 'qualified', tags: ['hot'] });
  const smart = await admin.post('/contacts/lists').send({ name: 'Hot', type: 'smart', filter: { status: ['qualified'] } });
  const stat = await admin.post('/contacts/lists').send({ name: 'Mailers' });

  assert.equal((await admin.post(`/contacts/${c.id}/lists/${stat.body.id}`)).status, 204);
  assert.equal((await admin.post(`/contacts/${c.id}/lists/${smart.body.id}`)).status, 400, 'a smart list fills itself');

  let d = await detail(c.id);
  assert.deepEqual(d.lists.map((l: { name: string }) => l.name).sort(), ['Hot', 'Mailers']);
  assert.ok(d.history.data.some((e: { type: string; title: string }) => e.type === 'list_change' && /Added to Mailers/.test(e.title)));

  assert.equal((await admin.delete(`/contacts/${c.id}/lists/${stat.body.id}`)).status, 204);
  d = await detail(c.id);
  assert.deepEqual(d.lists.map((l: { name: string }) => l.name), ['Hot']);
});

// ── Merge (CNT-27) and duplicates (CNT-44) ──────────────────────────────────

test('merging folds history, sets and parcels into the survivor and removes the duplicate', async () => {
  const keep = await createContact({ phone: '303-555-0200', tags: ['a'], properties: [{ apn: 'K-1', county: 'Costilla', state: 'CO' }], customFields: {} });
  const dupe = await createContact({ email: 'dupe@example.com', company: 'Dupe Co', tags: ['b'], altPhones: ['303-555-0201'], properties: [{ apn: 'D-1', county: 'Alamosa', state: 'CO' }], dnc: true });
  await admin.post(`/contacts/${dupe.id}/activities`).send({ type: 'note', body: 'from the duplicate' });
  await admin.post('/contacts/tasks').send({ title: 'Call back', contactId: dupe.id });

  const res = await admin.post(`/contacts/${keep.id}/merge`).send({ duplicateId: dupe.id, take: ['company', 'email'] });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.company, 'Dupe Co');
  assert.equal(res.body.email, 'dupe@example.com');
  assert.equal(res.body.phone, '303-555-0200', 'not taken, so kept');
  assert.deepEqual([...res.body.tags].sort(), ['a', 'b']);
  assert.ok(res.body.altPhones.includes('303-555-0201'));
  assert.equal(res.body.properties.length, 2);
  assert.equal(res.body.property.apn, 'K-1', 'the survivor keeps its primary');
  assert.equal(res.body.dnc, true, 'either record flagged means the survivor is');

  const d = await detail(keep.id);
  assert.ok(d.history.data.some((e: { body?: string }) => e.body === 'from the duplicate'));
  assert.ok(d.history.data.some((e: { type: string }) => e.type === 'merge'));
  assert.equal(d.openTasks.length, 1);
  assert.equal((await admin.get(`/contacts/${dupe.id}`)).status, 404);
});

test('merge needs the delete permission and refuses a self-merge', async () => {
  const a = await createContact();
  const b = await createContact();
  assert.equal((await user.post(`/contacts/${a.id}/merge`).send({ duplicateId: b.id })).status, 403);
  assert.equal((await admin.post(`/contacts/${a.id}/merge`).send({ duplicateId: a.id })).status, 400);
});

test('the duplicate check finds a contact by phone digits or email, and the pairs page groups them', async () => {
  const a = await createContact({ phone: '(719) 555-0300', email: 'same@example.com' });
  await createContact({ phone: '719-555-0300' });
  await createContact({ email: 'SAME@example.com' });

  const byPhone = await admin.get('/contacts/duplicates?phone=7195550300');
  assert.ok(byPhone.body.data.some((c: { id: string }) => c.id === a.id));
  const excluded = await admin.get(`/contacts/duplicates?phone=7195550300&exclude=${a.id}`);
  assert.ok(!excluded.body.data.some((c: { id: string }) => c.id === a.id));

  const pairs = await admin.get('/contacts/duplicates/all');
  assert.equal(pairs.status, 200);
  const phoneGroup = pairs.body.data.find((g: { by: string; value: string }) => g.by === 'phone' && g.value === '17195550300');
  const emailGroup = pairs.body.data.find((g: { by: string; value: string }) => g.by === 'email' && g.value === 'same@example.com');
  assert.equal(phoneGroup.contacts.length, 2);
  assert.equal(emailGroup.contacts.length, 2);
});

// ── Filters (CNT-29, CNT-30) ────────────────────────────────────────────────

test('the filter panel conditions narrow the list', async () => {
  const owner = world.users.userA1.id;
  const mine = await createContact({ ownerId: owner, email: 'has@example.com', tags: ['x', 'y'], source: 'Zoho', properties: [{ county: 'Costilla', state: 'CO', acres: 3 }, { county: 'Luna', state: 'NM', acres: 50, assessedValue: 9000 }] });
  const other = await createContact({ tags: ['x'], properties: [{ county: 'Costilla', state: 'CO', acres: 3 }] });

  const ids = async (query: string) => {
    const res = await user.get(`/contacts?pageSize=200&${query}`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    return res.body.data.map((c: { id: string }) => c.id);
  };

  assert.ok((await ids('ownerId=me')).includes(mine.id));
  assert.ok(!(await ids('ownerId=me')).includes(other.id));
  assert.ok((await ids('ownerId=none')).includes(other.id));
  assert.ok((await ids('hasEmail=true')).includes(mine.id));
  assert.ok(!(await ids('hasEmail=true')).includes(other.id));
  assert.ok((await ids('acresMin=20')).includes(mine.id), 'any parcel, not only the primary');
  assert.ok(!(await ids('acresMin=20')).includes(other.id));
  assert.ok((await ids('county=Luna')).includes(mine.id));
  assert.ok((await ids('valueMin=5000')).includes(mine.id));
  assert.ok((await ids('tags=x,y&tagMode=all')).includes(mine.id));
  assert.ok(!(await ids('tags=x,y&tagMode=all')).includes(other.id));
  assert.ok((await ids('tags=x,y')).includes(other.id), 'any by default');
  assert.ok((await ids('source=Zoho')).includes(mine.id));
  assert.ok((await ids('createdAfter=2000-01-01&createdBefore=2999-01-01')).includes(mine.id));
});

test('custom field conditions filter, and the facets name the fields and owners', async () => {
  await admin.post('/contacts/fields').send({ label: 'Lot type', type: 'select', options: ['infill', 'rural'] });
  const rural = await createContact({ customFields: { lot_type: 'rural' } });
  const infill = await createContact({ customFields: { lot_type: 'infill' } });

  const res = await admin.get('/contacts?cf.lot_type=rural&pageSize=200');
  const ids = res.body.data.map((c: { id: string }) => c.id);
  assert.ok(ids.includes(rural.id) && !ids.includes(infill.id));

  const facets = await admin.get('/contacts/facets');
  assert.ok(facets.body.fields.some((f: { key: string }) => f.key === 'lot_type'));
  assert.ok(facets.body.owners.some((o: { id: string }) => o.id === world.users.userA1.id));
  assert.ok(facets.body.sources.includes('Zoho'));
});

test('a smart list stores the shared filter shape and is editable, and the table sorts by header', async () => {
  const list = await admin.post('/contacts/lists').send({
    name: 'Big Luna',
    type: 'smart',
    filter: { county: 'Luna', acresMin: '20' },
  });
  assert.equal(list.status, 201);
  assert.deepEqual(list.body.filter, { county: ['Luna'], acresMin: 20 });
  assert.ok(list.body.memberCount >= 1);

  const empty = await admin.post('/contacts/lists').send({ name: 'Everything', type: 'smart', filter: { search: ' ' } });
  assert.equal(empty.status, 400, 'a smart list must narrow something');

  const edited = await admin.patch(`/contacts/lists/${list.body.id}`).send({ name: 'Big Luna lots', filter: { county: ['Luna'] } });
  assert.equal(edited.status, 200);
  assert.deepEqual(edited.body.filter, { county: ['Luna'] });

  const copy = await admin.post(`/contacts/lists/${list.body.id}/duplicate`);
  assert.equal(copy.status, 201);
  assert.equal(copy.body.name, 'Big Luna lots (copy)');

  const sorted = await admin.get('/contacts?sort=-property.acres&pageSize=3');
  const acres = sorted.body.data.map((c: { property?: { acres?: number } }) => c.property?.acres ?? -1);
  assert.deepEqual(acres, [...acres].sort((a, b) => b - a));
});

// ── Bulk (CNT-33) ───────────────────────────────────────────────────────────

test('the new bulk actions: assign owner, remove from list, set source', async () => {
  const a = await createContact();
  const b = await createContact();
  const ids = [a.id, b.id];
  const list = await admin.post('/contacts/lists').send({ name: 'Bulk' });

  await admin.post('/contacts/bulk').send({ action: 'addToList', value: list.body.id, ids });
  const removed = await admin.post('/contacts/bulk').send({ action: 'removeFromList', value: list.body.id, ids: [a.id] });
  assert.equal(removed.body.affected, 1);
  assert.deepEqual((await detail(a.id)).listIds, []);
  assert.deepEqual((await detail(b.id)).listIds, [list.body.id]);

  const owned = await admin.post('/contacts/bulk').send({ action: 'assignOwner', value: world.users.userA1.id, ids });
  assert.equal(owned.body.affected, 2);
  assert.equal((await detail(a.id)).owner.id, world.users.userA1.id);
  const foreign = await admin.post('/contacts/bulk').send({ action: 'assignOwner', value: world.users.ownerB.id, ids });
  assert.equal(foreign.status, 400);
  await admin.post('/contacts/bulk').send({ action: 'assignOwner', value: 'none', ids: [a.id] });
  assert.equal((await detail(a.id)).owner, null);

  await admin.post('/contacts/bulk').send({ action: 'setSource', value: 'Door knock', ids });
  assert.equal((await detail(b.id)).source, 'Door knock');
});

// ── Tasks (CNT-35) ──────────────────────────────────────────────────────────

test('tasks: create, list mine, complete with a history entry', async () => {
  const c = await createContact();
  const soon = new Date(Date.now() + 60_000).toISOString();
  const created = await user.post('/contacts/tasks').send({ title: 'Send offer', contactId: c.id, dueAt: soon, priority: 'high' });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.assigneeId, world.users.userA1.id, 'defaults to the creator');
  assert.equal(created.body.status, 'open');

  const mine = await user.get('/contacts/tasks?assignee=me&due=today');
  assert.ok(mine.body.data.some((t: { id: string; contact: { name: string } }) => t.id === created.body.id && t.contact.name));
  const theirs = await admin.get('/contacts/tasks?assignee=me');
  assert.ok(!theirs.body.data.some((t: { id: string }) => t.id === created.body.id));

  assert.equal((await detail(c.id)).openTasks.length, 1);

  const done = await user.patch(`/contacts/tasks/${created.body.id}`).send({ status: 'done' });
  assert.equal(done.body.status, 'done');
  assert.ok(done.body.completedAt);
  const d = await detail(c.id);
  assert.equal(d.openTasks.length, 0);
  assert.ok(d.history.data.some((e: { type: string; title: string }) => e.type === 'task' && /Completed/.test(e.title)));

  const foreign = await user.post('/contacts/tasks').send({ title: 'x', assigneeId: world.users.ownerB.id });
  assert.equal(foreign.status, 400);

  // The caller role can manage tasks; the caller cannot delete contacts, which is unrelated.
  const caller = as(world.users.callerA1, world.accounts.A1);
  assert.equal((await caller.post('/contacts/tasks').send({ title: 'Callback', contactId: c.id })).status, 201);
});

// ── Appointments (CNT-36) ───────────────────────────────────────────────────

test('appointments: schedule, upcoming list, reschedule, outcome', async () => {
  const c = await createContact();
  const start = new Date(Date.now() + 2 * 60 * 60 * 1000);
  const made = await user.post('/contacts/appointments').send({ contactId: c.id, title: 'Site visit', startsAt: start.toISOString(), location: 'The parcel' });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  assert.equal(made.body.outcome, 'scheduled');
  assert.equal(new Date(made.body.endsAt).getTime() - start.getTime(), 30 * 60 * 1000, 'thirty minutes by default');

  const upcoming = await user.get('/contacts/appointments?user=me');
  assert.ok(upcoming.body.data.some((a: { id: string; contact: { name: string } }) => a.id === made.body.id && a.contact.name));
  assert.equal((await detail(c.id)).upcomingAppointments.length, 1);

  const later = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  const moved = await user.patch(`/contacts/appointments/${made.body.id}`).send({ startsAt: later.toISOString() });
  assert.equal(moved.status, 200);
  assert.equal(new Date(moved.body.endsAt).getTime() - later.getTime(), 30 * 60 * 1000, 'the duration is kept');

  const held = await user.patch(`/contacts/appointments/${made.body.id}`).send({ outcome: 'held' });
  assert.equal(held.body.outcome, 'held');

  const d = await detail(c.id);
  const entries = d.history.data.filter((e: { type: string }) => e.type === 'appointment');
  assert.equal(entries.length, 3);
  assert.ok(entries.some((e: { title: string }) => /Held/.test(e.title)));

  const backwards = await user.post('/contacts/appointments').send({ contactId: c.id, title: 'x', startsAt: start.toISOString(), endsAt: new Date(start.getTime() - 1000).toISOString() });
  assert.equal(backwards.status, 400);
});

// ── Import (CNT-37, CNT-38, CNT-39) ─────────────────────────────────────────

const COLUMNS = ['First', 'Last', 'Phone', 'Email', 'Lot', 'Id'];
const MAPPING = { First: 'firstName', Last: 'lastName', Phone: 'phone', Email: 'email', Lot: 'cf.lot_type', Id: 'externalId' };

async function runImport(rows: string[][], job: Record<string, unknown> = {}) {
  const opened = await admin.post('/contacts/import/jobs').send({ fileName: 'owners.csv', mapping: MAPPING, totalRows: rows.length, ...job });
  assert.equal(opened.status, 201, JSON.stringify(opened.body));
  const res = await admin.post('/contacts/import/commit').send({ columns: COLUMNS, rows, mapping: MAPPING, jobId: opened.body.id });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  await admin.post(`/contacts/import/jobs/${opened.body.id}/finish`).send({ status: 'finished' });
  return { ...res.body, jobId: opened.body.id as string };
}

test('import maps custom fields, previews matches, and honours the strategy', async () => {
  const first = await runImport([['Ada', 'Lovelace', '(303) 555-0400', 'ada@example.com', 'rural', 'ext-A']]);
  assert.equal(first.created, 1);

  const ada = await inAccount(world, 'A', 'A1', () => Contact.findOne({ sourceId: 'ext-A' }).lean());
  assert.equal(ada?.customFields.lot_type, 'rural');
  assert.equal(ada?.importJobId, first.jobId);
  assert.equal(ada?.phoneDigits, '13035550400');

  // Preview: one of these two rows matches (by phone digits, formatted differently).
  const preview = await admin.post('/contacts/import/preview').send({
    columns: COLUMNS,
    mapping: MAPPING,
    rows: [['Ada', 'L', '303.555.0400', '', '', ''], ['New', 'Person', '303-555-0401', '', '', '']],
  });
  assert.deepEqual([preview.body.matched, preview.body.unmatched], [1, 1]);

  // Skip: the match is left alone and counted as skipped.
  const skip = await runImport([['Ada', 'Changed', '303.555.0400', '', 'infill', '']], { strategy: 'skip' });
  assert.deepEqual([skip.created, skip.updated, skip.skipped], [0, 0, 1]);
  assert.equal((await inAccount(world, 'A', 'A1', () => Contact.findOne({ sourceId: 'ext-A' }).lean()))?.lastName, 'Lovelace');

  // Create: a second record is made even though the phone matches.
  const create = await runImport([['Ada', 'Again', '303.555.0400', '', '', '']], { strategy: 'create' });
  assert.equal(create.created, 1);
  assert.equal(await inAccount(world, 'A', 'A1', () => Contact.countDocuments({ phoneDigits: '13035550400' })), 2);

  // Update (default): matched by phone digits, the custom field is updated and a bad value is reported, not fatal.
  const update = await runImport([['Ada', 'Lovelace', '303.555.0400', '', 'bogus', 'ext-A']]);
  assert.equal(update.updated, 1);
  assert.equal(update.errorCount, 1, 'the bad lot type is reported');
  assert.match(update.errors[0].message, /Lot type/);
});

test('an import is recorded, listed, and can be undone — deleting only what it created', async () => {
  const existing = await createContact({ phone: '303-555-0500', firstName: 'Pre', lastName: 'Existing' });
  const run = await runImport([
    ['Pre', 'Existing', '303-555-0500', '', '', ''],
    ['Brand', 'New', '303-555-0501', '', '', ''],
  ], { tag: 'batch-1', ownerId: world.users.userA1.id });
  assert.deepEqual([run.created, run.updated], [1, 1]);

  const jobs = await admin.get('/contacts/import/jobs');
  const job = jobs.body.data.find((j: { id: string }) => j.id === run.jobId);
  assert.equal(job.status, 'finished');
  assert.deepEqual([job.created, job.updated], [1, 1]);
  assert.ok(job.userName);

  const brandNew = await inAccount(world, 'A', 'A1', () => Contact.findOne({ phoneDigits: '13035550501' }).lean());
  assert.equal(brandNew?.ownerId, world.users.userA1.id, 'the job owner is set on created contacts');
  assert.ok(brandNew?.tags.includes('batch-1'));
  const brandNewHistory = await admin.get(`/contacts/${brandNew!._id}/history?type=import`);
  assert.equal(brandNewHistory.body.data.length, 1);

  const undo = await admin.post(`/contacts/import/jobs/${run.jobId}/undo`);
  assert.equal(undo.status, 200);
  assert.deepEqual(undo.body, { deleted: 1, kept: 1 });
  assert.equal((await admin.get(`/contacts/${existing.id}`)).status, 200, 'the updated contact survives');
  assert.equal(await inAccount(world, 'A', 'A1', () => Contact.countDocuments({ phoneDigits: '13035550501' })), 0);
  assert.equal((await admin.post(`/contacts/import/jobs/${run.jobId}/undo`)).status, 400, 'only once');
});

// ── Export (CNT-43) ─────────────────────────────────────────────────────────

test('export chooses its columns, includes custom fields and owners, and can be a workbook', async () => {
  await createContact({ firstName: 'Export', lastName: 'Me', ownerId: world.users.userA1.id, customFields: { lot_type: 'infill' }, tags: ['exp'] });

  const csv = await admin.get('/contacts/export?tags=exp&columns=firstName,owner,cf.lot_type');
  assert.equal(csv.status, 200);
  const lines = csv.text.replace(/^﻿/, '').trim().split(/\r?\n/);
  assert.equal(lines[0], 'First name,Owner,Lot type');
  assert.match(lines[1]!, /^Export,userA1 Test,infill$/);

  const xlsx = await admin.post('/contacts/export').send({ format: 'xlsx', columns: 'firstName,lastName', filter: { tags: ['exp'] } }).buffer().parse((res, cb) => {
    const chunks: Buffer[] = [];
    res.on('data', (c: Buffer) => chunks.push(c));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  });
  assert.equal(xlsx.status, 200);
  assert.match(xlsx.headers['content-type'] ?? '', /spreadsheetml/);
  const book = XLSX.read(xlsx.body as Buffer, { type: 'buffer' });
  const rows = XLSX.utils.sheet_to_json<string[]>(book.Sheets[book.SheetNames[0]!]!, { header: 1 });
  assert.deepEqual(rows[0], ['First name', 'Last name']);
  assert.deepEqual(rows[1], ['Export', 'Me']);

  const unknownOnly = await admin.get('/contacts/export?columns=nonsense');
  assert.equal(unknownOnly.status, 400);
});

// ── Email history uses the real message (CNT-24) ────────────────────────────

test('the email tab entry carries the message status', async () => {
  const c = await createContact({ email: 'mail@example.com' });
  await inAccount(world, 'A', 'A1', () =>
    EmailIdentity.create({ fromName: 'A1', fromEmail: 'a1@example.com', verified: true, isDefault: true }),
  );
  const sent = await admin.post('/email/messages').send({ contactId: c.id, to: ['mail@example.com'], subject: 'Hi', body: 'Hello' });
  assert.equal(sent.status, 201, JSON.stringify(sent.body));

  const emails = await admin.get(`/contacts/${c.id}/history?type=email`);
  assert.equal(emails.body.data.length, 1);
  assert.equal(emails.body.data[0].email.subject, 'Hi');
  assert.equal(emails.body.data[0].email.status, 'sent');
  assert.equal(emails.body.data[0].channelRef.kind, 'email');

  const count = await inAccount(world, 'A', 'A1', () => Activity.countDocuments({ contactId: c.id, type: 'email' }));
  assert.equal(count, 1);
});
