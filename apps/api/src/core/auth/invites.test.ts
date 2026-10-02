import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { INVITE_TTL_DAYS, generateInvite, hashInviteToken, inviteUrl } from './invites';

test('the raw token is never what gets stored', () => {
  const invite = generateInvite();
  assert.notEqual(invite.token, invite.hash);
  // A stolen database row must not yield a usable link.
  assert.equal(invite.hash, hashInviteToken(invite.token));
  assert.equal(invite.hash.length, 64);
});

test('two invites never collide', () => {
  const tokens = new Set(Array.from({ length: 500 }, () => generateInvite().token));
  assert.equal(tokens.size, 500);
});

test('a token carries enough entropy to resist guessing', () => {
  // 32 random bytes, base64url encoded, unpadded.
  const { token } = generateInvite();
  assert.ok(token.length >= 42, `token was only ${token.length} characters`);
  assert.match(token, /^[A-Za-z0-9_-]+$/);
});

test('hashing is stable, so lookup by hash works', () => {
  assert.equal(hashInviteToken('abc'), hashInviteToken('abc'));
  assert.notEqual(hashInviteToken('abc'), hashInviteToken('abd'));
});

test('invites expire', () => {
  const { expiresAt } = generateInvite();
  const days = (expiresAt.getTime() - Date.now()) / 86_400_000;
  assert.ok(days > INVITE_TTL_DAYS - 0.01 && days <= INVITE_TTL_DAYS, `expired in ${days} days`);
});

test('the link points at the app, not the API', () => {
  assert.equal(inviteUrl('https://crm.landcaller.com', 'tok'), 'https://crm.landcaller.com/invite/tok');
  // A trailing slash in configuration must not produce a double slash.
  assert.equal(inviteUrl('https://crm.landcaller.com/', 'tok'), 'https://crm.landcaller.com/invite/tok');
  assert.equal(inviteUrl('http://localhost:3000///', 'tok'), 'http://localhost:3000/invite/tok');
});
