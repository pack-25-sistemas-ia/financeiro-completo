// Validação de entrada no SERVIDOR (Zod). Dinheiro entra como texto BRL e vira centavos aqui; o banco valida de novo.
import { z } from 'zod';
import { isIsoDate } from './dates';
import { ACCOUNT_TYPES, ADJUSTMENT_KINDS, COUNTERPARTY_KINDS, FREQUENCY_OPTIONS, GOAL_METRICS, IMPORT_KINDS, NATURES, NOTIFICATION_TYPES, SETTLEMENT_METHODS } from './labels';
import { MAX_CENTS, parseBRL, percentToBps } from './money';

const optionalUuid = z.preprocess((v) => (v === '' || v === undefined || v === null ? null : v), z.uuid('Seleção inválida.').nullable());
export const uuid = z.uuid('Registro inválido.');
const text = (min: number, max: number, label = 'Campo') => z.string().trim().min(min, `${label}: mínimo de ${min} caracteres.`).max(max, `${label}: máximo de ${max} caracteres.`);
const optionalText = (max: number) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().max(max, `Máximo de ${max} caracteres.`).nullable());
const date = (label = 'Data') => z.string().refine(isIsoDate, `${label} inválida.`);
export const idemKey = z.preprocess((v) => (typeof v === 'string' && v.length >= 8 ? v : crypto.randomUUID()), z.string().min(8).max(100));

/** Valor em reais (ex.: «1.234,56») → centavos inteiros; positivo. */
export const moneyPositive = (label = 'Valor') =>
  z.string().transform((s, ctx) => {
    const c = parseBRL(s);
    if (c === null || c <= 0 || c > MAX_CENTS) { ctx.addIssue({ code: 'custom', message: `${label} inválido. Use o formato 1.234,56 (maior que zero).` }); return z.NEVER; }
    return c as number;
  });
export const moneySigned = (label = 'Valor') =>
  z.string().transform((s, ctx) => {
    const c = parseBRL(s, { allowNegative: true });
    if (c === null || c === 0 || Math.abs(c) > MAX_CENTS) { ctx.addIssue({ code: 'custom', message: `${label} inválido. Use o formato -15,00 ou 15,00 (diferente de zero).` }); return z.NEVER; }
    return c as number;
  });
export const moneyOrZero = (label = 'Valor') =>
  z.string().transform((s, ctx) => {
    const c = parseBRL(s, { allowNegative: true });
    if (c === null || Math.abs(c) > MAX_CENTS) { ctx.addIssue({ code: 'custom', message: `${label} inválido. Use o formato 1.234,56.` }); return z.NEVER; }
    return c as number;
  });

// ---- contas
export const accountSchema = z.object({
  name: text(2, 80, 'Nome'),
  account_type: z.enum(ACCOUNT_TYPES, 'Tipo inválido.'),
  institution: optionalText(80),
  opening: moneyOrZero('Saldo inicial'),
  opening_date: date('Data do saldo inicial'),
  include: z.preprocess((v) => v === 'on' || v === 'true', z.boolean()),
  allow_negative: z.preprocess((v) => v === 'on' || v === 'true', z.boolean()),
});
export const accountUpdateSchema = accountSchema.pick({ name: true, institution: true, include: true, allow_negative: true }).extend({ id: uuid });
export const openingSchema = z.object({ id: uuid, opening: moneyOrZero('Saldo inicial'), opening_date: date('Data'), reason: text(5, 300, 'Motivo') });

// ---- cadastros
export const categorySchema = z.object({ name: text(2, 80, 'Nome'), nature: z.enum(NATURES, 'Natureza inválida.'), parent_id: optionalUuid });
export const categoryEditSchema = z.object({ id: uuid, name: text(2, 80, 'Nome'), active: z.preprocess((v) => v === 'on' || v === 'true', z.boolean()) });
export const costCenterSchema = z.object({ name: text(2, 80, 'Nome'), code: z.string().trim().regex(/^[A-Za-z0-9._-]{1,20}$/, 'Código: até 20 letras, números, ponto, hífen ou sublinhado.'), description: optionalText(300) });
export const costCenterEditSchema = costCenterSchema.extend({ id: uuid, active: z.preprocess((v) => v === 'on' || v === 'true', z.boolean()) });
const digits = z.preprocess((v) => (typeof v === 'string' ? v.replace(/\D/g, '') : v), z.string().regex(/^(\d{11}|\d{14})?$/, 'CPF (11 dígitos) ou CNPJ (14 dígitos).'));
export const counterpartySchema = z.object({
  kind: z.enum(COUNTERPARTY_KINDS, 'Tipo inválido.'),
  name: text(2, 120, 'Nome'),
  legal_name: optionalText(160),
  document_number: digits.transform((v) => (v === '' ? null : v)),
  email: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : typeof v === 'string' ? v.trim().toLowerCase() : v), z.string().max(254).regex(/^[^@\s]+@[^@\s]+$/, 'E-mail inválido.').nullable()),
  phone: optionalText(30),
  notes: optionalText(500),
});
export const counterpartyEditSchema = counterpartySchema.extend({ id: uuid });

// ---- títulos
export const allocationRow = z.object({ cost_center_id: uuid, weight: z.coerce.number().int().min(1).max(1_000_000) });
export const entrySchema = z.object({
  entry_type: z.enum(['payable', 'receivable'], 'Tipo inválido.'),
  description: text(2, 200, 'Descrição'),
  counterparty_id: optionalUuid,
  category_id: optionalUuid,
  expected_account_id: optionalUuid,
  amount: moneyPositive('Valor'),
  issue_date: date('Emissão'),
  competence_date: date('Competência'),
  first_due: date('Vencimento'),
  installments: z.coerce.number().int('Informe um número inteiro.').min(1, 'Mínimo de 1 parcela.').max(360, 'Máximo de 360 parcelas.'),
  frequency: z.enum(FREQUENCY_OPTIONS, 'Frequência inválida.'),
  notes: optionalText(1000),
  idem: idemKey,
}).refine((v) => v.first_due >= v.issue_date, { message: 'O vencimento não pode ser anterior à emissão.', path: ['first_due'] });
export const entryEditSchema = z.object({
  id: uuid, description: text(2, 200, 'Descrição'), counterparty_id: optionalUuid, category_id: optionalUuid, expected_account_id: optionalUuid, competence_date: date('Competência'), notes: optionalText(1000),
});
export const replanSchema = z.object({ id: uuid, amount: moneyPositive('Valor'), installments: z.coerce.number().int().min(1).max(360), first_due: date('Vencimento'), frequency: z.enum(FREQUENCY_OPTIONS) });
export const reasonSchema = z.object({ id: uuid, reason: text(5, 300, 'Motivo') });
export const rescheduleSchema = z.object({ installment_id: uuid, due: date('Vencimento') });
export const allocationsSchema = z.object({ id: uuid, rows: z.array(allocationRow).max(50) });

// ---- baixas, transferências e ajustes
export const settleSchema = z.object({
  installment_id: uuid, account_id: z.uuid('Selecione a conta.'),
  amount: moneyPositive('Valor'), settled_on: date('Data'), method: z.enum(SETTLEMENT_METHODS, 'Forma inválida.'), reference: optionalText(120), idem: idemKey,
});
export const transferSchema = z.object({
  source_id: uuid, destination_id: uuid, amount: moneyPositive('Valor'), on: date('Data'), description: optionalText(200), idem: idemKey,
}).refine((v) => v.source_id !== v.destination_id, { message: 'Origem e destino devem ser contas diferentes.', path: ['destination_id'] });
export const adjustmentSchema = z.object({ account_id: uuid, amount: moneySigned('Valor'), kind: z.enum(ADJUSTMENT_KINDS), reason: text(5, 300, 'Motivo'), on: date('Data'), idem: idemKey });

// ---- recorrências
export const ruleSchema = z.object({
  entry_type: z.enum(['payable', 'receivable']), description: text(2, 200, 'Descrição'), counterparty_id: optionalUuid, category_id: optionalUuid, expected_account_id: optionalUuid,
  amount: moneyPositive('Valor'), frequency: z.enum(FREQUENCY_OPTIONS), interval: z.coerce.number().int().min(1).max(12), starts_on: date('Início'),
  ends_on: z.preprocess((v) => (v === '' ? null : v), date('Término').nullable()), lead_days: z.coerce.number().int().min(0).max(365), notes: optionalText(500),
});
export const ruleEditSchema = z.object({
  id: uuid, description: text(2, 200, 'Descrição'), counterparty_id: optionalUuid, category_id: optionalUuid, expected_account_id: optionalUuid, amount: moneyPositive('Valor'),
  ends_on: z.preprocess((v) => (v === '' ? null : v), date('Término').nullable()), lead_days: z.coerce.number().int().min(0).max(365), notes: optionalText(500),
});

// ---- importação e conciliação
export const importStartSchema = z.object({ kind: z.enum(IMPORT_KINDS, 'Tipo de importação inválido.'), account_id: optionalUuid });
export const reconcileSchema = z.object({ line_id: uuid, movement_id: uuid, note: optionalText(300) });

// ---- configurações
export const settingsSchema = z.object({
  timezone: z.string().trim().min(3).max(60).refine((tz) => { try { new Intl.DateTimeFormat('pt-BR', { timeZone: tz }); return true; } catch { return false; } }, 'Fuso horário inválido.'),
  alert_days_before: z.coerce.number().int().min(0).max(60),
  cons_delay: z.coerce.number().int().min(0).max(120),
  cons_cut: z.string().transform((s, ctx) => { const b = percentToBps(s); if (b === null || b > 10000) { ctx.addIssue({ code: 'custom', message: 'Percentual inválido (0 a 100, até 2 casas).' }); return z.NEVER; } return b; }),
  opt_advance: z.coerce.number().int().min(0).max(120),
  opt_gain: z.string().transform((s, ctx) => { const b = percentToBps(s); if (b === null || b > 10000) { ctx.addIssue({ code: 'custom', message: 'Percentual inválido (0 a 100, até 2 casas).' }); return z.NEVER; } return b; }),
});
export const goalSchema = z.object({
  name: text(2, 80, 'Nome'), metric_type: z.enum(GOAL_METRICS), target: moneyPositive('Meta'), period_start: date('Início'), period_end: date('Fim'),
}).refine((v) => v.period_end >= v.period_start, { message: 'O fim não pode ser anterior ao início.', path: ['period_end'] });
export const prefSchema = z.object({ type: z.enum(NOTIFICATION_TYPES), enabled: z.preprocess((v) => v === 'on' || v === 'true', z.boolean()) });

// ---- filtros de listagem (query string)
export const pageSchema = z.coerce.number().int().min(1).max(10000).catch(1);
