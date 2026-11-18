import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCommand, cashflow, emptyLedger, totals } from '../src/model.ts';

const position = { id: 'savings', kind: 'asset', name: '예금', group: '예금', amount: 1000, rate: 0, payment: 0, due: '', active: true };
const record = (ledger, type, value) => applyCommand(ledger, { type, value }, '테스트').next;

test('asset and debt revisions replace balances and retain before/after history', () => {
  let ledger = record(emptyLedger(), 'position', position);
  ledger = record(ledger, 'position', { ...position, id: 'loan', kind: 'debt', amount: 300, due: '2030-02-28' });
  ledger = record(ledger, 'position', { ...position, amount: 1200 });
  assert.deepEqual(totals(ledger.positions), { assets: 1200, debts: 300, net: 900 });
  assert.equal(JSON.parse(ledger.history[2].before).amount, 1000);
  ledger = record(ledger, 'position', { ...position, active: false });
  assert.equal(totals(ledger.positions).net, -300);
});

test('cashflow is grouped by calendar month and rejects invalid dates', () => {
  const flow = { id: 'pay', day: '2026-11-01', kind: 'income', name: '급여', amount: 2500 };
  let ledger = record(emptyLedger(), 'flow', flow);
  ledger = record(ledger, 'flow', { ...flow, id: 'rent', kind: 'expense', amount: 700 });
  ledger = record(ledger, 'flow', { ...flow, id: 'past', day: '2026-10-31' });
  assert.equal(cashflow(ledger.flows, '2026-11').net, 1800);
  assert.throws(() => record(ledger, 'flow', { ...flow, day: '2026-11-31' }));
});

test('month-end revisions keep one snapshot per month', () => {
  let ledger = record(emptyLedger(), 'snapshot', { month: '2026-11', assets: 200, debts: 500 });
  ledger = record(ledger, 'snapshot', { month: '2026-11', assets: 300, debts: 500 });
  assert.deepEqual(ledger.snapshots, [{ month: '2026-11', assets: 300, debts: 500 }]);
  assert.equal(ledger.history.length, 2);
});

test('won amounts must be nonnegative safe integers', () => {
  for (const amount of [-1, 1.01, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => record(emptyLedger(), 'position', { ...position, amount }));
  }
});
