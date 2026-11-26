import { monthNow, type History, type Snapshot } from './model';
import { readSharedLedger } from './sheets';
import { dashboardRows, type Row } from './dashboard-data';
import './style.css';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const currentMonth = monthNow();
const monthInput = $<HTMLInputElement>('month');
let ledger: Row[] = [];
let snapshots: Snapshot[] = [];
let monthlyNotes: History[] = [];
const requestedMonth = new URLSearchParams(window.location.search).get('month');
monthInput.value = requestedMonth && /^\d{4}-(?:0[1-9]|1[0-2])$/.test(requestedMonth)
  ? requestedMonth
  : currentMonth;
const won = (value: number) => Number(value).toLocaleString('ko-KR') + '원';
const labels = {income:'수입',expense:'지출',valuation:'평가',purchase:'매입',debt:'부채 잔액'};
const sum = (rows: Row[]) => rows.reduce((total,row) => total + row.amount,0);
const isFinancialAsset = (row: Row) => row.kind === 'valuation' && row.category !== '부동산';
function latest(rows: Row[]) {
  const records = new Map<string, Row>();
  for (const row of rows) {
    const id = row.kind + ':' + row.id;
    const existing = records.get(id);
    if (!existing || existing.month <= row.month) records.set(id,row);
  }
  return [...records.values()];
}
function describe(row: Row) {
  return [row.month,labels[row.kind],row.category,row.person,row.account,row.title !== row.account ? row.title : ''].filter(Boolean).join(' · ');
}
function append<K extends keyof HTMLElementTagNameMap>(container: HTMLElement, tag: K, text: string) {
  const node = document.createElement(tag);
  node.textContent = text;
  container.append(node);
  return node;
}
function line(container: HTMLElement, label: string, value: string, definition = false) {
  const item = document.createElement('div');
  if (!definition) item.className = 'entry';
  append(item,definition ? 'dt' : 'span',label);
  append(item,definition ? 'dd' : 'strong',value);
  container.append(item);
  return item;
}
function bar(container: HTMLElement, value: number, max: number, color: string) {
  const track = append(container,'div','');
  track.className = 'bar-track';
  track.setAttribute('aria-hidden','true');
  const fill = append(track,'span','');
  fill.className = 'bar-fill ' + color;
  fill.style.width = (max ? value / max * 100 : 0) + '%';
}
function grouped(id: string, rows: Row[], field: 'person' | 'category') {
  const node = $(id);
  node.replaceChildren();
  const groups = new Map<string, { income: number; expense: number }>();
  for (const row of rows) {
    const name = row[field] || '공동·미지정';
    const values = groups.get(name) || {income:0,expense:0};
    if (row.kind === 'income' || row.kind === 'expense') values[row.kind] += row.amount;
    groups.set(name,values);
  }
  const max = Math.max(0,...[...groups.values()].flatMap(value => [value.income,value.expense]));
  for (const [name,amounts] of groups) {
    const item = append(node,'div','');
    item.className = 'visual-row';
    append(item,'dt',name);
    const detail = append(item,'dd','');
    for (const kind of ['income','expense'] as const) {
      if (!amounts[kind]) continue;
      append(detail,'small',labels[kind] + ' ' + won(amounts[kind]));
      bar(detail,amounts[kind],max,kind);
    }
  }
  if (!groups.size) line(node,'기록 없음','—',true);
}
function portfolio(balances: Row[], includeProperty: boolean) {
  const rows = balances.filter(row => includeProperty ? row.kind === 'valuation' : isFinancialAsset(row));
  const chart = $('allocation');
  chart.replaceChildren();
  const categories = [['부동산','#173b79'], ['주식','#356cd2'], ['현금','#78a8f4'], ['적금','#087e75'], ['기타 자산','#8193ad']];
  const groups = categories.flatMap(([category, color]) => {
    const items = rows.filter(row => row.category === category);
    return items.length ? [{category, color, amount: sum(items)}] : [];
  });
  const total = groups.reduce((value,group) => value + group.amount,0);
  if (!total) { append(chart,'p','평가 기록 없음'); return; }
  const stack = append(chart,'div','');
  stack.className = 'allocation';
  stack.setAttribute('aria-hidden','true');
  const picks = append(chart,'div','');
  picks.className = 'portfolio-picks';
  for (const {category,color,amount} of groups) {
    const ratio = amount / total * 100;
    const segment = append(stack,'span','');
    segment.style.width = ratio + '%';
    segment.style.backgroundColor = color;
    const summary = append(picks,'div','');
    const name = append(summary,'span','');
    const dot = append(name,'span','');
    dot.className = 'dot';
    dot.style.backgroundColor = color;
    append(name,'span',category);
    append(summary,'strong',ratio.toFixed(1) + '% · ' + won(amount));
  }
}
function flowChart(id: string, income: number, expense: number) {
  const node = $(id);
  node.replaceChildren();
  const max = Math.max(income,expense);
  for (const [kind,value] of [['income',income],['expense',expense]] as const) {
    line(node,labels[kind],won(value));
    bar(node,value,max,kind);
  }
  const balance = append(node,'p','남은 금액 ' + won(income-expense));
  balance.className = 'flow-total';
}
function renderTransactions(rows: Row[]) {
  const node = $('entries');
  node.replaceChildren();
  node.className = 'transaction-groups';
  for (const kind of ['income','expense'] as const) {
    const items = rows.filter(row => row.kind === kind).sort((a,b) => b.amount-a.amount);
    const group = append(node,'section','');
    group.className = 'transaction-group';
    group.dataset.kind = kind;
    const heading = append(group,'div','');
    heading.className = 'transaction-heading';
    append(heading,'h3',labels[kind] + ' · ' + items.length + '건');
    const prefix = kind === 'income' ? '+' : '−';
    const signed = (amount: number) => (amount ? prefix : '') + won(amount);
    append(heading,'strong',signed(sum(items))).className = 'transaction-total';
    if (!items.length) {
      append(group,'p',labels[kind] + ' 기록이 없습니다.').className = 'transaction-empty';
      continue;
    }
    const list = append(group,'ul','');
    list.className = 'transaction-list';
    for (const row of items) {
      const item = append(list,'li','');
      item.className = 'transaction';
      const label = append(item,'div','');
      label.className = 'transaction-label';
      append(label,'strong',row.title || row.category);
      const details = append(label, 'div', '');
      details.className = 'transaction-details';
      if (row.category && row.category !== row.title) {
        append(details, 'span', row.category).className = 'category-badge';
      }
      append(details, 'small', [row.person, row.account, row.day].filter(Boolean).join(' · ') || '공동·미지정');
      append(item,'strong',signed(row.amount)).className = 'transaction-amount';
    }
  }
}
function renderDebtBalances(container: HTMLElement, rows: Row[], snapshot?: Snapshot, chart = false) {
  container.replaceChildren();
  const total = sum(rows);
  const max = chart ? Math.max(0, ...rows.map(row => row.amount)) : 0;
  if (rows.length) {
    for (const row of rows) {
      const label = row.month === monthInput.value ? row.title : row.title + ' (' + row.month + ' 기록)';
      line(container, label, won(row.amount), !chart);
      if (chart) bar(container, row.amount, max, 'debt-fill');
    }
    line(container, '기록된 부채 합계', won(total), !chart);
  } else {
    line(container, '조회 월까지 개별 부채 잔액 기록이 없습니다.', '—', !chart);
  }
  if (snapshot && (!rows.length || snapshot.debts !== total)) {
    line(container, '월말 스냅샷 총부채', won(snapshot.debts), !chart);
  }
}
function renderDelta(deltaChart: HTMLElement, deltas: {label: string; value: number}[]) {
  deltaChart.replaceChildren();
  const max = Math.max(0,...deltas.map(row => Math.abs(row.value)));
  if (!deltas.length) append(deltaChart,'p','전월과 비교할 기록이 없습니다.');
  else append(deltaChart,'small','감소 ← 0 → 증가');
  for (const {label,value} of deltas) {
    line(deltaChart,label,(value > 0 ? '+' : '') + won(value));
    const track = append(deltaChart,'div','');
    track.className = 'delta-track';
    track.setAttribute('aria-hidden','true');
    const fill = append(track,'span','');
    fill.className = 'bar-fill ' + (value < 0 ? 'expense' : 'income');
    const width = max ? Math.abs(value) / max * 50 : 0;
    fill.style.width = width + '%';
    fill.style.left = (value < 0 ? 50-width : 50) + '%';
  }
}
const debtDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', dateStyle: 'short' });
function renderDebtHistory(month: string) {
  const history = $('debt-history');
  const chart = $('debt-trend');
  history.replaceChildren();
  chart.replaceChildren();

  const records = ledger.filter(row => row.kind === 'debt' && row.month <= month);
  const previous = new Map<string, Row>();
  const events = records.flatMap(row => {
    const before = previous.get(row.id);
    previous.set(row.id, row);
    if (row.currentBalance && before?.amount === row.amount) return [];
    const date = row.recordedAt ? debtDate.format(new Date(row.recordedAt)) : row.month;
    const label = date + ' · ' + row.title + (row.currentBalance ? ' · 원장 잔액' : '');
    const value = before && before.amount !== row.amount
      ? won(before.amount) + ' → ' + won(row.amount)
      : won(row.amount);
    return [{ label, value }];
  });
  for (const event of events.reverse()) {
    line(history, event.label, event.value, true);
  }
  if (!history.childElementCount) line(history, '조회 월까지 기록이 없습니다.', '—', true);

  const observedMonths = new Set(records.map(row => row.month));
  const monthEnd = new Map(snapshots.filter(row => row.month < currentMonth).map(row => [row.month, row.debts]));
  for (const key of monthEnd.keys()) if (key <= month) observedMonths.add(key);
  const points = [...observedMonths].sort().slice(-12).map(key => ({
    month: key,
    amount: monthEnd.get(key) ?? sum(latest(records.filter(row => row.month <= key))),
    snapshot: monthEnd.has(key),
  }));
  if (points.length) {
    plotTrend(chart, points);
    if (points.some(point => point.snapshot)) {
      append(chart, 'small', '월말 스냅샷이 있는 달은 스냅샷 총부채 기준');
    }
  } else {
    append(chart, 'p', '조회 월까지 부채 잔액 기록이 없습니다.');
  }
}
function renderCashflowTrend(month: string) {
  const chart = $('cashflow-trend');
  chart.replaceChildren();
  const totals = new Map<string, { income: number; expense: number }>();
  for (const row of ledger) {
    if (row.month > month || (row.kind !== 'income' && row.kind !== 'expense')) continue;
    const values = totals.get(row.month) ?? { income: 0, expense: 0 };
    values[row.kind] += row.amount;
    totals.set(row.month, values);
  }
  const months = [...totals.keys()].sort((a, b) => b.localeCompare(a)).slice(0, 12);
  if (!months.length) {
    append(chart, 'p', '조회 월까지 수입·지출 기록이 없습니다.');
    return;
  }
  const max = Math.max(...months.flatMap(key => {
    const { income, expense } = totals.get(key)!;
    return [income, expense];
  }));
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(1, max / 4)));
  const step = Math.ceil(max / 4 / magnitude) * magnitude;
  const ceiling = step * 4;
  const compact = new Intl.NumberFormat('ko-KR', { notation: 'compact', maximumFractionDigits: 1 });
  const legend = append(chart, 'div', '');
  legend.className = 'legend';
  for (const kind of ['income', 'expense'] as const) {
    const item = append(legend, 'span', '');
    append(item, 'i', '').className = 'dot ' + kind;
    append(item, 'span', labels[kind]);
  }
  const scroll = append(chart, 'div', '');
  scroll.className = 'cashflow-chart-scroll';
  const graph = append(scroll, 'div', '');
  graph.className = 'cashflow-chart';
  graph.style.gridTemplateColumns = 'max-content repeat(' + months.length + ', minmax(184px, 1fr))';
  const axis = append(graph, 'div', '');
  axis.className = 'cashflow-chart-axis';
  axis.setAttribute('aria-hidden', 'true');
  for (let tick = 4; tick >= 0; tick--) append(axis, 'span', compact.format(step * tick) + '원');

  for (const key of months) {
    const group = append(graph, 'div', '');
    group.className = 'cashflow-trend-month';
    const columns = append(group, 'div', '');
    columns.className = 'cashflow-bars';
    const values = totals.get(key)!;
    for (const kind of ['income', 'expense'] as const) {
      const column = append(columns, 'div', '');
      column.className = 'cashflow-column ' + kind;
      column.style.height = (ceiling ? values[kind] / ceiling * 100 : 0) + '%';
      column.title = key + ' ' + labels[kind] + ' ' + won(values[kind]);
      column.setAttribute('role', 'img');
      column.setAttribute('aria-label', column.title);
      const amount = append(column, 'span', won(values[kind]));
      amount.className = 'cashflow-column-amount';
      amount.setAttribute('aria-hidden', 'true');
    }
    append(group, 'small', key);
  }
}

type IncomeAmounts = [number, number, number];
const incomeCategories = ['급여', '보너스', '주식 보상·판매'] as const;
const totalIncome = (values: IncomeAmounts) => values.reduce((total, value) => total + value, 0);

function offsetMonth(month: string, offset: number) {
  return new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)) - 1 + offset, 1))
    .toISOString().slice(0, 7);
}

function plotPersonalIncome(chart: HTMLElement, periods: { label: string; values?: IncomeAmounts }[]) {
  if (!periods.some(({ values }) => values)) {
    append(chart, 'p', '조회 월까지 유한의 소득 기록이 없습니다.');
    return;
  }
  const colors = ['income', 'personal-bonus', 'personal-stock'];
  const legend = append(chart, 'div', '');
  legend.className = 'legend';
  incomeCategories.forEach((category, index) => {
    const item = append(legend, 'span', '');
    append(item, 'i', '').className = 'dot ' + colors[index];
    append(item, 'span', category);
  });
  const max = Math.max(1, ...periods.map(({ values }) => values ? totalIncome(values) : 0));
  const scroll = append(chart, 'div', '');
  scroll.className = 'cashflow-chart-scroll';
  const graph = append(scroll, 'div', '');
  graph.className = 'cashflow-chart';
  graph.style.gridTemplateColumns = 'repeat(' + periods.length + ', minmax(110px, 1fr))';
  for (const { label, values } of periods) {
    const group = append(graph, 'div', '');
    group.className = 'cashflow-trend-month';
    const columns = append(group, 'div', '');
    columns.className = 'cashflow-bars';
    if (!values) {
      append(columns, 'small', '기록 없음');
      append(group, 'small', label);
      continue;
    }
    const total = totalIncome(values);
    const stack = append(columns, 'div', '');
    stack.className = 'personal-income-stack';
    stack.style.height = total / max * 100 + '%';
    stack.setAttribute('role', 'img');
    stack.setAttribute('aria-label', label + ' 소득 합계 ' + won(total) + ' · ' +
      incomeCategories.map((category, index) => category + ' ' + won(values[index])).join(' · '));
    incomeCategories.forEach((category, index) => {
      if (!values[index]) return;
      const segment = append(stack, 'div', '');
      segment.className = colors[index];
      segment.style.height = values[index] / total * 100 + '%';
      segment.title = category + ' ' + won(values[index]);
    });
    append(stack, 'span', won(total)).className = 'cashflow-column-amount';
    append(group, 'small', label);
  }
}

function renderPersonalIncome(month: string) {
  const chart = $('salary-trend');
  const summary = $('salary-summary');
  chart.replaceChildren();
  summary.replaceChildren();

  const incomeChart = $('personal-income-trend');
  const incomeSummary = $('personal-income-summary');
  incomeChart.replaceChildren();
  incomeSummary.replaceChildren();
  const totals = new Map<string, IncomeAmounts>();
  for (const row of ledger) {
    if (row.kind !== 'income' || row.person !== '유한' || row.month > month) continue;
    const stockCompensation = row.category === '주식 보너스 판매' ||
      (row.category === '보너스' && /주식|RSU/i.test(row.title));
    const index = stockCompensation ? 2 : incomeCategories.findIndex(category => category === row.category);
    if (index < 0) continue;
    const values = totals.get(row.month) ?? [0, 0, 0];
    values[index] += row.amount;
    totals.set(row.month, values);
  }
  const months = [...totals.keys()].sort();
  plotPersonalIncome(incomeChart, Array.from({ length: 6 }, (_, index) => {
    const key = offsetMonth(month, -index);
    return { label: key, values: totals.get(key) };
  }));
  const annual = new Map<string, IncomeAmounts>();
  for (const key of months) {
    const year = key.slice(0, 4);
    const values = totals.get(key)!;
    const amounts = annual.get(year) ?? [0, 0, 0];
    values.forEach((amount, index) => { amounts[index] += amount; });
    annual.set(year, amounts);
  }
  const annualChart = $('personal-income-annual');
  annualChart.replaceChildren();
  const selectedYear = month.slice(0, 4);
  plotPersonalIncome(annualChart, [...annual].map(([year, values]) => ({
    label: year === selectedYear && !month.endsWith('-12')
      ? year + '년 ' + Number(month.slice(5)) + '월까지'
      : year + '년',
    values,
  })));
  if (annual.size) append(annualChart, 'small', '원장에 기록된 소득 합계');
  const breakdown = totals.get(month);
  if (breakdown) {
    line(incomeSummary, month + ' 소득 합계', won(totalIncome(breakdown)), true)
      .className = 'asset-metric asset-metric-current';
    incomeCategories.forEach((category, index) => {
      line(incomeSummary, category, won(breakdown[index]), true).className = 'asset-metric';
    });
  } else {
    append(incomeChart, 'small', month + ' 소득 기록이 없습니다.');
  }

  const points = [...totals.entries()].filter(([, values]) => values[0] > 0)
    .sort(([a], [b]) => a.localeCompare(b)).slice(-12)
    .map(([key, values]) => ({ month: key, amount: values[0] }));
  if (points.length) plotTrend(chart, points);
  else append(chart, 'p', '조회 월까지 유한의 급여 기록이 없습니다.');

  const amount = totals.get(month)?.[0] || undefined;
  const previousMonth = offsetMonth(month, -1);
  const previousAmount = totals.get(previousMonth)?.[0] || undefined;
  line(summary, month + ' 급여', amount === undefined ? '기록 없음' : won(amount), true)
    .className = 'asset-metric asset-metric-current';
  if (amount !== undefined && previousAmount !== undefined) {
    const difference = amount - previousAmount;
    line(summary, '전월 대비', (difference > 0 ? '+' : '') + won(difference), true).className = 'asset-metric';
  }
  if (points.length) {
    const average = points.reduce((total, point) => total + point.amount, 0) / points.length;
    line(summary, points.length + '개 기록 월 평균', won(Math.round(average)), true).className = 'asset-metric';
  }
}

function renderMonthlyNotes(month: string) {
  for (const kind of ['income', 'expense']) {
    const target = month + ':' + kind;
    const note = monthlyNotes.find(entry => entry.target === target);
    $(kind + '-note').textContent = note?.after || '등록된 메모가 없습니다.';
  }
}

function render() {
  const month = monthInput.value;
  renderMonthlyNotes(month);
  const monthRows = ledger.filter(row => row.month === month);
  const flow = monthRows.filter(row => ['income','expense'].includes(row.kind));
  const income = sum(flow.filter(row => row.kind === 'income'));
  const expense = sum(flow.filter(row => row.kind === 'expense'));
  const balances = latest(ledger.filter(row => row.month <= month && ['valuation','debt'].includes(row.kind)));
  const snapshot = month === currentMonth ? undefined : snapshots.find(row => row.month === month);
  const assets = snapshot?.assets ?? sum(balances.filter(row => row.kind === 'valuation'));
  const includeProperty = includePropertySwitch.checked;
  const displayedAssets = includeProperty ? assets : sum(balances.filter(isFinancialAsset));
  const debtRows = balances.filter(row => row.kind === 'debt' && row.amount > 0);
  const debts = snapshot?.debts ?? sum(debtRows);
  renderDebtBalances($('debt-balances'), debtRows, snapshot, true);
  $('totals').replaceChildren();
  const metrics = [
    ['총자산', displayedAssets, 'asset'],
    ['순자산', assets - debts, 'net'],
    ['총부채', debts, 'debt'],
    ['조회 월 수입', income, 'income'],
    ['조회 월 지출', expense, 'expense'],
  ] as const;
  for (const [label, value, kind] of metrics) {
    const tile = append($('totals'), 'div', '');
    tile.className = 'metric';
    tile.dataset.kind = kind;
    append(tile, 'small', label).className = 'metric-label';
    append(tile, 'strong', won(value));
  }
  const assetScope = includeProperty ? '총자산에 부동산 포함' : '총자산에 부동산 제외 · 순자산은 전체 자산 기준';
  append($('totals'), 'small', assetScope + (snapshot ? ' · 월말 스냅샷 적용' : '')).className = 'metric-note';
  grouped('people',flow,'person');
  grouped('categories',flow,'category');
  renderAssetTotalTrend(month, includeProperty);
  portfolio(balances, includeProperty);
  flowChart('flow-chart',income,expense);
  flowChart('monthly-flow',income,expense);
  renderCashflowTrend(month);
  renderPersonalIncome(month);
  renderTransactions(flow);
  $('changes').replaceChildren();
  const priorMonth = new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7))-2,1)).toISOString().slice(0,7);
  const compare = (row: Row) => latest(ledger.filter(item => item.kind === row.kind && item.id === row.id && item.month <= priorMonth))[0];
  const changes = latest(monthRows.filter(row => row.kind === 'valuation'))
    .filter(row => !row.currentBalance || (compare(row) && compare(row).amount !== row.amount) ||
      monthRows.some(item => item.kind === row.kind && item.id === row.id && !item.currentBalance));
  const deltas = changes.flatMap(row => {
    const prior = compare(row);
    return prior?.month === priorMonth ? [{label:row.category + ' · ' + row.title, value:row.amount-prior.amount}] : [];
  });
  renderDelta($('monthly-delta'), deltas);
  const debtDeltas = balances.filter(row => row.kind === 'debt').flatMap(row => {
    const previous = compare(row);
    return previous ? [{label: row.title, value: row.amount - previous.amount}] : [];
  });
  renderDelta($('monthly-debt-delta'), debtDeltas);
  renderDebtHistory(month);
  for (const row of changes) {
    line($('changes'),describe(row),won(row.amount));
    const previous = compare(row);
    if (previous) {
      const delta = row.amount - previous.amount;
      append($('changes'),'p','이전 기록(' + previous.month + ') 대비 ' + (delta > 0 ? '+' : '') + won(delta)).className = 'delta';
    }
  }
  if (!changes.length) append($('changes'),'p','이 달에 자산 변경 기록이 없습니다.');
  renderAssetTrends(month);
}
type TrendPoint = { month: string; amount: number };

function plotTrend(node: HTMLElement, rows: TrendPoint[], reference?: number) {
  const first = rows[0];
  const last = rows[rows.length - 1];
  const values = rows.map(row => row.amount);
  if (reference !== undefined) values.push(reference);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const pad = Math.max(1,(high-low)*.12,high*.005);
  const min = Math.max(0,low-pad);
  const max = high+pad;
  const y = (value: number) => 90 - (value-min)/(max-min)*80;
  const monthIndex = (month: string) => Number(month.slice(0,4))*12+Number(month.slice(5,7));
  const duration = monthIndex(last.month)-monthIndex(first.month);
  const x = (row: TrendPoint) => duration ? 8 + (monthIndex(row.month)-monthIndex(first.month))/duration*184 : 100;
  const graph = document.createElementNS('http://www.w3.org/2000/svg','svg');
  graph.setAttribute('viewBox','0 0 200 100');
  graph.setAttribute('preserveAspectRatio','none');
  graph.setAttribute('class','trend-svg');
  graph.setAttribute('role','img');
  graph.setAttribute('aria-label',rows.map(row => row.month + ' ' + won(row.amount)).join(', ') + (reference !== undefined ? ', 매입가 ' + won(reference) : ''));
  const mark = (tag: string, attrs: Record<string, string | number>) => {
    const item = document.createElementNS('http://www.w3.org/2000/svg',tag);
    for (const [key,value] of Object.entries(attrs)) item.setAttribute(key,String(value));
    graph.append(item);
  };
  for (const level of [10,50,90]) mark('line',{x1:8,x2:192,y1:level,y2:level,stroke:'currentColor',class:'trend-grid','vector-effect':'non-scaling-stroke'});
  if (reference !== undefined) mark('line',{x1:8,x2:192,y1:y(reference),y2:y(reference),stroke:'#9b6d33','stroke-dasharray':'4 4','vector-effect':'non-scaling-stroke'});
  mark('polyline',{points:rows.map(row => x(row)+','+y(row.amount)).join(' '),fill:'none',stroke:'currentColor',class:'trend-path','stroke-width':2,'vector-effect':'non-scaling-stroke'});
  for (const row of rows) mark('line',{x1:x(row),x2:x(row),y1:y(row.amount)-.1,y2:y(row.amount)+.1,stroke:'currentColor',class:'trend-path','stroke-width':6,'stroke-linecap':'round','vector-effect':'non-scaling-stroke'});
  node.append(graph);
  const ticks = append(node,'div','');
  ticks.className = 'trend-labels';
  ticks.style.gridTemplateColumns = 'repeat(' + rows.length + ',minmax(0,1fr))';
  for (const row of rows) {
    const tick = append(ticks,'span',row.month);
    append(tick,'br','');
    append(tick,'small',won(row.amount));
  }
}

function renderAssetTotalTrend(month: string, includeProperty: boolean) {
  const node = $('total-asset-trend');
  const context = $('total-asset-context');
  node.replaceChildren();
  context.replaceChildren();

  const title = includeProperty ? '총자산' : '금융자산';
  $('total-asset-title').textContent = '월별 ' + title + ' 추이';
  const valuations = ledger.filter(row => row.kind === 'valuation' && row.month <= month);
  const inScope = (row: Row) => includeProperty || isFinancialAsset(row);
  const monthEnd = new Map(includeProperty
    ? snapshots.filter(row => row.month < currentMonth && row.month <= month).map(row => [row.month, row.assets] as const)
    : []);
  const months = new Set([...valuations.filter(inScope).map(row => row.month), ...monthEnd.keys()]);
  const points = [...months].sort().slice(-12).map(key => ({
    month: key,
    amount: monthEnd.get(key) ?? sum(latest(valuations.filter(row => row.month <= key)).filter(inScope)),
  }));
  const last = points.at(-1);
  if (!last) {
    append(node, 'p', '조회 월까지 ' + title + ' 평가 기록이 없습니다.');
    return;
  }
  plotTrend(node, points);
  line(context, last.month + ' ' + title, won(last.amount), true);
  const previous = points.at(-2);
  if (previous) {
    const difference = last.amount - previous.amount;
    line(context, previous.month + ' 기록 대비', (difference > 0 ? '+' : '') + won(difference), true);
  }
  append(node, 'small', includeProperty
    ? '부동산 포함 · 월말 스냅샷 또는 자산별 최근 평가액 합계'
    : '부동산 제외 · 금융자산별 최근 기록의 합계');
}

function renderAssetTrends(month: string) {
  const container = $('asset-trends');
  container.replaceChildren();
  const valuations = ledger.filter(row => row.kind === 'valuation' && row.month <= month);
  const assets = latest(valuations).filter(row => row.category !== '현금');
  if (!assets.length) append(container, 'p', '조회 월까지 표시할 자산 평가 기록이 없습니다.');
  for (const asset of assets) {
    const rows = [...new Map(valuations.filter(row => row.id === asset.id)
      .map(row => [row.month, row])).values()].sort((a, b) => a.month.localeCompare(b.month)).slice(-12);
    const panel = append(container, 'section', '');
    panel.className = 'panel';
    append(panel, 'small', asset.category).className = 'asset-trend-category';
    append(panel, 'h2', asset.title);
    const node = append(panel, 'div', '');
    const context = append(panel, 'dl', '');
    context.className = 'asset-metrics';
    const last = rows[rows.length - 1];
    const category = asset.category;
    const purchase = category === '부동산' && ledger.find(row => row.kind === 'purchase' && row.id === asset.id);
    plotTrend(node, rows, purchase ? purchase.amount : undefined);
    line(context, '최근 평가액', won(last.amount), true).className = 'asset-metric asset-metric-current';
    if (purchase) {
      line(context, '매입가', won(purchase.amount), true).className = 'asset-metric asset-metric-purchase';
      const difference = last.amount-purchase.amount;
      line(context, '매입가 대비 차이', (difference > 0 ? '+' : '') + won(difference), true).className = 'asset-metric';
    } else if (rows.length > 1) {
      const previous = rows[rows.length - 2];
      const difference = last.amount-previous.amount;
      line(context, previous.month + ' 기록 대비', (difference > 0 ? '+' : '') + won(difference), true).className = 'asset-metric';
    }
    if (category === '주식') append(node,'small','계좌 평가액 기준 · 입출금을 제외한 투자 수익률은 별도 계산이 필요합니다.');
  }
}
const root = $('dashboard-content');
const menu = root.querySelectorAll<HTMLButtonElement>('[data-view]');
for (const button of menu) button.addEventListener('click',() => {
  for (const item of menu) {
    const active = item === button;
    $(item.dataset.view!).hidden = !active;
    if (active) item.setAttribute('aria-current','page');
    else item.removeAttribute('aria-current');
  }
  root.querySelector('h1')!.textContent = button.textContent;
});
root.querySelector('h1')!.textContent = '대시보드';
const includePropertySwitch = $<HTMLInputElement>('portfolio-include-property');
includePropertySwitch.addEventListener('change', render);
monthInput.addEventListener('change',() => {
  if (!monthInput.value) monthInput.value = currentMonth;
  render();
});

const refresh = $<HTMLButtonElement>('refresh');
const status = $('refresh-status');
async function reload() {
  refresh.disabled = true;
  status.hidden = false;
  status.textContent = '공유 원장을 불러오는 중…';
  try {
    const shared = await readSharedLedger(new AbortController().signal);
    ledger = dashboardRows(shared, currentMonth);
    snapshots = shared.snapshots;
    monthlyNotes = shared.history.filter(entry => entry.action === 'monthly-note')
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    render();
    status.hidden = true;
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : '공유 원장을 불러오지 못했습니다.';
  } finally {
    refresh.disabled = false;
  }
}
refresh.addEventListener('click', () => { void reload(); });
void reload();
