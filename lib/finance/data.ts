import 'server-only';
import type { Context } from '@/lib/auth/session';
import { addDays, todayIn } from './dates';
import { PAGE_SIZE, safeSearch } from './filters';
import type { EntryType } from './labels';

// Leituras: sempre pelo cliente do usuário (RLS). Valores monetários são centavos inteiros; BIGINT chega como number (< 2^53 pelo teto do banco).

export type FinSettings = {
  timezone: string; alert_days_before: number; proj_cons_delay_days: number; proj_cons_cut_bps: number; proj_opt_advance_days: number; proj_opt_gain_bps: number;
};
export type AccountRow = {
  account_id: string; name: string; account_type: string; include_in_consolidated: boolean; active: boolean; opening_balance_cents: number; movements_cents: number; balance_cents: number;
  institution_name?: string | null; opening_balance_date?: string; allow_negative?: boolean; archived_at?: string | null;
};
export type CategoryRow = { id: string; parent_id: string | null; name: string; nature: 'income' | 'expense'; active: boolean };
export type CostCenterRow = { id: string; name: string; code: string; description: string | null; active: boolean };
export type CounterpartyRow = {
  id: string; kind: 'customer' | 'supplier' | 'both'; name: string; legal_name: string | null; document_number: string | null; email: string | null; phone: string | null; notes: string | null; archived_at: string | null;
};
export type InstallmentRow = {
  installment_id: string; entry_id: string; entry_type: EntryType; installment_number: number; total_installments: number; amount_cents: number; due_date: string; paid_cents: number; pending_cents: number;
  counterparty_id: string | null; category_id: string | null; competence_date: string; description: string; cancelled_at: string | null; archived_at: string | null;
  status: 'open' | 'partial' | 'paid' | 'cancelled'; is_overdue: boolean; counterparty_name: string | null; category_name: string | null; expected_account_id: string | null; issue_date: string;
  recurring_rule_id: string | null; last_paid_at: string | null;
};
export type MovementRow = {
  movement_id: string; account_id: string; account_name: string; movement_type: string; amount_cents: number; effective_at: string; description: string | null; settlement_id: string | null;
  transfer_id: string | null; adjustment_id: string | null; reverses_movement_id: string | null; is_reversed: boolean; entry_id: string | null; entry_type: EntryType | null; entry_description: string | null;
  category_name: string | null; counterparty_name: string | null; installment_number: number | null; total_installments: number | null; reconciliation_match_id: string | null;
};

const err = (e: { message: string } | null) => { if (e) throw new Error('consulta falhou'); };

export async function loadSettings(ctx: Context): Promise<FinSettings> {
  const { data, error } = await ctx.supabase.from('fin_settings').select('timezone, alert_days_before, proj_cons_delay_days, proj_cons_cut_bps, proj_opt_advance_days, proj_opt_gain_bps')
    .eq('organization_id', ctx.membership.organization_id).maybeSingle();
  err(error);
  return (data as FinSettings | null) ?? { timezone: 'America/Sao_Paulo', alert_days_before: 3, proj_cons_delay_days: 7, proj_cons_cut_bps: 1000, proj_opt_advance_days: 3, proj_opt_gain_bps: 500 };
}

export async function loadAccounts(ctx: Context, opts: { includeArchived?: boolean } = {}): Promise<AccountRow[]> {
  const org = ctx.membership.organization_id;
  const [bal, acc] = await Promise.all([
    ctx.supabase.from('fin_account_balances').select('account_id, name, account_type, include_in_consolidated, active, opening_balance_cents, movements_cents, balance_cents').eq('organization_id', org).order('name'),
    ctx.supabase.from('financial_accounts').select('id, institution_name, opening_balance_date, allow_negative, archived_at').eq('organization_id', org),
  ]);
  err(bal.error); err(acc.error);
  const extra = new Map((acc.data ?? []).map((a) => [a.id as string, a]));
  return ((bal.data ?? []) as AccountRow[])
    .filter((a) => opts.includeArchived || a.active)
    .map((a) => { const x = extra.get(a.account_id); return { ...a, institution_name: x?.institution_name ?? null, opening_balance_date: x?.opening_balance_date, allow_negative: x?.allow_negative, archived_at: x?.archived_at ?? null }; });
}

export async function loadCategories(ctx: Context): Promise<CategoryRow[]> {
  const { data, error } = await ctx.supabase.from('financial_categories').select('id, parent_id, name, nature, active').eq('organization_id', ctx.membership.organization_id).order('name');
  err(error);
  return (data ?? []) as CategoryRow[];
}

export async function loadCostCenters(ctx: Context): Promise<CostCenterRow[]> {
  const { data, error } = await ctx.supabase.from('cost_centers').select('id, name, code, description, active').eq('organization_id', ctx.membership.organization_id).order('name');
  err(error);
  return (data ?? []) as CostCenterRow[];
}

export async function loadCounterparties(ctx: Context, opts: { kind?: 'customer' | 'supplier'; q?: string; includeArchived?: boolean; limit?: number; page?: number } = {}): Promise<{ rows: CounterpartyRow[]; total: number }> {
  let q = ctx.supabase.from('counterparties').select('id, kind, name, legal_name, document_number, email, phone, notes, archived_at', { count: 'exact' })
    .eq('organization_id', ctx.membership.organization_id).order('name');
  if (opts.kind) q = q.in('kind', [opts.kind, 'both']);
  if (!opts.includeArchived) q = q.is('archived_at', null);
  const s = safeSearch(opts.q);
  if (s) q = q.or(`name.ilike.%${s}%,legal_name.ilike.%${s}%,document_number.ilike.%${s}%,email.ilike.%${s}%`);
  const limit = opts.limit ?? 500;
  const from = ((opts.page ?? 1) - 1) * limit;
  const { data, count, error } = await q.range(from, from + limit - 1);
  err(error);
  return { rows: (data ?? []) as CounterpartyRow[], total: count ?? 0 };
}

export type InstallmentQuery = {
  type: EntryType; q?: string; venc?: string; status?: string; counterparty?: string | null; category?: string | null; account?: string | null; from?: string; to?: string; page?: number; sort?: string; dir?: 'asc' | 'desc';
};
const SORTABLE = new Set(['due_date', 'description', 'amount_cents', 'pending_cents', 'counterparty_name']);

export async function listInstallments(ctx: Context, tz: string, f: InstallmentQuery, pageSize = PAGE_SIZE): Promise<{ rows: InstallmentRow[]; total: number }> {
  const today = todayIn(tz);
  let q = ctx.supabase.from('fin_installments_view').select('*', { count: 'exact' }).eq('organization_id', ctx.membership.organization_id).eq('entry_type', f.type).is('archived_at', null);
  if (f.status && ['open', 'partial', 'paid', 'cancelled'].includes(f.status)) q = q.eq('status', f.status);
  else if (!f.venc) q = q.neq('status', 'cancelled');
  switch (f.venc) {
    case 'vencidas': q = q.eq('is_overdue', true); break;
    case 'hoje': q = q.eq('due_date', today).gt('pending_cents', 0).neq('status', 'cancelled'); break;
    case '7d': q = q.gte('due_date', today).lte('due_date', addDays(today, 7)).gt('pending_cents', 0).neq('status', 'cancelled'); break;
    case '30d': q = q.gte('due_date', today).lte('due_date', addDays(today, 30)).gt('pending_cents', 0).neq('status', 'cancelled'); break;
    case 'breve': q = q.gte('due_date', today).lte('due_date', addDays(today, 3)).gt('pending_cents', 0).neq('status', 'cancelled'); break;
    case 'parciais': q = q.eq('status', 'partial'); break;
    default: break;
  }
  if (f.counterparty) q = q.eq('counterparty_id', f.counterparty);
  if (f.category) q = q.eq('category_id', f.category);
  if (f.account) q = q.eq('expected_account_id', f.account);
  if (f.from) q = q.gte('due_date', f.from);
  if (f.to) q = q.lte('due_date', f.to);
  const s = safeSearch(f.q);
  if (s) q = q.or(`description.ilike.%${s}%,counterparty_name.ilike.%${s}%`);
  const sort = f.sort && SORTABLE.has(f.sort) ? f.sort : 'due_date';
  q = q.order(sort, { ascending: (f.dir ?? 'asc') === 'asc' }).order('installment_number', { ascending: true });
  const from = ((f.page ?? 1) - 1) * pageSize;
  const { data, count, error } = await q.range(from, from + pageSize - 1);
  err(error);
  return { rows: (data ?? []) as InstallmentRow[], total: count ?? 0 };
}

/** Totais por situação para os cartões das telas de pagar/receber (somente leitura do banco, sem recalcular regra). */
export async function installmentTotals(ctx: Context, tz: string, type: EntryType) {
  const today = todayIn(tz);
  const { data, error } = await ctx.supabase.from('fin_installments_view').select('pending_cents, paid_cents, due_date, status, is_overdue, last_paid_at')
    .eq('organization_id', ctx.membership.organization_id).eq('entry_type', type).is('archived_at', null).neq('status', 'cancelled').limit(10000);
  err(error);
  const rows = (data ?? []) as Array<{ pending_cents: number; paid_cents: number; due_date: string; status: string; is_overdue: boolean }>;
  let open = 0, overdue = 0, upcoming = 0, partialCount = 0, partialPending = 0;
  for (const r of rows) {
    if (r.pending_cents <= 0) continue;
    open += r.pending_cents;
    if (r.is_overdue) overdue += r.pending_cents; else upcoming += r.pending_cents;
    if (r.status === 'partial') { partialCount += 1; partialPending += r.pending_cents; }
  }
  return { open, overdue, upcoming, partialCount, partialPending, today, truncated: rows.length >= 10000 };
}

export type EntryDetail = {
  entry: {
    id: string; entry_type: EntryType; description: string; counterparty_id: string | null; category_id: string | null; expected_account_id: string | null; amount_cents: number; issue_date: string; due_date: string;
    competence_date: string; notes: string | null; cancelled_at: string | null; cancel_reason: string | null; archived_at: string | null; created_at: string; recurring_rule_id: string | null;
  };
  installments: InstallmentRow[];
  settlements: Array<{ id: string; installment_id: string; account_id: string; amount_cents: number; settled_at: string; settlement_method: string; external_reference: string | null; created_at: string; reversed_at: string | null; reversal_reason: string | null }>;
  allocations: Array<{ cost_center_id: string; amount_cents: number }>;
  attachments: Array<{ id: string; entity_type: string; entity_id: string; original_file_name: string; mime_type: string; size_bytes: number; created_at: string }>;
};

export async function loadEntry(ctx: Context, id: string): Promise<EntryDetail | null> {
  const org = ctx.membership.organization_id;
  const { data: entry, error } = await ctx.supabase.from('financial_entries')
    .select('id, entry_type, description, counterparty_id, category_id, expected_account_id, amount_cents, issue_date, due_date, competence_date, notes, cancelled_at, cancel_reason, archived_at, created_at, recurring_rule_id')
    .eq('organization_id', org).eq('id', id).maybeSingle();
  err(error);
  if (!entry) return null;
  const [inst, allocs] = await Promise.all([
    ctx.supabase.from('fin_installments_view').select('*').eq('organization_id', org).eq('entry_id', id).order('installment_number'),
    ctx.supabase.from('financial_allocations').select('cost_center_id, amount_cents').eq('organization_id', org).eq('entry_id', id),
  ]);
  err(inst.error); err(allocs.error);
  const installments = (inst.data ?? []) as InstallmentRow[];
  const ids = installments.map((i) => i.installment_id);
  const { data: sets, error: e3 } = ids.length
    ? await ctx.supabase.from('settlements').select('id, installment_id, account_id, amount_cents, settled_at, settlement_method, external_reference, created_at, reversed_at, reversal_reason').eq('organization_id', org).in('installment_id', ids).order('settled_at', { ascending: false })
    : { data: [], error: null };
  err(e3);
  const settlements = (sets ?? []) as EntryDetail['settlements'];
  const entityIds = [id, ...settlements.map((s) => s.id)];
  const { data: att, error: e4 } = await ctx.supabase.from('attachments').select('id, entity_type, entity_id, original_file_name, mime_type, size_bytes, created_at')
    .eq('organization_id', org).in('entity_id', entityIds).is('archived_at', null).order('created_at', { ascending: false });
  err(e4);
  return { entry: entry as EntryDetail['entry'], installments, settlements, allocations: (allocs.data ?? []) as EntryDetail['allocations'], attachments: (att ?? []) as EntryDetail['attachments'] };
}

export type MovementQuery = { account?: string | null; from?: string; to?: string; type?: string; q?: string; page?: number; recon?: string; entry?: string };
export async function listMovements(ctx: Context, tz: string, f: MovementQuery, pageSize = PAGE_SIZE): Promise<{ rows: MovementRow[]; total: number }> {
  let q = ctx.supabase.from('fin_movements_view').select('*', { count: 'exact' }).eq('organization_id', ctx.membership.organization_id);
  if (f.account) q = q.eq('account_id', f.account);
  if (f.type && ['settlement', 'settlement_reversal', 'transfer_out', 'transfer_in', 'transfer_reversal', 'adjustment'].includes(f.type)) q = q.eq('movement_type', f.type);
  if (f.from) q = q.gte('effective_at', startOfDayIso(f.from, tz));
  if (f.to) q = q.lt('effective_at', startOfDayIso(addDays(f.to, 1), tz));
  if (f.recon === 'sim') q = q.not('reconciliation_match_id', 'is', null);
  if (f.recon === 'nao') q = q.is('reconciliation_match_id', null);
  const s = safeSearch(f.q);
  if (s) q = q.or(`description.ilike.%${s}%,entry_description.ilike.%${s}%,counterparty_name.ilike.%${s}%,category_name.ilike.%${s}%`);
  const from = ((f.page ?? 1) - 1) * pageSize;
  const { data, count, error } = await q.order('effective_at', { ascending: false }).order('movement_id').range(from, from + pageSize - 1);
  err(error);
  return { rows: (data ?? []) as MovementRow[], total: count ?? 0 };
}

/** Início do dia (00:00) no fuso informado, em ISO UTC — usado para filtrar timestamps por dia local. */
export function startOfDayIso(date: string, tz: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  let t = Date.UTC(y, m - 1, d, 0);
  for (let i = 0; i < 3; i++) {
    const local = todayIn(tz, t);
    if (local > date) t -= 3_600_000 * 12; else if (local < date) t += 3_600_000 * 12; else break;
  }
  // recua até a virada exata do dia (passos de 15 min) para não depender de deslocamentos fracionados
  while (todayIn(tz, t - 900_000) === date) t -= 900_000;
  return new Date(t).toISOString();
}

export async function loadTransfers(ctx: Context, limit = 50) {
  const { data, error } = await ctx.supabase.from('transfers')
    .select('id, source_account_id, destination_account_id, amount_cents, transferred_at, description, status, created_at, reversed_at, reversal_reason')
    .eq('organization_id', ctx.membership.organization_id).order('transferred_at', { ascending: false }).limit(limit);
  err(error);
  return (data ?? []) as Array<{ id: string; source_account_id: string; destination_account_id: string; amount_cents: number; transferred_at: string; description: string | null; status: 'posted' | 'reversed'; created_at: string; reversed_at: string | null; reversal_reason: string | null }>;
}

export async function loadRules(ctx: Context) {
  const org = ctx.membership.organization_id;
  const { data, error } = await ctx.supabase.from('recurring_rules')
    .select('id, description, entry_type, category_id, counterparty_id, expected_account_id, amount_cents, frequency, interval_count, starts_on, ends_on, lead_days, next_index, active, ended_at, notes')
    .eq('organization_id', org).order('active', { ascending: false }).order('description');
  err(error);
  return (data ?? []) as Array<{ id: string; description: string; entry_type: EntryType; category_id: string | null; counterparty_id: string | null; expected_account_id: string | null; amount_cents: number; frequency: string; interval_count: number; starts_on: string; ends_on: string | null; lead_days: number; next_index: number; active: boolean; ended_at: string | null; notes: string | null }>;
}

export async function loadOccurrences(ctx: Context, ruleId: string, limit = 24) {
  const { data, error } = await ctx.supabase.from('recurring_occurrences').select('id, occurrence_index, scheduled_date, status, generated_entry_id')
    .eq('organization_id', ctx.membership.organization_id).eq('recurring_rule_id', ruleId).order('occurrence_index', { ascending: false }).limit(limit);
  err(error);
  return (data ?? []) as Array<{ id: string; occurrence_index: number; scheduled_date: string; status: 'generated' | 'skipped'; generated_entry_id: string | null }>;
}

export async function loadImports(ctx: Context, limit = 30) {
  const { data, error } = await ctx.supabase.from('imports')
    .select('id, kind, file_name, status, total_rows, valid_rows, duplicate_rows, error_rows, accepted_rows, rejected_rows, account_id, created_at, completed_at')
    .eq('organization_id', ctx.membership.organization_id).order('created_at', { ascending: false }).limit(limit);
  err(error);
  return (data ?? []) as Array<{ id: string; kind: string; file_name: string; status: string; total_rows: number; valid_rows: number; duplicate_rows: number; error_rows: number; accepted_rows: number; rejected_rows: number; account_id: string | null; created_at: string; completed_at: string | null }>;
}

export async function loadImport(ctx: Context, id: string, page = 1, onlyProblems = false, pageSize = 50) {
  const org = ctx.membership.organization_id;
  const { data: imp, error } = await ctx.supabase.from('imports').select('id, kind, file_name, status, total_rows, valid_rows, duplicate_rows, error_rows, accepted_rows, rejected_rows, account_id, created_at, completed_at').eq('organization_id', org).eq('id', id).maybeSingle();
  err(error);
  if (!imp) return null;
  let q = ctx.supabase.from('import_rows').select('row_number, status, error_message, parsed_data, source_reference', { count: 'exact' }).eq('organization_id', org).eq('import_id', id);
  if (onlyProblems) q = q.in('status', ['error', 'duplicate', 'rejected']);
  const from = (page - 1) * pageSize;
  const { data: rows, count, error: e2 } = await q.order('row_number').range(from, from + pageSize - 1);
  err(e2);
  return { imp, rows: (rows ?? []) as Array<{ row_number: number; status: string; error_message: string | null; parsed_data: Record<string, unknown>; source_reference: string | null }>, total: count ?? 0 };
}

export type StatementLine = { id: string; account_id: string; external_reference: string | null; transaction_date: string; amount_cents: number; description: string; reconciliation_status: string; ignore_reason: string | null };
export async function loadStatementLines(ctx: Context, account: string, f: { status?: string; from?: string; to?: string; page?: number }, pageSize = 30) {
  let q = ctx.supabase.from('bank_statement_lines').select('id, account_id, external_reference, transaction_date, amount_cents, description, reconciliation_status, ignore_reason', { count: 'exact' })
    .eq('organization_id', ctx.membership.organization_id).eq('account_id', account);
  if (f.status && ['pending', 'reconciled', 'divergent', 'ignored'].includes(f.status)) q = q.eq('reconciliation_status', f.status);
  if (f.from) q = q.gte('transaction_date', f.from);
  if (f.to) q = q.lte('transaction_date', f.to);
  const from = ((f.page ?? 1) - 1) * pageSize;
  const { data, count, error } = await q.order('transaction_date', { ascending: false }).order('id').range(from, from + pageSize - 1);
  err(error);
  return { rows: (data ?? []) as StatementLine[], total: count ?? 0 };
}

export async function loadUnreconciledMovements(ctx: Context, account: string, from: string, to: string, tz: string) {
  const { data, error } = await ctx.supabase.from('fin_movements_view')
    .select('movement_id, effective_at, amount_cents, description, entry_description, counterparty_name, movement_type').eq('organization_id', ctx.membership.organization_id).eq('account_id', account)
    .is('reconciliation_match_id', null).gte('effective_at', startOfDayIso(from, tz)).lt('effective_at', startOfDayIso(addDays(to, 1), tz)).order('effective_at', { ascending: false }).limit(200);
  err(error);
  return (data ?? []) as Array<{ movement_id: string; effective_at: string; amount_cents: number; description: string | null; entry_description: string | null; counterparty_name: string | null; movement_type: string }>;
}

export async function loadNotifications(ctx: Context, opts: { unreadOnly?: boolean; limit?: number } = {}) {
  let q = ctx.supabase.from('fin_notifications').select('id, type, title, body, link, read_at, created_at').eq('organization_id', ctx.membership.organization_id).eq('user_id', ctx.user.id);
  if (opts.unreadOnly) q = q.is('read_at', null);
  const { data, error } = await q.order('created_at', { ascending: false }).limit(opts.limit ?? 50);
  err(error);
  return (data ?? []) as Array<{ id: string; type: string; title: string; body: string; link: string | null; read_at: string | null; created_at: string }>;
}

export async function unreadCount(ctx: Context): Promise<number> {
  const { count } = await ctx.supabase.from('fin_notifications').select('id', { count: 'exact', head: true })
    .eq('organization_id', ctx.membership.organization_id).eq('user_id', ctx.user.id).is('read_at', null);
  return count ?? 0;
}

export async function loadPrefs(ctx: Context) {
  const { data } = await ctx.supabase.from('fin_notification_prefs').select('type, enabled').eq('organization_id', ctx.membership.organization_id).eq('user_id', ctx.user.id);
  return new Map((data ?? []).map((p) => [p.type as string, p.enabled as boolean]));
}

export async function loadGoals(ctx: Context) {
  const { data, error } = await ctx.supabase.from('financial_goals').select('id, name, metric_type, target_amount_cents, period_start, period_end').eq('organization_id', ctx.membership.organization_id).order('period_start', { ascending: false });
  err(error);
  return (data ?? []) as Array<{ id: string; name: string; metric_type: string; target_amount_cents: number; period_start: string; period_end: string }>;
}

export async function loadAccountHistory(ctx: Context, accountId: string) {
  const { data, error } = await ctx.supabase.from('account_opening_history').select('id, old_cents, new_cents, old_date, new_date, reason, changed_at').eq('organization_id', ctx.membership.organization_id).eq('account_id', accountId).order('changed_at', { ascending: false });
  err(error);
  return (data ?? []) as Array<{ id: string; old_cents: number | null; new_cents: number; old_date: string | null; new_date: string; reason: string; changed_at: string }>;
}

/** Histórico de auditoria (só administrador lê, por RLS do Core): apenas nomes de colunas, nunca valores. */
export async function loadAudit(ctx: Context, entityIds: string[], limit = 40) {
  if (!entityIds.length) return [];
  const { data } = await ctx.supabase.from('audit_log').select('id, action, entity, entity_id, changes, created_at').eq('organization_id', ctx.membership.organization_id).in('entity_id', entityIds).order('created_at', { ascending: false }).limit(limit);
  return (data ?? []) as Array<{ id: string; action: string; entity: string; entity_id: string; changes: { columns?: string[] } | null; created_at: string }>;
}

// ---- RPCs de métricas (cálculo no banco)
export async function rpc<T>(ctx: Context, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await ctx.supabase.rpc(fn, args);
  if (error) throw new Error('consulta falhou');
  return data as T;
}
