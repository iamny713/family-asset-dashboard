import { readFile } from 'node:fs/promises';
import { applyCommand, emptyLedger } from '../src/model.ts';
import { sheetUrl } from '../src/sheets.ts';

const headers = ['id', 'day', 'kind', 'name', 'amount', 'category', 'person', 'account'];
const [file, mode] = process.argv.slice(2);

async function run() {
  if (!file || (mode !== undefined && mode !== '--apply') || process.argv.length > 4) {
    throw new Error('사용법: node scripts/import-cashflow.mjs 거래.json [--apply]');
  }
  const transactions = JSON.parse(await readFile(file, 'utf8'));
  if (!Array.isArray(transactions) || !transactions.length) throw new Error('거래를 비어 있지 않은 JSON 배열로 입력하세요.');
  const ids = new Set();
  const rows = transactions.map((flow, index) => {
    if (!flow || ['id', 'day', 'kind', 'name', 'category'].some(field => typeof flow[field] !== 'string' || !flow[field].trim()) ||
        ['person', 'account'].some(field => flow[field] != null && typeof flow[field] !== 'string') ||
        flow.id !== flow.id.trim() || ids.has(flow.id)) {
      throw new Error(`입력 ${index + 1}행의 필수 항목 또는 고유 ID를 확인하세요.`);
    }
    try {
      applyCommand(emptyLedger(), { type: 'flow', value: flow }, 'Codex');
    } catch {
      throw new Error(`입력 ${index + 1}행의 날짜·분류·금액을 확인하세요.`);
    }
    ids.add(flow.id);
    return headers.map(field => flow[field] ?? '');
  });

  if (mode !== '--apply') {
    console.log(`${rows.length}건 검증 완료. 원장에 반영하려면 --apply를 사용하세요.`);
    return;
  }
  const token = process.env.HOUSEHOLD_SHEETS_ACCESS_TOKEN;
  if (!token) throw new Error('HOUSEHOLD_SHEETS_ACCESS_TOKEN에 편집 권한이 있는 OAuth 토큰 연결이 필요합니다.');
  const spreadsheet = new URL(sheetUrl).pathname.split('/')[3];
  const range = encodeURIComponent("'현금흐름'!A:H");
  const resource = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheet}/values/${range}`;
  const request = async (suffix, options) => {
    const response = await fetch(resource + suffix, {
      ...options,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`Google Sheets 요청 실패 (HTTP ${response.status}).`);
    return response.json();
  };

  const { values: [heading, ...existing] = [] } = await request('?valueRenderOption=UNFORMATTED_VALUE');
  if (!headers.every((field, index) => heading?.[index] === field)) {
    throw new Error('현금흐름 탭의 A1:H1 헤더를 확인하세요.');
  }
  const stored = new Map();
  for (const row of existing) {
    if (row[0] === undefined || row[0] === '') continue;
    if (stored.has(row[0])) throw new Error('공유 원장에 중복 ID가 있습니다.');
    stored.set(row[0], row);
  }
  const pending = rows.filter(row => {
    const prior = stored.get(row[0]);
    if (!prior) return true;
    if (row.some((value, index) => value !== (prior[index] ?? ''))) {
      throw new Error('같은 ID에 다른 내용이 기록되어 있습니다.');
    }
    return false;
  });
  if (!pending.length) {
    console.log(`${rows.length}건이 이미 원장에 있습니다.`);
    return;
  }
  const result = await request(':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS', {
    method: 'POST', body: JSON.stringify({ values: pending }),
  });
  if (result.updates?.updatedRows !== pending.length) throw new Error('응답의 반영 건수가 다릅니다. 재시도 전에 원장을 확인하세요.');
  console.log(`신규 ${pending.length}건 반영, 기존 ${rows.length - pending.length}건 유지.`);
}

run().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
