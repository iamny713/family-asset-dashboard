import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeRows } from '../src/sheets.ts';

function table(labels, rows) {
  return { status: 'ok', table: {
    cols: labels.split(' ').map(label => ({ label })),
    rows: rows.map(row => ({ c: row.map(v => v === null ? null : { v }) })),
  } };
}

test('sheet positions preserve amount and inactive rows', () => {
  const response = table('id kind name group amount rate payment due active', [
    ['loan-1', 'debt', '대출', '은행', 1300, 3.5, 100, 'Date(2030,0,2)', false],
    [null, null],
  ]);
  assert.deepEqual(decodeRows('자산부채', response).positions, [
    { id: 'loan-1', kind: 'debt', name: '대출', group: '은행', amount: 1300, rate: 3.5, payment: 100, due: '2030-01-02', active: false },
  ]);
});

test('sheet schema errors and invalid cells are surfaced', () => {
  assert.throws(() => decodeRows('월말스냅샷', table('month assets wrong', [])), /첫 행/);
  assert.throws(() => decodeRows('월말스냅샷', table('month assets debts', [['2026-11', null, 10]])), /2행/);
  assert.throws(() => decodeRows('현금흐름', table('id day kind name amount', [['a', '2026-11-31', 'income', '입금', 10]])), /2행/);
});
