import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { anon, as, inAccount, startHarness, stopHarness, type World } from '../../test/harness';
import { Contact, EmailIdentity, Opportunity, Pipeline } from '../../models';

let world: World;
let admin: ReturnType<typeof as>;
let pipelineId: string;
let contactId: string;
let identityId: string;

const inA1 = <T>(fn: () => Promise<T>) => inAccount(world, 'A', 'A1', fn);

before(async () => {
  world = await startHarness();
  admin = as(world.users.adminA1, world.accounts.A1);

  await inA1(async () => {
    const pipeline = await Pipeline.create({
      name: 'Acquisition',
      isDefault: true,
      stages: [
        { id: 'lead', name: 'Lead', order: 0 },
        { id: 'offer', name: 'Offer', order: 1 },
        { id: 'closed', name: 'Closed', order: 2 },
      ],
    });
    pipelineId = String(pipeline._id);

    const contact = await Contact.create({
      firstName: 'Wayne',
      lastName: 'Kowalski',
      email: 'wayne@example.com',
      property: { acres: 40, county: 'Costilla' },
    });
    contactId = String(contact._id);

    const identity = await EmailIdentity.create({
      fromName: 'Ridgeline',
      fromEmail: 'offers@ridgeline.example.com',
      verified: true,
      isDefault: true,
    });
    identityId = String(identity._id);
  });
});
after(stopHarness);

// ── FIX-07 / FIX-12 · opportunities ─────────────────────────────────────────

async function createCard() {
  const res = await admin
    .post('/pipelines/opportunities')
    .send({ pipelineId, stageId: 'lead', contactId, name: '40 ac — Costilla' });
  assert.equal(res.status, 201);
  return res.body.id as string;
}

test('the board endpoint returns every pipeline and the selected board in one call', async () => {
  const id = await createCard();

  const byDefault = await admin.get('/pipelines/board');
  assert.equal(byDefault.status, 200);
  assert.equal(byDefault.body.pipelines.length, 1);
  assert.equal(byDefault.body.pipeline.id, pipelineId);
  assert.ok(byDefault.body.opportunities.some((o: { id: string }) => o.id === id));
  assert.equal(byDefault.body.contacts[0].id, contactId);

  // An unknown id falls back to the default rather than failing.
  const stale = await admin.get('/pipelines/board?pipeline=000000000000000000000000');
  assert.equal(stale.status, 200);
  assert.equal(stale.body.pipeline.id, pipelineId);

  // Another sub-account sees none of it.
  const elsewhere = await as(world.users.adminA2, world.accounts.A2).get('/pipelines/board');
  assert.equal(elsewhere.status, 200);
  assert.equal(elsewhere.body.pipeline, null);
  assert.deepEqual(elsewhere.body.pipelines, []);
});

test('a plain edit cannot move a card to a stage that does not exist', async () => {
  const id = await createCard();

  const res = await admin.patch(`/pipelines/opportunities/${id}`).send({ stageId: 'nowhere' });
  assert.equal(res.status, 400);

  const stored = await inA1(() => Opportunity.findById(id));
  assert.equal(stored?.stageId, 'lead');
});

test('a plain edit still changes the fields it is for', async () => {
  const id = await createCard();

  const res = await admin.patch(`/pipelines/opportunities/${id}`).send({ value: 12_500 });
  assert.equal(res.status, 200);
  assert.equal(res.body.value, 12_500);
});

test("a card cannot be re-pointed at another sub-account's contact", async () => {
  const id = await createCard();
  const foreign = await inAccount(world, 'A', 'A2', () =>
    Contact.create({ firstName: 'Other', lastName: 'Tenant' }),
  );

  const res = await admin
    .patch(`/pipelines/opportunities/${id}`)
    .send({ contactId: String(foreign._id) });
  assert.equal(res.status, 404);

  const stored = await inA1(() => Opportunity.findById(id));
  assert.equal(stored?.contactId, contactId);
});

test('a card dragged out of the last stage is open again', async () => {
  const id = await createCard();
  const move = async (stageId: string) => {
    const res = await admin.patch(`/pipelines/opportunities/${id}/move`).send({ stageId });
    assert.equal(res.status, 200);
    return res.body.status as string;
  };

  assert.equal(await move('offer'), 'open');
  assert.equal(await move('closed'), 'won');
  assert.equal(await move('offer'), 'open');
});

test('moving to a stage outside the pipeline is refused', async () => {
  const id = await createCard();
  const res = await admin.patch(`/pipelines/opportunities/${id}/move`).send({ stageId: 'nowhere' });
  assert.equal(res.status, 400);
});

// ── FIX-04 · do-not-contact on send ─────────────────────────────────────────

const send = (body: Record<string, unknown>) =>
  admin.post('/email/messages').send({ subject: 'Your parcel', body: 'Hello', ...body });

test('a do-not-contact contact is refused on either signal', async () => {
  // Drifted rows, written straight to the collection the way old data would be.
  const drifted = await inA1(async () => {
    const flagOnly = await Contact.create({ firstName: 'Flag', lastName: 'Only', email: 'flag@example.com' });
    const statusOnly = await Contact.create({ firstName: 'Status', lastName: 'Only', email: 'status@example.com' });
    await Contact.collection.updateOne({ _id: flagOnly._id }, { $set: { dnc: true, status: 'contacted' } });
    await Contact.collection.updateOne({ _id: statusOnly._id }, { $set: { dnc: false, status: 'do_not_call' } });
    return { flagOnly: String(flagOnly._id), statusOnly: String(statusOnly._id) };
  });

  const byFlag = await send({ contactId: drifted.flagOnly, to: ['someone-else@example.com'] });
  assert.equal(byFlag.status, 400);
  assert.match(byFlag.body.error.message, /do-not-contact/);

  const byStatus = await send({ contactId: drifted.statusOnly, to: ['someone-else@example.com'] });
  assert.equal(byStatus.status, 400);
});

test('a do-not-contact address is refused even when no contact is named', async () => {
  const to = await send({ to: ['FLAG@example.com'] });
  assert.equal(to.status, 400);
  assert.match(to.body.error.message, /flag@example\.com/);

  const cc = await send({ to: ['wayne@example.com'], cc: ['status@example.com'] });
  assert.equal(cc.status, 400);
});

test('an ordinary contact can be emailed, with merge fields resolved', async () => {
  const res = await send({
    contactId,
    to: ['wayne@example.com'],
    subject: 'Your {{contact.property.acres}} acres',
    body: 'Hi {{contact.firstName}}',
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.status, 'sent');
  assert.equal(res.body.subject, 'Your 40 acres');
  assert.equal(res.body.body, 'Hi Wayne');
});

// ── FIX-20 · templates on send ──────────────────────────────────────────────

test('a template supplies the subject and body', async () => {
  const template = await admin.post('/email/templates').send({
    name: 'Offer',
    subject: 'Offer for {{contact.property.county}} County',
    body: 'Hi {{contact.firstName}}, our offer stands for 14 days.',
  });
  assert.equal(template.status, 201);

  const res = await admin
    .post('/email/messages')
    .send({ contactId, to: ['wayne@example.com'], templateId: template.body.id });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.subject, 'Offer for Costilla County');
  assert.equal(res.body.body, 'Hi Wayne, our offer stands for 14 days.');

  // Anything sent explicitly wins over the template.
  const overridden = await admin.post('/email/messages').send({
    contactId,
    to: ['wayne@example.com'],
    templateId: template.body.id,
    subject: 'A different subject',
  });
  assert.equal(overridden.body.subject, 'A different subject');
  assert.equal(overridden.body.body, 'Hi Wayne, our offer stands for 14 days.');
});

test('neither a template nor a subject and body is a bad request', async () => {
  const res = await admin.post('/email/messages').send({ to: ['wayne@example.com'] });
  assert.equal(res.status, 400);

  const missing = await admin
    .post('/email/messages')
    .send({ to: ['wayne@example.com'], templateId: '000000000000000000000000' });
  assert.equal(missing.status, 404);
});

// ── FIX-19 · verifying a sending address ────────────────────────────────────

const confirm = (token: string) =>
  anon().post('/api/v1/core/sender-verification').send({ token });

test('a new sending address cannot send until it is confirmed by link', async () => {
  const created = await admin
    .post('/email/identities')
    .send({ fromName: 'Summit', fromEmail: 'hello@summit.example.com' });
  assert.equal(created.status, 201);
  assert.equal(created.body.verified, false);
  assert.equal(created.body.verifyTokenHash, undefined, 'the token hash is never returned');

  // No SMTP in tests, so the link is handed back, as an invite link is.
  assert.match(created.body.verifyUrl, /\/verify-sender\/.+/);
  const token = created.body.verifyUrl.split('/verify-sender/')[1] as string;

  const before = await send({ to: ['wayne@example.com'], identityId: created.body.id });
  assert.equal(before.status, 400);
  assert.match(before.body.error.message, /not verified/);

  assert.equal((await confirm('not-the-token')).status, 400);

  const confirmed = await confirm(token);
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.body.fromEmail, 'hello@summit.example.com');

  // Single use.
  assert.equal((await confirm(token)).status, 400);

  const afterwards = await send({ to: ['wayne@example.com'], identityId: created.body.id });
  assert.equal(afterwards.status, 201);
});

test('resending replaces the link, and the old one stops working', async () => {
  const created = await admin
    .post('/email/identities')
    .send({ fromName: 'Second', fromEmail: 'second@summit.example.com' });
  const first = created.body.verifyUrl.split('/verify-sender/')[1] as string;

  const resent = await admin.post(`/email/identities/${created.body.id}/resend`);
  assert.equal(resent.status, 200);
  const second = resent.body.verifyUrl.split('/verify-sender/')[1] as string;
  assert.notEqual(first, second);

  assert.equal((await confirm(first)).status, 400);
  assert.equal((await confirm(second)).status, 200);

  // Nothing left to resend once it is verified.
  assert.equal((await admin.post(`/email/identities/${created.body.id}/resend`)).status, 400);
});

test('an expired link is refused', async () => {
  const created = await admin
    .post('/email/identities')
    .send({ fromName: 'Late', fromEmail: 'late@summit.example.com' });
  const token = created.body.verifyUrl.split('/verify-sender/')[1] as string;

  await inA1(() =>
    EmailIdentity.updateOne(
      { _id: created.body.id },
      { $set: { verifyExpiresAt: new Date(Date.now() - 1_000) } },
    ),
  );

  assert.equal((await confirm(token)).status, 400);
});

test('identities can be made default and removed, within the sub-account only', async () => {
  const other = await as(world.users.adminA2, world.accounts.A2)
    .post(`/email/identities/${identityId}/default`);
  assert.equal(other.status, 404);

  const created = await admin
    .post('/email/identities')
    .send({ fromName: 'Third', fromEmail: 'third@summit.example.com' });

  const made = await admin.post(`/email/identities/${created.body.id}/default`);
  assert.equal(made.status, 200);

  const defaults = await inA1(() => EmailIdentity.find({ isDefault: true }));
  assert.deepEqual(defaults.map((d) => String(d._id)), [created.body.id]);

  assert.equal((await admin.delete(`/email/identities/${created.body.id}`)).status, 204);
});
