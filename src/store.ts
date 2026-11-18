import { applyCommand, emptyLedger, type Command, type Ledger } from './model';

export const storageKey = 'family-asset-dashboard:v1';

export function readLedger(): Ledger {
  const saved = localStorage.getItem(storageKey);
  if (!saved) return emptyLedger();
  const ledger = JSON.parse(saved);
  if (!ledger || !['positions', 'flows', 'snapshots', 'history'].every(key => Array.isArray(ledger[key]))) {
    throw new Error('저장된 원장 형식을 확인할 수 없습니다.');
  }
  return ledger;
}

export async function saveCommand(command: Command): Promise<Ledger> {
  const save = () => {
    const { next } = applyCommand(readLedger(), command, '이 브라우저');
    localStorage.setItem(storageKey, JSON.stringify(next));
    return next;
  };
  if (navigator.locks) return navigator.locks.request(storageKey, save);
  return save();
}
