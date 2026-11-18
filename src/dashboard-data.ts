import type { Ledger, Position } from './model.ts';

export type Row = {
  id: string;
  month: string;
  kind: 'income' | 'expense' | 'valuation' | 'purchase' | 'debt';
  category: string;
  title: string;
  person?: string;
  account?: string;
  day?: string;
  recordedAt?: string;
  amount: number;
  currentBalance?: boolean;
};

function assetCategory(group: string) {
  if (/부동산|주택|아파트|토지/.test(group)) return '부동산';
  if (/주식|증권|펀드|ETF/i.test(group)) return '주식';
  if (/현금|예금|적금|입출금|통장|저축|CMA/i.test(group)) return '현금';
  return '기타 자산';
}

const monthFormat = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit' });

function positionRow(position: Position, month: string): Row {
  return {
    id: position.id, month, kind: position.kind === 'debt' ? 'debt' : 'valuation',
    category: position.kind === 'debt' ? position.group : assetCategory(position.group),
    title: position.name, amount: position.amount,
  };
}

export function dashboardRows(ledger: Ledger, currentMonth: string): Row[] {
  const rows: Row[] = ledger.flows.map(flow => ({
    ...flow, month: flow.day.slice(0, 7), category: flow.category ?? '미분류', title: flow.name,
  }));

  for (const entry of [...ledger.history].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))) {
    if (entry.action !== 'position' || !Number.isFinite(Date.parse(entry.at))) continue;
    try {
      const value: Partial<Position> | null = JSON.parse(entry.after);
      if (!value || value.id !== entry.target || typeof value.name !== 'string' || !value.name ||
          typeof value.group !== 'string' || !value.group ||
          (value.kind !== 'asset' && value.kind !== 'debt') ||
          typeof value.amount !== 'number' || !Number.isSafeInteger(value.amount) || value.amount < 0) continue;
      const month = monthFormat.format(new Date(entry.at));
      const row = positionRow(value as Position, month);
      rows.push({ ...row, recordedAt: entry.at, amount: value.active === false ? 0 : row.amount });
    } catch {
      // Old history rows may contain plain-text descriptions.
    }
  }
  for (const position of ledger.positions) {
    const row = positionRow(position, currentMonth);
    rows.push({ ...row, amount: position.active ? row.amount : 0, currentBalance: true });
    if (row.category === '부동산' && position.purchasePrice !== undefined) {
      rows.push({ ...row, kind: 'purchase', amount: position.purchasePrice });
    }
  }
  return rows;
}
