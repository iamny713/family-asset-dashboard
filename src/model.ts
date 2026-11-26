import { isFlowCategory } from './flow-categories.ts';

export type Position = {
  id: string; kind: 'asset' | 'debt'; name: string; group: string; amount: number;
  rate: number; payment: number; due: string; active: boolean; purchasePrice?: number;
};
export type Flow = { id: string; day: string; kind: 'income' | 'expense'; name: string; amount: number; category?: string; person?: string; account?: string };
export type Snapshot = { month: string; assets: number; debts: number };
export type History = { at: string; actor: string; action: string; target: string; before: string; after: string };
export type Ledger = { positions: Position[]; flows: Flow[]; snapshots: Snapshot[]; history: History[] };
export type Command =
  | { type: 'position'; value: Position }
  | { type: 'flow'; value: Flow }
  | { type: 'snapshot'; value: Snapshot };
export const emptyLedger = (): Ledger => ({ positions: [], flows: [], snapshots: [], history: [] });
export const monthNow = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit' }).format(new Date());
export const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

export function totals(positions: Position[]) {
  const assets = positions.filter(p => p.active && p.kind === 'asset').reduce((sum, p) => sum + p.amount, 0);
  const debts = positions.filter(p => p.active && p.kind === 'debt').reduce((sum, p) => sum + p.amount, 0);
  return { assets, debts, net: assets - debts };
}

export function cashflow(flows: Flow[], month: string) {
  const rows = flows.filter(f => f.day.slice(0, 7) === month);
  const income = rows.filter(f => f.kind === 'income').reduce((sum, f) => sum + f.amount, 0);
  const expense = rows.filter(f => f.kind === 'expense').reduce((sum, f) => sum + f.amount, 0);
  return { rows, income, expense, net: income - expense };
}

const isAmount = (value: number) => Number.isSafeInteger(value) && value >= 0;
function isDay(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function applyCommand(ledger: Ledger, command: Command, actor: string, at = new Date().toISOString()) {
  const value = command.value;
  let previous: typeof value | undefined;
  let target: string;
  const next = { ...ledger };
  switch (command.type) {
    case 'position': {
      const p = command.value;
      if (!p.id || !p.name.trim() || !p.group.trim() || !['asset', 'debt'].includes(p.kind) ||
          !isAmount(p.amount) || !isAmount(p.payment) || !Number.isFinite(p.rate) ||
          p.rate < 0 || p.rate > 100 || (p.purchasePrice !== undefined && !isAmount(p.purchasePrice)) || (p.due !== '' && !isDay(p.due))) throw new Error('자산·부채 입력을 확인하세요.');
      previous = ledger.positions.find(row => row.id === p.id);
      target = p.id;
      next.positions = [...ledger.positions.filter(row => row.id !== p.id), p];
      break;
    }
    case 'flow': {
      const f = command.value;
      if (!f.id || !f.name.trim() || !isDay(f.day) || !['income', 'expense'].includes(f.kind) ||
          !isAmount(f.amount) || f.amount === 0 || (f.category !== undefined && !isFlowCategory(f.kind, f.category))) throw new Error('현금흐름 입력을 확인하세요.');
      previous = ledger.flows.find(row => row.id === f.id);
      target = f.id;
      next.flows = [...ledger.flows.filter(row => row.id !== f.id), f];
      break;
    }
    case 'snapshot': {
      const s = command.value;
      if (!isDay(s.month + '-01') || !isAmount(s.assets) || !isAmount(s.debts)) throw new Error('스냅샷 입력을 확인하세요.');
      previous = ledger.snapshots.find(row => row.month === s.month);
      target = s.month;
      next.snapshots = [...ledger.snapshots.filter(row => row.month !== s.month), s];
      break;
    }
  }
  const history = { at, actor, action: command.type, target, before: previous ? JSON.stringify(previous) : '', after: JSON.stringify(value) };
  next.history = [...ledger.history, history];
  return { next, history };
}

export function offsetMonth(month: string, offset: number) {
  return new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)) - 1 + offset, 1))
    .toISOString().slice(0, 7);
}
