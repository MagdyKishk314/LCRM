import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatPhone, isUsPhone, phoneDigits } from './phone';

test('every way of writing a US number normalises to the same digits', () => {
  for (const raw of ['(303) 555-0142', '303.555.0142', '+1 303 555 0142', '13035550142', '303-555-0142 ']) {
    assert.equal(phoneDigits(raw), '13035550142', raw);
  }
});

test('anything that is not a US number has no digits form', () => {
  assert.equal(phoneDigits('+44 20 7946 0958'), null);
  assert.equal(phoneDigits('555-0142'), null);
  assert.equal(phoneDigits(''), null);
  assert.equal(phoneDigits(undefined), null);
  assert.equal(isUsPhone('+44 20 7946 0958'), false);
});

test('display formatting is applied only to US numbers', () => {
  assert.equal(formatPhone('13035550142'), '(303) 555-0142');
  assert.equal(formatPhone('+44 20 7946 0958'), '+44 20 7946 0958');
  assert.equal(formatPhone(''), '');
});
