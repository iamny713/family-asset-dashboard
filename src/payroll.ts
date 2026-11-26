type PayrollKind = '지급' | '초과근무' | '공제' | '기지급';
export type PayrollRow = { month: string; day: string; kind: PayrollKind; name: string; amount: number };

export function parsePayrollCsv(csv: string): PayrollRow[] {
  const [header, ...lines] = csv.replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  const fields = (line: string) => [...line.matchAll(/(?:^|,)("(?:[^"]|"")*"|[^",]*)(?=,|$)/g)]
    .map(([, value]) => value.startsWith('"') ? value.slice(1, -1).replaceAll('""', '"') : value);
  if (fields(header).join(',') !== '월,지급일,구분,항목,금액') {
    throw new Error('급여명세서 탭에서 내려받은 CSV를 선택해 주세요.');
  }
  return lines.filter(line => line.trim()).map((line, index) => {
    const [month, day, kind, name, rawAmount, ...extra] = fields(line);
    const amount = Number(rawAmount?.replaceAll(',', ''));
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || !/^\d{4}-\d{2}-\d{2}$/.test(day)
      || !['지급', '초과근무', '공제', '기지급'].includes(kind) || !name || !rawAmount
      || !/^-?[\d,]+$/.test(rawAmount) || !Number.isSafeInteger(amount) || extra.length) {
      throw new Error(`급여명세서 CSV의 ${index + 2}행을 확인해 주세요.`);
    }
    return { month, day, kind: kind as PayrollKind, name, amount };
  });
}

const won = (amount: number) => amount.toLocaleString('ko-KR') + '원';
const total = (rows: PayrollRow[]) => rows.reduce((sum, row) => sum + row.amount, 0);

function add<K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, label = '') {
  const el = document.createElement(tag);
  el.textContent = label;
  parent.append(el);
  return el;
}

export function setupPayroll() {
  const input = document.querySelector<HTMLInputElement>('#payroll-csv')!;
  const status = document.querySelector('#payroll-status')!;
  const details = document.querySelector<HTMLElement>('#payroll-details')!;
  const charts = [
    { kind: '초과근무', root: document.querySelector<HTMLElement>('#payroll-overtime')! },
    { kind: '공제', root: document.querySelector<HTMLElement>('#payroll-deductions')! },
  ] as const;
  let ledger: PayrollRow[] = [];
  let selected = '';

  function render(focusKind?: PayrollKind) {
    const months = [...new Set(ledger.map(row => row.month))].sort().reverse();
    for (const { kind, root } of charts) {
      root.replaceChildren();
      const rows = ledger.filter(row => row.kind === kind);
      const names = [...new Set(rows.map(row => row.name))];
      const groups = months.map(month => {
        const byName = names.map(name => total(rows.filter(row => row.month === month && row.name === name)));
        return { month, rows: rows.filter(row => row.month === month), byName };
      });
      const positives = Math.max(1, ...groups.map(g => g.byName.filter(v => v > 0).reduce((a, b) => a + b, 0)));
      const negatives = Math.max(0, ...groups.map(g => g.byName.filter(v => v < 0).reduce((a, b) => a - b, 0)));
      const scale = positives + negatives;
      const color = (i: number) => `hsl(${(215 + i * 137.5) % 360} 62% 49%)`;
      const legend = add(root, 'div');
      legend.className = 'legend';
      names.forEach((name, i) => {
        const item = add(legend, 'span');
        const dot = add(item, 'i');
        dot.className = 'dot';
        dot.style.background = color(i);
        add(item, 'span', name);
      });
      const scroll = add(root, 'div');
      scroll.className = 'payroll-chart-scroll';
      const graph = add(scroll, 'div');
      graph.className = 'payroll-chart';
      graph.style.gridTemplateColumns = `repeat(${months.length}, minmax(106px, 1fr))`;
      for (const group of groups) {
        const button = add(graph, 'button');
        button.type = 'button';
        button.setAttribute('aria-pressed', String(group.month === selected));
        button.setAttribute('aria-label', `${group.month} ${kind} ${won(total(group.rows))}, 상세 보기`);
        button.addEventListener('click', () => {
          selected = group.month;
          render(kind);
          details.scrollIntoView({ block: 'nearest' });
        });
        add(button, 'strong', won(total(group.rows)));
        const plot = add(button, 'span');
        plot.className = 'payroll-plot';
        for (const sign of [1, -1]) {
          const stack = add(plot, 'span');
          stack.className = sign > 0 ? 'payroll-positive' : 'payroll-negative';
          const limit = sign > 0 ? positives : negatives;
          stack.style.height = `${limit / scale * 100}%`;
          group.byName.forEach((amount, index) => {
            if (amount * sign <= 0) return;
            const segment = add(stack, 'span');
            segment.title = names[index] + ' ' + won(amount);
            segment.style.height = `${Math.abs(amount) / limit * 100}%`;
            segment.style.background = color(index);
          });
        }
        add(button, 'span', group.month);
      }
      if (focusKind === kind) root.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus();
    }

    details.replaceChildren();
    details.hidden = !selected;
    if (!selected) return;
    add(details, 'h3', selected + ' 급여명세서');
    const rows = ledger.filter(row => row.month === selected);
    const dates = [...new Set(rows.map(row => row.day))].sort();
    add(details, 'p', '지급일 ' + dates.join(', '));
    const paid = total(rows.filter(row => row.kind === '지급' || row.kind === '초과근무'));
    const deductions = total(rows.filter(row => row.kind === '공제'));
    add(details, 'p', `지급 ${won(paid)} · 공제 ${won(deductions)} · 실수령 ${won(paid - deductions)}`);
    const previous = new Date(selected + '-01T00:00:00Z');
    previous.setUTCMonth(previous.getUTCMonth() - 1);
    const priorRows = ledger.filter(row => row.month === previous.toISOString().slice(0, 7));
    for (const kind of ['초과근무', '공제', '지급', '기지급'] as const) {
      const items = rows.filter(row => row.kind === kind);
      if (!items.length) continue;
      add(details, 'h4', kind + (kind === '기지급' ? ' · 참고' : ''));
      if (priorRows.length && (kind === '초과근무' || kind === '공제')) {
        const diff = total(items) - total(priorRows.filter(row => row.kind === kind));
        add(details, 'p', '전월 대비 ' + (diff > 0 ? '+' : '') + won(diff));
      }
      const list = add(details, 'dl');
      for (const item of items) {
        const pair = add(list, 'div');
        add(pair, 'dt', item.name);
        add(pair, 'dd', won(item.amount));
      }
    }
  }

  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    input.disabled = true;
    try {
      const next = parsePayrollCsv(await file.text());
      if (!next.length) throw new Error('급여명세서 CSV에 기록이 없습니다.');
      ledger = next;
      selected = ledger.map(row => row.month).sort().at(-1)!;
      render();
      status.textContent = `${new Set(ledger.map(row => row.month)).size}개월의 급여명세서를 불러왔습니다.`;
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : '급여명세서를 읽지 못했습니다.';
    } finally {
      input.value = '';
      input.disabled = false;
    }
  });
}
