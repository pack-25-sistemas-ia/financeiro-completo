import { describe, expect, it } from 'vitest';
import {
  MAX_CENTS, MoneyError, addCents, applyBps, cents, distribute, divideRound, formatBRL, formatInput, formatPlain, parseBRL, percentToBps, splitInstallments, sumCents,
} from '@/lib/finance/money';

const nb = (s: string) => s.replace(/ /g, ' ');

describe('cents / limites', () => {
  it('aceita só inteiros seguros dentro do teto', () => {
    expect(cents(0)).toBe(0);
    expect(cents(MAX_CENTS)).toBe(MAX_CENTS);
    expect(cents(-MAX_CENTS)).toBe(-MAX_CENTS);
    expect(() => cents(1.5)).toThrow(MoneyError);
    expect(() => cents(0.1 + 0.2)).toThrow(MoneyError);
    expect(() => cents(MAX_CENTS + 1)).toThrow(MoneyError);
    expect(() => cents(Number.NaN)).toThrow(MoneyError);
    expect(() => cents(Number.POSITIVE_INFINITY)).toThrow(MoneyError);
  });
  it('soma exata e recusa estouro', () => {
    expect(sumCents([10, 20, 30])).toBe(60);
    expect(sumCents([])).toBe(0);
    expect(addCents(-100, 100)).toBe(0);
    expect(() => addCents(MAX_CENTS, 1)).toThrow(MoneyError);
    expect(sumCents(Array.from({ length: 1000 }, () => 1))).toBe(1000);
  });
});

describe('parseBRL', () => {
  it.each([
    ['1.234,56', 123456], ['1234,56', 123456], ['R$ 1.234,56', 123456], ['R$1.234,56', 123456], ['1234.56', 123456], ['1234', 123400], ['0,05', 5], ['0', 0],
    ['12,5', 1250], ['1.234', 123400], ['1.234.567,89', 123456789], ['999.999.999.999,99', MAX_CENTS], ['  42,10  ', 4210], ['0.5', 50],
  ])('lê %s como %i centavos', (input, expected) => {
    expect(parseBRL(input)).toBe(expected);
  });
  it.each(['', '   ', 'abc', '1e3', '1,234', '1.23.4', ',50', '10,', '1,2,3', '1.000.000.000.000,00', '--5', '1 234,56', '12,345.67', 'R$', '1.2345'])('rejeita «%s»', (input) => {
    expect(parseBRL(input)).toBeNull();
  });
  it('negativo só quando permitido', () => {
    expect(parseBRL('-5')).toBeNull();
    expect(parseBRL('-5,25', { allowNegative: true })).toBe(-525);
    expect(parseBRL('-R$ 1,00', { allowNegative: true })).toBe(-100);
  });
});

describe('formatação', () => {
  it('BRL com separadores', () => {
    expect(nb(formatBRL(123456))).toBe('R$ 1.234,56');
    expect(nb(formatBRL(5))).toBe('R$ 0,05');
    expect(nb(formatBRL(0))).toBe('R$ 0,00');
    expect(nb(formatBRL(-100))).toBe('-R$ 1,00');
    expect(nb(formatBRL(MAX_CENTS))).toBe('R$ 999.999.999.999,99');
  });
  it('texto decimal exato para CSV e campos', () => {
    expect(formatPlain(123456)).toBe('1234.56');
    expect(formatPlain(5)).toBe('0.05');
    expect(formatPlain(-5)).toBe('-0.05');
    expect(formatPlain(MAX_CENTS)).toBe('999999999999.99');
    expect(formatInput(123456)).toBe('1234,56');
  });
  it('ida e volta sem perda', () => {
    for (const c of [0, 1, 9, 10, 99, 100, 101, 123456, 99999999999999, 7777777777]) expect(parseBRL(formatInput(c))).toBe(c);
  });
});

describe('distribute — mesmos casos do teste SQL 60_fin_money', () => {
  it('casos calculados à mão', () => {
    expect(distribute(100000, [1, 1, 1])).toEqual([33334, 33333, 33333]);
    expect(distribute(1, [1, 1, 1])).toEqual([1, 0, 0]);
    expect(distribute(0, [1, 2])).toEqual([0, 0]);
    expect(distribute(10, [1, 1, 1, 1])).toEqual([3, 3, 2, 2]);
    expect(distribute(10001, [60, 40])).toEqual([6001, 4000]);
    expect(distribute(100, [1, 2, 3])).toEqual([17, 33, 50]);
    expect(distribute(7, [5])).toEqual([7]);
    expect(distribute(MAX_CENTS, [1, 1, 1])).toEqual([33333333333333, 33333333333333, 33333333333333]);
    expect(distribute(MAX_CENTS - 1, [1, 1, 1])).toEqual([33333333333333, 33333333333333, 33333333333332]);
  });
  it('recusas', () => {
    expect(() => distribute(10, [1, 0])).toThrow(MoneyError);
    expect(() => distribute(10, [1, -1])).toThrow(MoneyError);
    expect(() => distribute(10, [])).toThrow(MoneyError);
    expect(() => distribute(-1, [1])).toThrow(MoneyError);
    expect(() => distribute(10, [1.5])).toThrow(MoneyError);
  });
  it('propriedade: soma exata e partes equilibradas em milhares de combinações', () => {
    for (let t = 0; t <= 250; t++) {
      for (let n = 1; n <= 12; n++) {
        const parts = distribute(t, Array.from({ length: n }, () => 1));
        expect(parts.reduce((a, b) => a + b, 0)).toBe(t);
        expect(Math.max(...parts) - Math.min(...parts)).toBeLessThanOrEqual(1);
      }
    }
    for (let t = 0; t <= 20000; t += 7) {
      const parts = distribute(t, [(t % 7) + 1, (t % 11) + 1, (t % 13) + 1, 1]);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(t);
      expect(Math.min(...parts)).toBeGreaterThanOrEqual(0);
    }
  });
  it('parcelas fecham exatamente o total', () => {
    expect(splitInstallments(100000, 3)).toEqual([33334, 33333, 33333]);
    expect(splitInstallments(99, 1)).toEqual([99]);
    expect(() => splitInstallments(100, 0)).toThrow();
    expect(() => splitInstallments(100, 361)).toThrow();
    expect(splitInstallments(1000001, 360).reduce((a, b) => a + b, 0)).toBe(1000001);
  });
});

describe('taxas (Decimal.js, meio-para-o-par)', () => {
  it('aplica pontos-base com arredondamento bancário', () => {
    expect(applyBps(10001, 250)).toBe(250); // 250,025 → 250
    expect(applyBps(5, 1000)).toBe(0); // 0,5 → 0 (par)
    expect(applyBps(15, 1000)).toBe(2); // 1,5 → 2 (par)
    expect(applyBps(25, 1000)).toBe(2); // 2,5 → 2 (par)
    expect(applyBps(35, 1000)).toBe(4); // 3,5 → 4 (par)
    expect(applyBps(100000, 0)).toBe(0);
    expect(applyBps(100000, 10000)).toBe(100000);
    expect(applyBps(-15, 1000)).toBe(-2);
    expect(() => applyBps(100, 1.5)).toThrow(MoneyError);
  });
  it('percentual textual → pontos-base', () => {
    expect(percentToBps('2,5')).toBe(250);
    expect(percentToBps('2.5%')).toBe(250);
    expect(percentToBps('100')).toBe(10000);
    expect(percentToBps('0,01')).toBe(1);
    expect(percentToBps('2,555')).toBeNull();
    expect(percentToBps('abc')).toBeNull();
    expect(percentToBps('')).toBeNull();
  });
  it('divisão arredondada (ticket médio)', () => {
    expect(divideRound(100, 3)).toBe(33);
    expect(divideRound(101, 2)).toBe(50);
    expect(divideRound(103, 2)).toBe(52);
    expect(divideRound(1000, 0)).toBeNull();
    expect(divideRound(1000, -1)).toBeNull();
    expect(divideRound(0, 5)).toBe(0);
  });
});
