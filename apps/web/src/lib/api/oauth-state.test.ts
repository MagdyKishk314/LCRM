import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import {
  codeChallenge,
  createAttempt,
  decodeAttempt,
  encodeAttempt,
  stateMatches,
} from './oauth-state';

test('an attempt survives the round trip through a cookie', () => {
  const attempt = createAttempt();
  assert.deepEqual(decodeAttempt(encodeAttempt(attempt)), attempt);
});

test('two attempts never share values', () => {
  const a = createAttempt();
  const b = createAttempt();

  assert.notEqual(a.state, b.state);
  assert.notEqual(a.verifier, b.verifier);
  assert.notEqual(a.nonce, b.nonce);
});

test('the values carry enough entropy to resist guessing', () => {
  const { state, verifier, nonce } = createAttempt();

  // 32 random bytes base64url-encoded, unpadded; the PKCE spec floor for a verifier is 43.
  assert.ok(state.length >= 43, `state was ${state.length} characters`);
  assert.ok(verifier.length >= 43, `verifier was ${verifier.length} characters`);
  assert.ok(nonce.length >= 20, `nonce was ${nonce.length} characters`);
  assert.match(verifier, /^[A-Za-z0-9_-]+$/, 'must be URL-safe without padding');
});

test('the challenge is the S256 hash of the verifier', () => {
  // Google recomputes this from the verifier we send at exchange time; if it disagrees, the
  // exchange fails and nobody can sign in.
  const { verifier } = createAttempt();
  const expected = createHash('sha256').update(verifier).digest('base64url');

  assert.equal(codeChallenge(verifier), expected);
  assert.doesNotMatch(codeChallenge(verifier), /[+/=]/, 'must be base64url, not base64');
});

test('a missing or malformed cookie decodes to nothing rather than throwing', () => {
  assert.equal(decodeAttempt(undefined), null);
  assert.equal(decodeAttempt(''), null);
  assert.equal(decodeAttempt('not-base64!!'), null);
  assert.equal(decodeAttempt(Buffer.from('{}').toString('base64url')), null);
  assert.equal(
    decodeAttempt(Buffer.from(JSON.stringify({ state: 'a' })).toString('base64url')),
    null,
    'a partial attempt is not usable',
  );
});

test('state comparison accepts only an exact match', () => {
  const { state } = createAttempt();

  assert.equal(stateMatches(state, state), true);
  assert.equal(stateMatches(state, null), false);
  assert.equal(stateMatches(state, ''), false);
  assert.equal(stateMatches(state, state + 'x'), false);
  assert.equal(stateMatches(state, state.slice(0, -1)), false);
  assert.equal(stateMatches(state, createAttempt().state), false);
});

test('a differing length is rejected without a timing-unsafe comparison', () => {
  // timingSafeEqual throws on mismatched lengths, so this must be checked first — a throw
  // here would surface as a 500 instead of a rejected sign-in.
  assert.doesNotThrow(() => stateMatches('short', 'much-longer-value'));
  assert.equal(stateMatches('short', 'much-longer-value'), false);
});
