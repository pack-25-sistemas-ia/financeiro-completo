// Dinheiro: centavos de BRL em inteiros seguros (docs/MONEY_RULES.md). Nunca float em operação crítica.
// Espelho TypeScript das regras do banco (fin_distribute, limites); a fonte de verdade é o PostgreSQL.
import Decimal from 'decimal.js';

export const MAX_CENTS = 99_999_999_999_999; // R$ 999.999.999.999,99 — mesmo teto do banco

/** Centavos: inteiro seguro dentro do teto. Só nasce de `cents()` ou das operações abaixo. */
export type Cents = number & { readonly __brand: 'Cents' };

export class MoneyError extends Error {}

export function cents(n: number): Cents {
  if (!Number.isSafeInteger(n)) throw new MoneyError('Valor monetário precisa ser um inteiro de centavos.');
  if (Math.abs(n) > MAX_CENTS) throw new MoneyError('Valor acima do limite permitido.');
  return n as Cents;
}

export function addCents(a: number, b: number): Cents {
  return cents(cents(a) + cents(b));
}

export function sumCents(values: readonly number[]): Cents {
  let total = 0;
  for (const v of values) total = addCents(total, v);
  return cents(total);
}

/**
 * Texto em reais → centavos. Aceita «1.234,56», «1234,56», «R$ 1.234,56», «1234.56» e «1234».
 * Rejeita notação científica, mais de 2 casas decimais, separadores mal formados e vazio (retorna null).
 */
export function parseBRL(input: string, opts: { allowNegative?: boolean } = {}): Cents | null {
  let s = input.replace(/ /g, ' ').trim();
  let negative = false;
  if (s.startsWith('-')) { negative = true; s = s.slice(1).trim(); }
  s = s.replace(/^R\$\s*/i, '').trim();
  if (negative && !opts.allowNegative) return null;
  let intPart: string;
  let frac = '';
  if (s.includes(',')) {
    const [i, f, ...rest] = s.split(',');
    if (rest.length || i === undefined || f === undefined || !/^\d{1,2}$/.test(f)) return null;
    if (!/^\d{1,3}(\.\d{3})*$|^\d+$/.test(i)) return null;
    intPart = i.replaceAll('.', '');
    frac = f;
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    intPart = s.replaceAll('.', '');
  } else if (/^\d+\.\d{1,2}$/.test(s)) {
    const pieces = s.split('.');
    intPart = pieces[0] ?? '';
    frac = pieces[1] ?? '';
  } else if (/^\d+$/.test(s)) {
    intPart = s;
  } else {
    return null;
  }
  if (intPart.length > 13) return null;
  const total = Number(intPart) * 100 + Number(frac.padEnd(2, '0'));
  if (!Number.isSafeInteger(total) || total > MAX_CENTS) return null;
  return cents(negative ? -total : total);
}

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** Apresentação: R$ 1.234,56. Só para exibir; nunca para calcular. */
export function formatBRL(value: number): string {
  // Texto decimal exato (Intl.NumberFormat v3 aceita string numérica): evita converter centavos em float.
  return brl.format(formatPlain(value) as unknown as number);
}

/** Valor para CSV/inputs: ponto decimal e 2 casas, sem símbolo. Exata (sem float). */
export function formatPlain(value: number): string {
  const c = cents(value);
  const abs = Math.abs(c);
  return `${c < 0 ? '-' : ''}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** Valor com vírgula para campos de formulário brasileiros: 1234,56. */
export function formatInput(value: number): string {
  return formatPlain(value).replace('.', ',');
}

/**
 * Distribuição exata pelo método do maior resto (empate vai ao menor índice).
 * Mesmo algoritmo e mesmos resultados de private.fin_distribute no banco.
 */
export function distribute(total: number, weights: readonly number[]): Cents[] {
  const t = cents(total);
  if (t < 0 || weights.length < 1) throw new MoneyError('Distribuição inválida.');
  let sum = 0n;
  for (const w of weights) {
    if (!Number.isSafeInteger(w) || w <= 0) throw new MoneyError('Peso de distribuição deve ser um inteiro positivo.');
    sum += BigInt(w);
  }
  const T = BigInt(t);
  const shares: bigint[] = weights.map((w) => (T * BigInt(w)) / sum);
  const rem: bigint[] = weights.map((w, i) => T * BigInt(w) - (shares[i] ?? 0n) * sum);
  let left = T - shares.reduce((a, b) => a + b, 0n);
  while (left > 0n) {
    let best = 0;
    for (let i = 1; i < rem.length; i++) if ((rem[i] ?? -1n) > (rem[best] ?? -1n)) best = i;
    shares[best] = (shares[best] ?? 0n) + 1n;
    rem[best] = -1n;
    left -= 1n;
  }
  return shares.map((s) => cents(Number(s)));
}

/** Parcelas iguais que fecham exatamente o total (as primeiras recebem o centavo restante). */
export function splitInstallments(total: number, n: number): Cents[] {
  if (!Number.isInteger(n) || n < 1 || n > 360) throw new MoneyError('Número de parcelas deve ficar entre 1 e 360.');
  return distribute(total, Array.from({ length: n }, () => 1));
}

// ---- taxas e percentuais: Decimal.js só aqui, com arredondamento único (meio para o par / bancário) e saída em centavos inteiros
const D = Decimal.clone({ precision: 28, rounding: Decimal.ROUND_HALF_EVEN });

/** Aplica pontos-base (1 bps = 0,01%) a um valor em centavos: arredondamento meio-para-o-par. */
export function applyBps(value: number, bps: number): Cents {
  if (!Number.isSafeInteger(bps)) throw new MoneyError('Pontos-base devem ser inteiros.');
  return cents(new D(cents(value)).mul(bps).div(10_000).toDecimalPlaces(0, Decimal.ROUND_HALF_EVEN).toNumber());
}

/** Percentual textual («2,5» ou «2.5») → pontos-base inteiros (250). Máx. 2 casas. */
export function percentToBps(input: string): number | null {
  const s = input.trim().replace('%', '').replace(',', '.');
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(s)) return null;
  const bps = new D(s).mul(100).toNumber();
  return Number.isInteger(bps) ? bps : null;
}

/** Razão entre dois valores (ex.: ticket médio = total ÷ quantidade) em centavos, meio-para-o-par. Nulo se divisor 0. */
export function divideRound(total: number, divisor: number): Cents | null {
  if (!Number.isSafeInteger(divisor) || divisor <= 0) return null;
  return cents(new D(cents(total)).div(divisor).toDecimalPlaces(0, Decimal.ROUND_HALF_EVEN).toNumber());
}
