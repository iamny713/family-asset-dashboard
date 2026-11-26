import { isFlowCategory } from './flow-categories.ts';
import { emptyLedger, type Flow, type History, type Ledger, type Position, type Snapshot } from './model.ts';

export const sheetUrl = 'https://docs.google.com/spreadsheets/d/1DkO-A0tAQS6825b1DRIEbntCuyRanRMNKKzWX8FV-TQ/edit';
const columns = {
  자산부채: ['id', 'kind', 'name', 'group', 'amount', 'rate', 'payment', 'due', 'active'],
  현금흐름: ['id', 'day', 'kind', 'name', 'amount'],
  월말스냅샷: ['month', 'assets', 'debts'],
  변경이력: ['at', 'actor', 'action', 'target', 'before', 'after'],
} as const;
const flowMetadata = ['category', 'person', 'account'] as const;
type Tab = keyof typeof columns;
const payrollColumns = ['월', '지급일', '구분', '항목', '금액'];
const payrollKinds = ['지급', '초과근무', '공제', '기지급', '보너스', '보너스 공제'] as const;
export type PayrollRow = {
  month: string;
  day: string;
  kind: typeof payrollKinds[number];
  name: string;
  amount: number;
};
type Cell = { v?: string | number | boolean | null; f?: string };
type Response = { status?: string; table?: { cols: { label: string }[]; rows: { c: (Cell | null)[] }[] } };

function query(tab: Tab | '급여명세서', signal: AbortSignal) {
  const width = tab === '급여명세서' ? payrollColumns.length
    : columns[tab].length + (tab === '현금흐름' ? flowMetadata.length : tab === '자산부채' ? 1 : 0);
  const url = new URL(sheetUrl.replace(/\/edit$/, '/gviz/tq'));
  url.search = new URLSearchParams({ sheet: tab, range: 'A:' + String.fromCharCode(64 + width), headers: '1',
    tqx: 'out:json;responseHandler:receiveLedger' }).toString();
  return new Promise<Response>((resolve, reject) => {
    signal.throwIfAborted();
    const frame = document.createElement('iframe');
    frame.hidden = true;
    frame.title = 'Google Sheets 데이터';
    frame.sandbox.add('allow-scripts');
    const finish = (response?: Response) => {
      window.clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      signal.removeEventListener('abort', abort);
      frame.remove();
      if (response?.status === 'ok' && response.table) resolve(response);
      else reject(new Error(tab + ' 탭을 읽지 못했습니다. 시트 공유 권한과 탭 이름을 확인하세요.'));
    };
    const abort = () => finish();
    const onMessage = (event: MessageEvent) => {
      if (event.source === frame.contentWindow && event.origin === 'null') finish(event.data);
    };
    const timer = window.setTimeout(() => finish(), 10000);
    window.addEventListener('message', onMessage);
    signal.addEventListener('abort', abort, { once: true });
    frame.srcdoc = '<script>function receiveLedger(data){parent.postMessage(data,"*")}</script>' +
      '<script referrerpolicy="no-referrer" src="' + url.href.replaceAll('&', '&amp;') +
      '" onerror="receiveLedger(null)"></script>';
    document.body.append(frame);
  });
}

const value = (cell?: Cell | null) => cell?.v ?? '';
const string = (cell?: Cell | null) => String(value(cell)).trim();
function date(cell?: Cell | null) {
  const raw = string(cell);
  const match = /^Date\((\d{4}),(\d{1,2}),(\d{1,2})(?:,.*)?\)$/.exec(raw);
  return match ? match[1] + '-' + String(Number(match[2]) + 1).padStart(2, '0') + '-' + match[3].padStart(2, '0') : raw;
}
const number = (cell?: Cell | null) => string(cell) === '' ? NaN : Number(value(cell));
const amount = (n: number) => Number.isSafeInteger(n) && n >= 0;
function day(s: string) {
  const time = Date.parse(s + 'T00:00:00Z');
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === s;
}
function optionalNumber(cell?: Cell | null) { return string(cell) === '' ? 0 : number(cell); }

export function decodeRows(tab: Tab, response: Response) {
  const table = response.table;
  if (!table || columns[tab].some((label, i) => table.cols[i]?.label.trim() !== label)) {
    throw new Error(tab + ' 탭의 첫 행이 원장 열 구성과 다릅니다.');
  }
  if (tab === '현금흐름' && flowMetadata.some((label, i) => {
    const column = table.cols[columns[tab].length + i]?.label.trim();
    return column && column !== label;
  })) throw new Error(tab + ' 탭의 선택 열은 category, person, account 순서여야 합니다.');
  const ledger = emptyLedger();
  const keys = new Set<string>();
  table.rows.forEach(({ c }, index) => {
    if (c.every(cell => string(cell) === '')) return;
    const id = string(c[0]);
    const invalid = () => new Error(tab + ' 탭 ' + (index + 2) + '행의 값을 확인하세요.');
    if (!id || (tab !== '변경이력' && keys.has(id))) throw invalid();
    keys.add(id);
    if (tab === '자산부채') {
      const [, kind, name, group, balance, interest, repayment, due, active] = c;
      const p = { id, kind: string(kind), name: string(name), group: string(group), amount: number(balance),
        rate: optionalNumber(interest), payment: optionalNumber(repayment), due: date(due),
        active: string(active).toLowerCase() !== 'false' };
      if (!['asset', 'debt'].includes(p.kind) || !p.name || !p.group || !amount(p.amount) || !amount(p.payment) ||
          !Number.isFinite(p.rate) || p.rate < 0 || p.rate > 100 || (p.due && !day(p.due)) ||
          !['', 'true', 'false'].includes(string(active).toLowerCase())) throw invalid();
      const position = p as Position;
      const purchaseIndex = columns.자산부채.length;
      if (table.cols[purchaseIndex]?.label.trim() === 'purchasePrice' && string(c[purchaseIndex])) {
        const price = number(c[purchaseIndex]);
        if (!amount(price)) throw invalid();
        position.purchasePrice = price;
      }
      ledger.positions.push(position);
    }
    if (tab === '현금흐름') {
      const f = { id, day: date(c[1]), kind: string(c[2]), name: string(c[3]), amount: number(c[4]) };
      if (!day(f.day) || !['income', 'expense'].includes(f.kind) || !f.name || !amount(f.amount) || f.amount === 0) throw invalid();
      const flow = f as Flow;
      for (const [i, field] of flowMetadata.entries()) {
        const cellIndex = columns.현금흐름.length + i;
        if (table.cols[cellIndex]?.label.trim() !== field) continue;
        const metadata = string(c[cellIndex]);
        if (field === 'category' && metadata && !isFlowCategory(flow.kind, metadata)) throw invalid();
        if (metadata) flow[field] = metadata;
      }
      ledger.flows.push(flow);
    }
    if (tab === '월말스냅샷') {
      const s: Snapshot = { month: date(c[0]).slice(0, 7), assets: number(c[1]), debts: number(c[2]) };
      if (!/^\d{4}-\d{2}(?:-\d{2})?$/.test(date(c[0])) || !day(s.month + '-01') ||
          !amount(s.assets) || !amount(s.debts) || ledger.snapshots.some(row => row.month === s.month)) throw invalid();
      ledger.snapshots.push(s);
    }
    if (tab === '변경이력') {
      const h: History = { at: string(c[0]), actor: string(c[1]), action: string(c[2]), target: string(c[3]),
        before: string(c[4]), after: string(c[5]) };
      if (!Number.isFinite(Date.parse(h.at)) || !h.actor || !h.action || !h.target) throw invalid();
      ledger.history.push(h);
    }
  });
  return ledger;
}

export async function readSharedLedger(signal: AbortSignal): Promise<Ledger> {
  const [positions, flows, snapshots, history] = await Promise.all(
    (Object.keys(columns) as Tab[]).map(async tab => decodeRows(tab, await query(tab, signal))),
  );
  return { positions: positions.positions, flows: flows.flows, snapshots: snapshots.snapshots, history: history.history };
}

export function decodePayrollRows(response: Response): PayrollRow[] {
  const table = response.table;
  if (!table || payrollColumns.some((label, i) => table.cols[i]?.label.trim() !== label)) {
    throw new Error('급여명세서 탭의 첫 행을 확인하세요.');
  }
  return table.rows.flatMap(({ c }, i) => {
    if (c.every(cell => string(cell) === '')) return [];
    const month = date(c[0]).slice(0, 7);
    const paymentDay = date(c[1]);
    const kind = payrollKinds.find(kind => kind === string(c[2]));
    const name = string(c[3]);
    const amount = number(c[4]);
    if (!day(month + '-01') || !day(paymentDay) || !kind || !name || !Number.isSafeInteger(amount)) {
      throw new Error('급여명세서 탭 ' + (i + 2) + '행의 값을 확인하세요.');
    }
    return [{ month, day: paymentDay, kind, name, amount }];
  });
}

export async function readPayroll(signal: AbortSignal) {
  return decodePayrollRows(await query('급여명세서', signal));
}
