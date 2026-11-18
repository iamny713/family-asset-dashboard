import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { cashflow, emptyLedger, monthNow, today, totals, type Command, type Flow, type Position } from './model';
import { readLedger, saveCommand, storageKey } from './store';
import './style.css';

const currency = (n: number) => new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW' }).format(n);
const screens = ['대시보드', '자산·부채', '현금흐름', '대출 관리', '변경 이력'] as const;
type Screen = typeof screens[number];
type Editor = 'position' | 'flow' | 'snapshot';
const blankPosition = (): Position => ({ id: '', kind: 'asset', name: '', group: '', amount: 0, rate: 0, payment: 0, due: '', active: true });

function App() {
  const [ledger, setLedger] = useState(emptyLedger);
  const [screen, setScreen] = useState<Screen>('대시보드');
  const [month, setMonth] = useState(monthNow);
  const [editor, setEditor] = useState<Editor>();
  const [position, setPosition] = useState(blankPosition);
  const [transaction, setTransaction] = useState<Flow>();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (editor && !dialog.current?.open) dialog.current?.showModal();
  }, [editor]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    function reload() {
      try { setLedger(readLedger()); }
      catch (problem) { setError(problem instanceof Error ? problem.message : '원장을 읽지 못했습니다.'); }
    }
    reload();
    const listener = (event: StorageEvent) => { if (event.key === storageKey || event.key === null) reload(); };
    window.addEventListener('storage', listener);
    return () => window.removeEventListener('storage', listener);
  }, []);
  const balances = totals(ledger.positions);
  const flow = cashflow(ledger.flows, month);
  const snapshots = [...ledger.snapshots].sort((a, b) => a.month.localeCompare(b.month)).slice(-12);
  const chartMax = Math.max(1, ...snapshots.map(s => Math.abs(s.assets - s.debts)));
  const positions = ledger.positions.filter(p => p.active && (screen !== '대출 관리' || p.kind === 'debt'));
  const openPosition = (p?: Position) => {
    setPosition(p ?? { ...blankPosition(), kind: screen === '대출 관리' ? 'debt' : 'asset' });
    setEditor('position');
    setError('');
  };
  function openFlow(item?: Flow) {
    setTransaction(item);
    setEditor('flow');
    setError('');
  }
  async function save(command: Command) {
    setSaving(true);
    setError('');
    try { setLedger(await saveCommand(command)); setEditor(undefined); }
    catch (problem) { setError(problem instanceof Error ? problem.message : '저장 실패'); }
    finally { setSaving(false); }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const str = (name: string) => String(data.get(name) ?? '').trim();
    const number = (name: string) => Number(str(name));
    if (editor === 'position') {
      const debt = position.kind === 'debt';
      void save({ type: 'position', value: {
        id: position.id || crypto.randomUUID(), kind: position.kind, name: str('name'), group: str('group'),
        amount: number('amount'), rate: debt ? number('rate') : 0, payment: debt ? number('payment') : 0,
        due: debt ? str('due') : '', active: true,
      } });
    }
    if (editor === 'flow') void save({ type: 'flow', value: {
      id: transaction?.id ?? crypto.randomUUID(), kind: str('kind') === 'expense' ? 'expense' : 'income',
      day: str('day'), name: str('name'), amount: number('amount'),
    } });
    if (editor === 'snapshot') void save({ type: 'snapshot', value: {
      month: str('month'), assets: number('assets'), debts: number('debts'),
    } });
  }

  return <div className="layout">
    <aside>
      <a className="brand" href="./" aria-label="가족 자산관리 홈"><span>₩</span>가족 자산관리</a>
      <nav aria-label="주 메뉴">{screens.map((name, index) => <button key={name} type="button"
        aria-current={name === screen ? 'page' : undefined} onClick={() => setScreen(name)}>
        <span aria-hidden="true">{['◫', '▤', '⇄', '◴', '≡'][index]}</span>{name}
      </button>)}</nav>
      <div className="storage"><span />이 브라우저에 저장</div>
    </aside>
    <main>
      <header className="top"><div><p className="eyebrow">가족 원장</p><h1>{screen}</h1></div>
        {screen === '대시보드' && <button className="primary" onClick={() => { setError(''); setEditor('snapshot'); }}>월말 스냅샷 저장</button>}
        {(screen === '자산·부채' || screen === '대출 관리') && <button className="primary" onClick={() => openPosition()}>{screen === '대출 관리' ? '대출 추가' : '항목 추가'}</button>}
        {screen === '현금흐름' && <button className="primary" onClick={() => openFlow()}>거래 추가</button>}
      </header>
      {error && !editor && <p className="error" role="alert">{error}</p>}
      {screen === '대시보드' && <>
        <div className="metrics">
          <Stat label="순자산" value={balances.net} tone="accent" />
          <Stat label="총자산" value={balances.assets} />
          <Stat label="총부채" value={balances.debts} />
        </div>
        <section className="panel"><h2>월별 순자산</h2>
          {snapshots.length === 0 ? <Empty text="월말 스냅샷을 저장하면 여기에 순자산 추이가 표시됩니다." /> :
            <div className="chart">{snapshots.map(({ month: key, assets, debts }) => {
              const value = assets - debts;
              return <div className="bar-group" key={key}>
                <div className="bar-track" aria-hidden="true"><span className={value < 0 ? 'negative' : ''} style={{ height: Math.max(2, Math.abs(value) / chartMax * 48) + '%' }} /></div>
                <strong>{currency(value)}</strong><small>{key}</small>
              </div>;
            })}</div>}
        </section>
        <section className="panel"><h2>이번 달 현금흐름</h2><div className="metrics inline">
          {(() => { const current = cashflow(ledger.flows, monthNow()); return <>
            <Stat label="수입" value={current.income} /><Stat label="지출" value={current.expense} /><Stat label="잔액" value={current.net} />
          </>; })()}
        </div></section>
      </>}
      {(screen === '자산·부채' || screen === '대출 관리') && <section className="panel">
        <h2>{screen === '대출 관리' ? '대출 목록' : '보유 항목'}</h2>
        {positions.length === 0 ? <Empty text={screen === '대출 관리' ? '등록된 대출이 없습니다.' : '첫 자산 또는 부채를 추가하세요.'} /> :
          <div className="table-wrap"><table><thead><tr><th>이름</th><th>분류</th><th>잔액</th>{screen === '대출 관리' && <><th>금리</th><th>월 상환액</th><th>만기</th></>}<th>관리</th></tr></thead>
            <tbody>{positions.map(p => <tr key={p.id}><td>{p.name}</td><td>{p.kind === 'debt' ? '부채' : '자산'} · {p.group}</td><td>{currency(p.amount)}</td>
              {screen === '대출 관리' && <><td>{p.rate}%</td><td>{currency(p.payment)}</td><td>{p.due || '—'}</td></>}
              <td><button className="small" onClick={() => openPosition(p)}>수정</button></td></tr>)}</tbody></table></div>}
      </section>}
      {screen === '현금흐름' && <>
        <label className="month">조회 월 <input type="month" value={month} onChange={event => setMonth(event.target.value || monthNow())} /></label>
        <div className="metrics"><Stat label="수입" value={flow.income} /><Stat label="지출" value={flow.expense} /><Stat label="잔액" value={flow.net} tone="accent" /></div>
        <section className="panel"><h2>거래 내역</h2>
          {flow.rows.length === 0 ? <Empty text="이 달에 기록된 거래가 없습니다." /> : <div className="table-wrap"><table>
            <thead><tr><th>날짜</th><th>내용</th><th>구분</th><th>금액</th><th>관리</th></tr></thead>
            <tbody>{[...flow.rows].sort((a, b) => b.day.localeCompare(a.day)).map(f => <tr key={f.id}><td>{f.day}</td><td>{f.name}</td><td>{f.kind === 'income' ? '수입' : '지출'}</td><td>{currency(f.amount)}</td><td><button className="small" onClick={() => openFlow(f)}>수정</button></td></tr>)}</tbody>
          </table></div>}
        </section>
      </>}
      {screen === '변경 이력' && <section className="panel"><h2>원장 변경 기록</h2>
        {ledger.history.length === 0 ? <Empty text="기록된 변경이 없습니다." /> : <div className="table-wrap"><table>
          <thead><tr><th>시각</th><th>구분</th><th>작업</th><th>상세</th></tr></thead><tbody>
            {[...ledger.history].reverse().map((h, i) => <tr key={h.at + i}><td>{new Date(h.at).toLocaleString('ko-KR')}</td>
              <td>{{ position: '자산·부채', flow: '현금흐름', snapshot: '월말 스냅샷' }[h.action] ?? h.action}</td><td>{h.before ? '수정' : '등록'}</td>
              <td><details><summary>변경 내용</summary>{h.before && <pre>{h.before}</pre>}<pre>{h.after}</pre></details></td></tr>)}
          </tbody></table></div>}
      </section>}
    </main>
    {editor && <dialog ref={dialog} aria-labelledby="editor-title" onCancel={event => {
      event.preventDefault();
      if (!saving) { setError(''); setEditor(undefined); }
    }}><form onSubmit={submit}>
      <h2 id="editor-title">{editor === 'position' ? (position.id ? '항목 수정' : '항목 추가') : editor === 'flow' ? (transaction ? '거래 수정' : '거래 추가') : '월말 스냅샷 저장'}</h2>
      {editor === 'position' && <>
        <label>구분<select value={position.kind} onChange={e => setPosition({ ...position, kind: e.target.value === 'debt' ? 'debt' : 'asset' })}>
          {screen !== '대출 관리' && <option value="asset">자산</option>}<option value="debt">부채</option></select></label>
        <label>이름<input autoFocus name="name" defaultValue={position.name} required maxLength={100} /></label>
        <label>분류<input name="group" defaultValue={position.group} placeholder="예금, 투자, 주택담보대출 등" required maxLength={100} /></label>
        <Money name="amount" label="잔액 (원)" value={position.amount} />
        {position.kind === 'debt' && <><label>연 금리 (%)<input name="rate" type="number" min="0" max="100" step="0.001" defaultValue={position.rate} /></label>
          <Money name="payment" label="월 상환액 (원)" value={position.payment} /><label>만기<input name="due" type="date" defaultValue={position.due} /></label></>}
      </>}
      {editor === 'flow' && <>
        <label>날짜<input autoFocus name="day" type="date" defaultValue={transaction?.day ?? (month === monthNow() ? today() : month + '-01')} required /></label>
        <label>구분<select name="kind" defaultValue={transaction?.kind}><option value="income">수입</option><option value="expense">지출</option></select></label>
        <label>내용<input name="name" defaultValue={transaction?.name} required maxLength={100} /></label><Money name="amount" label="금액 (원)" value={transaction?.amount} min={1} />
      </>}
      {editor === 'snapshot' && <>
        <p className="muted">선택한 월의 월말 잔액을 입력하세요. 같은 달을 다시 저장하면 기존 스냅샷을 갱신합니다.</p>
        <label>기준 월<input autoFocus name="month" type="month" defaultValue={monthNow()} required /></label>
        <Money name="assets" label="총자산 (원)" value={balances.assets} /><Money name="debts" label="총부채 (원)" value={balances.debts} />
      </>}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="actions">
        {editor === 'position' && position.id && <button className="danger" type="button" disabled={saving} onClick={() => {
          if (window.confirm('이 항목을 보유 목록에서 제외할까요?')) void save({ type: 'position', value: { ...position, active: false } });
        }}>보유 제외</button>}
        <button type="button" disabled={saving} onClick={() => { setError(''); setEditor(undefined); }}>취소</button>
        <button type="submit" className="primary" disabled={saving}>{saving ? '저장 중…' : '저장'}</button>
      </div>
    </form></dialog>}
  </div>;
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return <div className={'stat ' + (tone ?? '')}><span>{label}</span><strong>{currency(value)}</strong></div>;
}
function Empty({ text }: { text: string }) {
  return <div className="empty">{text}</div>;
}
function Money({ name, label, value, min = 0 }: { name: string; label: string; value?: number; min?: number }) {
  return <label>{label}<input name={name} type="number" min={min} max={Number.MAX_SAFE_INTEGER} step="1" defaultValue={value} required /></label>;
}

createRoot(document.getElementById('root')!).render(<App />);
