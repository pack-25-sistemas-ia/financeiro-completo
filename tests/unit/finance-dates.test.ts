import { describe, expect, it } from 'vitest';
import { addDays, addMonths, dueDates, formatDateBR, isIsoDate, isOverdue, monthRange, nthDueDate, parseDateBR, todayIn } from '@/lib/finance/dates';

describe('datas de parcelas — mesmos casos do teste SQL 60_fin_money', () => {
  it('fim de mês e ano bissexto', () => {
    expect(dueDates('2024-01-31', 4, 'monthly')).toEqual(['2024-01-31', '2024-02-29', '2024-03-31', '2024-04-30']);
    expect(dueDates('2023-01-31', 3, 'monthly')).toEqual(['2023-01-31', '2023-02-28', '2023-03-31']);
  });
  it('virada de ano', () => {
    expect(dueDates('2024-11-15', 4, 'monthly')).toEqual(['2024-11-15', '2024-12-15', '2025-01-15', '2025-02-15']);
    expect(dueDates('2024-12-30', 3, 'weekly')).toEqual(['2024-12-30', '2025-01-06', '2025-01-13']);
  });
  it('trimestral e anual', () => {
    expect(dueDates('2024-11-30', 3, 'quarterly')).toEqual(['2024-11-30', '2025-02-28', '2025-05-30']);
    expect(dueDates('2024-02-29', 3, 'annual')).toEqual(['2024-02-29', '2025-02-28', '2026-02-28']);
  });
  it('parcela única e limites', () => {
    expect(dueDates('2024-05-10', 1, 'monthly')).toEqual(['2024-05-10']);
    expect(() => dueDates('2024-05-10', 0, 'monthly')).toThrow();
    expect(() => dueDates('2024-05-10', 361, 'monthly')).toThrow();
    expect(dueDates('2024-01-31', 360, 'monthly')).toHaveLength(360);
  });
  it('a n-ésima data parte da primeira (não acumula o ajuste de fim de mês)', () => {
    expect(nthDueDate('2024-01-31', 2, 'monthly')).toBe('2024-03-31');
    expect(addMonths('2024-01-31', -2)).toBe('2023-11-30');
    expect(addMonths('2024-03-31', 11)).toBe('2025-02-28');
  });
});

describe('datas', () => {
  it('valida ISO', () => {
    expect(isIsoDate('2024-02-29')).toBe(true);
    expect(isIsoDate('2023-02-29')).toBe(false);
    expect(isIsoDate('2024-13-01')).toBe(false);
    expect(isIsoDate('31/01/2024')).toBe(false);
    expect(isIsoDate('')).toBe(false);
  });
  it('soma dias atravessando mês e ano', () => {
    expect(addDays('2024-12-31', 1)).toBe('2025-01-01');
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29');
    expect(addDays('2023-03-01', -1)).toBe('2023-02-28');
  });
  it('formato brasileiro, ida e volta', () => {
    expect(formatDateBR('2024-01-05')).toBe('05/01/2024');
    expect(parseDateBR('05/01/2024')).toBe('2024-01-05');
    expect(parseDateBR('31/02/2024')).toBeNull();
    expect(parseDateBR('2024-01-05')).toBeNull();
  });
  it('hoje no fuso da organização', () => {
    const t = Date.UTC(2024, 0, 1, 2, 30); // 01/jan 02:30 UTC = 31/dez 23:30 em São Paulo (UTC−3)
    expect(todayIn('America/Sao_Paulo', t)).toBe('2023-12-31');
    expect(todayIn('UTC', t)).toBe('2024-01-01');
  });
  it('atraso derivado: pendente e vencimento anterior a hoje', () => {
    expect(isOverdue('2024-05-09', 100, '2024-05-10')).toBe(true);
    expect(isOverdue('2024-05-10', 100, '2024-05-10')).toBe(false); // vence hoje não é atraso
    expect(isOverdue('2024-05-09', 0, '2024-05-10')).toBe(false); // quitada
  });
  it('limites do mês', () => {
    expect(monthRange('2024-02-10')).toEqual({ from: '2024-02-01', to: '2024-02-29' });
    expect(monthRange('2023-12-31')).toEqual({ from: '2023-12-01', to: '2023-12-31' });
  });
});
