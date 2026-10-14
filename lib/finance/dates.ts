// Datas contábeis são «YYYY-MM-DD» sem fuso (docs/MONEY_RULES.md §10). Aritmética em UTC puro: sem horário de verão, sem surpresa.
// Espelho de private.fin_due_dates; a fonte de verdade é o banco.

export type Frequency = 'weekly' | 'monthly' | 'quarterly' | 'annual';
export const FREQUENCIES: readonly Frequency[] = ['weekly', 'monthly', 'quarterly', 'annual'];
export const FREQUENCY_LABELS: Record<Frequency, string> = { weekly: 'Semanal', monthly: 'Mensal', quarterly: 'Trimestral', annual: 'Anual' };

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoDate(s: string): boolean {
  const m = ISO.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

function parts(s: string): [number, number, number] {
  if (!isIsoDate(s)) throw new Error(`Data inválida: ${s}`);
  const m = ISO.exec(s)!;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function iso(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = parts(date);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return iso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

/** Soma meses mantendo o dia; se o mês não tem o dia, usa o último (31/jan + 1 mês = 28 ou 29/fev). */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = parts(date);
  const idx = y * 12 + (m - 1) + months;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12 + 12) % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return iso(ny, nm + 1, Math.min(d, last));
}

/** n-ésima data a partir da primeira (sempre calculada da 1ª, não da anterior: 31/jan → 28/fev → 31/mar). */
export function nthDueDate(first: string, index: number, freq: Frequency): string {
  switch (freq) {
    case 'weekly': return addDays(first, 7 * index);
    case 'monthly': return addMonths(first, index);
    case 'quarterly': return addMonths(first, 3 * index);
    case 'annual': return addMonths(first, 12 * index);
  }
}

export function dueDates(first: string, n: number, freq: Frequency): string[] {
  if (!Number.isInteger(n) || n < 1 || n > 360) throw new Error('Número de parcelas deve ficar entre 1 e 360.');
  return Array.from({ length: n }, (_, i) => nthDueDate(first, i, freq));
}

/** Data de hoje no fuso da organização («YYYY-MM-DD»). */
export function todayIn(timeZone: string, now: number = Date.now()): string {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  return f.format(new Date(now));
}

/** Vencida = pendente e vencimento anterior a hoje (derivado; nunca persistido). */
export function isOverdue(due: string, pendingCents: number, today: string): boolean {
  return pendingCents > 0 && due < today;
}

/** 2024-01-31 → 31/01/2024. */
export function formatDateBR(date: string): string {
  const [y, m, d] = parts(date);
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
}

/** dd/mm/aaaa → aaaa-mm-dd (ou null). */
export function parseDateBR(input: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(input.trim());
  if (!m) return null;
  const s = `${m[3]}-${m[2]}-${m[1]}`;
  return isIsoDate(s) ? s : null;
}

/** Primeiro e último dia do mês de uma data. */
export function monthRange(date: string): { from: string; to: string } {
  const [y, m] = parts(date);
  return { from: iso(y, m, 1), to: iso(y, m, new Date(Date.UTC(y, m, 0)).getUTCDate()) };
}

/**
 * Instante (ISO UTC) que cai NO DIA informado no fuso da organização: hoje → agora; outro dia → por volta do meio-dia local.
 * O banco rejeita instante futuro, então um dia futuro simplesmente falha com mensagem clara.
 */
export function instantOnDate(date: string, timeZone: string, now: number = Date.now()): string {
  if (!isIsoDate(date)) throw new Error('Data inválida.');
  if (todayIn(timeZone, now) === date) return new Date(now).toISOString();
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  let t = Date.UTC(y, m - 1, d, 12);
  const local = todayIn(timeZone, t);
  if (local > date) t -= 86_400_000;
  else if (local < date) t += 86_400_000;
  return new Date(t).toISOString();
}
