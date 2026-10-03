import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  contactFilterToParams,
  countContactFilterConditions,
  describeContactFilter,
  isEmptyContactFilter,
  parseContactFilter,
} from './contact-filter';

test('a URL and a stored filter parse to the same shape', () => {
  const fromUrl = parseContactFilter({
    status: 'new,qualified',
    tags: 'callback, motivated',
    state: 'co',
    acresMin: '5',
    dnc: 'false',
    'cf.zoning': 'A-1',
  });
  const fromList = parseContactFilter({
    status: ['new', 'qualified'],
    tags: ['callback', 'motivated'],
    state: ['CO'],
    acresMin: 5,
    dnc: false,
    customFields: { zoning: 'A-1' },
  });
  assert.deepEqual(fromUrl, fromList);
});

test('empty, blank and unknown inputs are dropped', () => {
  const parsed = parseContactFilter({
    search: '  ',
    status: '',
    tags: ',',
    acresMax: 'abc',
    nonsense: 'x',
    createdAfter: 'not a date',
    'cf.a.b': 'unsafe key',
  });
  assert.deepEqual(parsed, {});
  assert.equal(isEmptyContactFilter(parsed), true);
});

test('an unknown status is ignored rather than failing the filter', () => {
  assert.deepEqual(parseContactFilter({ status: 'new,bogus' }), { status: ['new'] });
});

test('the older singular `tag` key still works', () => {
  assert.deepEqual(parseContactFilter({ tag: 'callback' }), { tags: ['callback'] });
});

test('a filter survives the round trip through URL params', () => {
  const filter = parseContactFilter({
    search: 'smith',
    status: ['qualified'],
    county: ['Costilla', 'Alamosa'],
    acresMin: 5,
    acresMax: 40,
    ownerId: 'me',
    hasEmail: true,
    activityAfter: '2026-01-01',
    customFields: { zoning: 'A-1', road_access: true },
  });
  assert.deepEqual(parseContactFilter(contactFilterToParams(filter)), filter);
});

test('conditions are counted per clause', () => {
  assert.equal(countContactFilterConditions({}), 0);
  assert.equal(
    countContactFilterConditions({ status: ['new'], tags: ['a', 'b'], tagMode: 'all', customFields: { x: '1', y: '2' } }),
    4,
  );
});

test('a filter is described in words', () => {
  const clauses = describeContactFilter(
    {
      status: ['qualified', 'contacted'],
      county: ['Costilla'],
      acresMin: 5,
      acresMax: 40,
      tags: ['callback'],
      ownerId: 'u1',
      listId: 'l1',
    },
    { owners: { u1: 'Marcus Ortega' }, lists: { l1: 'Hot leads' } },
  );
  assert.deepEqual(clauses, [
    'status is Qualified or Contacted',
    'tagged callback',
    'Costilla County',
    '5–40 acres',
    'owned by Marcus Ortega',
    'in list Hot leads',
  ]);
});
