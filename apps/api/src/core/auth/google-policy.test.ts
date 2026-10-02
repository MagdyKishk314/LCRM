import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { resolveGoogleIdentity, type CandidateUser } from './google-policy';
import type { GoogleProfile } from './google';

function profile(overrides: Partial<GoogleProfile> = {}): GoogleProfile {
  return {
    subject: 'google-subject-1',
    email: 'someone@landcaller.com',
    emailVerified: true,
    ...overrides,
  };
}

function user(overrides: Partial<CandidateUser> = {}): CandidateUser {
  return { id: 'user-1', email: 'someone@landcaller.com', status: 'active', ...overrides };
}

test('a linked account signs in', () => {
  const decision = resolveGoogleIdentity({
    profile: profile(),
    linked: user({ id: 'linked-1' }),
    byEmail: null,
  });
  assert.deepEqual(decision, { action: 'sign_in', userId: 'linked-1' });
});

test('the link wins over the email, because the subject is the identity', () => {
  // Someone changed their Google address to one belonging to a different CRM user. The
  // existing link must still resolve to the account it was made for.
  const decision = resolveGoogleIdentity({
    profile: profile({ email: 'other@landcaller.com' }),
    linked: user({ id: 'linked-1' }),
    byEmail: user({ id: 'someone-else', email: 'other@landcaller.com' }),
  });
  assert.deepEqual(decision, { action: 'sign_in', userId: 'linked-1' });
});

test('an unverified email is refused even when it matches a real user', () => {
  // The account-takeover case: an address Google never confirmed can be claimed by anyone.
  const decision = resolveGoogleIdentity({
    profile: profile({ emailVerified: false }),
    linked: null,
    byEmail: user(),
  });
  assert.equal(decision.action, 'refuse');
  assert.equal(decision.action === 'refuse' && decision.reason, 'email_unverified');
});

test('an unverified email is refused before anything else is considered', () => {
  // Even with an existing link, an unverified assertion is not usable proof.
  const decision = resolveGoogleIdentity({
    profile: profile({ emailVerified: false }),
    linked: user({ id: 'linked-1' }),
    byEmail: user(),
  });
  assert.equal(decision.action, 'refuse');
});

test('a verified email matching an active user links on the way in', () => {
  const decision = resolveGoogleIdentity({ profile: profile(), linked: null, byEmail: user() });
  assert.deepEqual(decision, { action: 'link_and_sign_in', userId: 'user-1' });
});

test('a verified email matching an invited user accepts the invite', () => {
  const decision = resolveGoogleIdentity({
    profile: profile(),
    linked: null,
    byEmail: user({ status: 'invited' }),
  });
  assert.deepEqual(decision, { action: 'accept_invite', userId: 'user-1' });
});

test('an unknown Google account is refused, and never provisioned', () => {
  const decision = resolveGoogleIdentity({ profile: profile(), linked: null, byEmail: null });
  assert.equal(decision.action, 'refuse');
  assert.equal(decision.action === 'refuse' && decision.reason, 'no_matching_user');
});

test('the refusal for an unknown account does not reveal whether the email exists', () => {
  const unknown = resolveGoogleIdentity({ profile: profile(), linked: null, byEmail: null });
  const unverified = resolveGoogleIdentity({
    profile: profile({ emailVerified: false }),
    linked: null,
    byEmail: null,
  });

  assert.equal(unknown.action, 'refuse');
  assert.equal(unverified.action, 'refuse');
  // The two reasons differ, but neither message names the account, so neither answers
  // "does this address have a CRM login?".
  if (unknown.action === 'refuse') {
    assert.doesNotMatch(unknown.message, /someone@landcaller\.com/);
  }
});

test('a suspended user is refused whether linked or matched by email', () => {
  const linked = resolveGoogleIdentity({
    profile: profile(),
    linked: user({ status: 'suspended' }),
    byEmail: null,
  });
  const matched = resolveGoogleIdentity({
    profile: profile(),
    linked: null,
    byEmail: user({ status: 'suspended' }),
  });

  assert.equal(linked.action, 'refuse');
  assert.equal(linked.action === 'refuse' && linked.reason, 'suspended');
  assert.equal(matched.action, 'refuse');
  assert.equal(matched.action === 'refuse' && matched.reason, 'suspended');
});

test('every refusal carries a reason worth auditing', () => {
  const cases = [
    { profile: profile({ emailVerified: false }), linked: null, byEmail: null },
    { profile: profile(), linked: null, byEmail: null },
    { profile: profile(), linked: null, byEmail: user({ status: 'suspended' as const }) },
  ];

  for (const input of cases) {
    const decision = resolveGoogleIdentity(input);
    assert.equal(decision.action, 'refuse');
    if (decision.action === 'refuse') {
      assert.ok(decision.reason.length > 0);
      assert.ok(decision.message.length > 0);
    }
  }
});
