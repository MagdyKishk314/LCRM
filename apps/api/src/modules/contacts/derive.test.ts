import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deriveContactFields } from './derive';

test('phone digits are derived, and alternates never repeat the primary', () => {
  const d = deriveContactFields({
    phone: '(303) 555-0142',
    altPhones: ['303-555-0142', '719.555.0199', '+44 20 7946 0958'],
  });
  assert.equal(d.phoneDigits, '13035550142');
  assert.deepEqual(d.altPhoneDigits, ['17195550199']);
});

test('a non-US phone has no digits form', () => {
  assert.equal(deriveContactFields({ phone: '+44 20 7946 0958' }).phoneDigits, undefined);
});

test('a legacy single parcel is lifted into the array and becomes primary', () => {
  const d = deriveContactFields({ property: { apn: '123', county: 'Costilla', state: 'CO' } });
  assert.equal(d.properties.length, 1);
  assert.equal(d.properties[0]!.isPrimary, true);
  assert.ok(d.properties[0]!.id);
  assert.equal(d.property?.apn, '123');
});

test('exactly one parcel is primary — the one marked, else the first', () => {
  const marked = deriveContactFields({
    properties: [
      { id: 'a', apn: '1' },
      { id: 'b', apn: '2', isPrimary: true },
    ],
  });
  assert.deepEqual(marked.properties.map((p) => p.isPrimary), [false, true]);
  assert.equal(marked.property?.id, 'b');

  const unmarked = deriveContactFields({ properties: [{ id: 'a', apn: '1' }, { id: 'b', apn: '2' }] });
  assert.deepEqual(unmarked.properties.map((p) => p.isPrimary), [true, false]);
  assert.equal(unmarked.property?.id, 'a');
});

test('empty parcels are dropped and a contact can have none', () => {
  const d = deriveContactFields({ properties: [{ apn: '' }], property: { county: null } });
  assert.deepEqual(d.properties, []);
  assert.equal(d.property, undefined);
});

test('parcels keep their ids across a re-derive', () => {
  const first = deriveContactFields({ properties: [{ apn: '1' }] });
  const again = deriveContactFields({ properties: first.properties });
  assert.equal(again.properties[0]!.id, first.properties[0]!.id);
});
