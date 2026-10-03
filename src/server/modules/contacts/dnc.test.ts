import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isDoNotContact, reconcileDnc, type ContactStatus } from './dnc';

const STATUSES: ContactStatus[] = ['new', 'contacted', 'qualified', 'unqualified', 'do_not_call'];

test('either signal alone means do-not-contact', () => {
  assert.equal(isDoNotContact({ dnc: true, status: 'contacted' }), true);
  assert.equal(isDoNotContact({ dnc: false, status: 'do_not_call' }), true);
  assert.equal(isDoNotContact({ dnc: false, status: 'contacted' }), false);
  assert.equal(isDoNotContact({}), false);
});

test('every reconciled pair satisfies the invariant, whatever came in', () => {
  const changes = [
    {},
    { dnc: true },
    { dnc: false },
    ...STATUSES.map((status) => ({ status })),
    ...STATUSES.flatMap((status) => [
      { status, dnc: true },
      { status, dnc: false },
    ]),
  ];

  for (const dnc of [true, false]) {
    for (const status of STATUSES) {
      for (const change of changes) {
        const out = reconcileDnc({ dnc, status }, change);
        assert.equal(
          out.dnc,
          out.status === 'do_not_call',
          `from ${JSON.stringify({ dnc, status })} with ${JSON.stringify(change)}`,
        );
      }
    }
  }
});

test('asking for do-not-contact by either route sets both', () => {
  assert.deepEqual(reconcileDnc({ dnc: false, status: 'new' }, { dnc: true }), {
    dnc: true,
    status: 'do_not_call',
  });
  assert.deepEqual(reconcileDnc({ dnc: false, status: 'new' }, { status: 'do_not_call' }), {
    dnc: true,
    status: 'do_not_call',
  });
});

test('a contradictory request resolves to do-not-contact', () => {
  assert.deepEqual(
    reconcileDnc({ dnc: false, status: 'new' }, { status: 'do_not_call', dnc: false }),
    { dnc: true, status: 'do_not_call' },
  );
});

test('moving the status away lifts the flag', () => {
  assert.deepEqual(reconcileDnc({ dnc: true, status: 'do_not_call' }, { status: 'qualified' }), {
    dnc: false,
    status: 'qualified',
  });
});

test('clearing the flag moves a do-not-call status to contacted', () => {
  assert.deepEqual(reconcileDnc({ dnc: true, status: 'do_not_call' }, { dnc: false }), {
    dnc: false,
    status: 'contacted',
  });
});

test('an unrelated edit heals a drifted record towards do-not-contact', () => {
  assert.deepEqual(reconcileDnc({ dnc: true, status: 'contacted' }, {}), {
    dnc: true,
    status: 'do_not_call',
  });
  assert.deepEqual(reconcileDnc({ dnc: false, status: 'do_not_call' }, {}), {
    dnc: true,
    status: 'do_not_call',
  });
});

test('an unrelated edit leaves a clean record alone', () => {
  assert.deepEqual(reconcileDnc({ dnc: false, status: 'qualified' }, {}), {
    dnc: false,
    status: 'qualified',
  });
});
