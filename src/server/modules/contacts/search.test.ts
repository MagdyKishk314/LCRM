import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSearchTokens, searchConditions } from './search';

/** Would this search find a contact with these tokens? Mirrors what Mongo evaluates. */
function finds(search: string, tokens: string[]): boolean {
  const matches = (cond: Record<string, unknown>): boolean => {
    if (Array.isArray(cond.$or)) return (cond.$or as Record<string, unknown>[]).some(matches);
    return tokens.some((t) => (cond.searchTokens as RegExp).test(t));
  };
  const conditions = searchConditions(search);
  return conditions.length > 0 && conditions.every(matches);
}

const wayne = buildSearchTokens({
  firstName: 'Wayne',
  lastName: 'Kowalski-Smith',
  company: 'Ridgeline Land Co.',
  email: 'Wayne.K@Example.com',
  phone: '+1 (303) 555-0142',
  altPhones: ['719-555-0199'],
  property: { apn: '123-45-678' },
});

test('tokens are lowercased and deduplicated', () => {
  assert.ok(wayne.includes('wayne'));
  assert.ok(wayne.includes('wayne.k@example.com'));
  assert.equal(new Set(wayne).size, wayne.length);
});

test('a name prefix matches, in any case', () => {
  assert.ok(finds('way', wayne));
  assert.ok(finds('KOWAL', wayne));
});

test('first and last name together match — no single field holds both', () => {
  assert.ok(finds('wayne kowalski', wayne));
  assert.ok(!finds('wayne nakamura', wayne));
});

test('a phone is found however it is typed', () => {
  assert.ok(finds('(303) 555-0142', wayne));
  assert.ok(finds('3035550142', wayne));
  assert.ok(finds('13035550142', wayne));
  assert.ok(finds('555-0142', wayne));
  assert.ok(finds('0142', wayne));
  assert.ok(finds('7195550199', wayne), 'alternate numbers are searchable too');
});

test('an APN matches with or without its separators', () => {
  assert.ok(finds('123-45-678', wayne));
  assert.ok(finds('12345678', wayne));
  assert.ok(finds('123-45', wayne));
});

test('email and company match by prefix', () => {
  assert.ok(finds('wayne.k@', wayne));
  assert.ok(finds('ridgeline', wayne));
});

test('a fragment from the middle of a word does not match', () => {
  assert.ok(!finds('owalski', wayne));
});

test('regex metacharacters in the search are literal', () => {
  assert.ok(!finds('.*', wayne));
  assert.doesNotThrow(() => searchConditions('(303'));
});

test('nothing searchable yields no conditions', () => {
  assert.deepEqual(searchConditions(''), []);
  assert.deepEqual(searchConditions('   '), []);
  assert.deepEqual(searchConditions(undefined), []);
});

test('a contact with no searchable fields has no tokens', () => {
  assert.deepEqual(buildSearchTokens({}), []);
});
