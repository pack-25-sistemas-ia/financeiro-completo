import 'server-only';
import type { Context } from '@/lib/auth/session';
import { rpc } from './data';
import type { Filters } from './filters';
import type { Granularity, Scenario } from './labels';

export type Kpis = {
  period: { from: string; to: string; today: string; previous_from: string; previous_to: string };
  balance_now_cents: number; balance_period_end_cents: number; income_cents: number; expense_cents: number; net_cents: number;
  previous_income_cents: number; previous_expense_cents: number; previous_net_cents: number;
  payables_pending_cents: number; receivables_pending_cents: number; payables_overdue_cents: number; receivables_overdue_cents: number; payables_overdue_count: number; receivables_overdue_count: number;
  payables_due_today_cents: number; payables_due_today_count: number; payables_due_7d_cents: number; payables_due_7d_count: number; payables_due_30d_cents: number; payables_due_30d_count: number;
  partial_payables_count: number; partial_receivables_count: number; projected_30d_cents: number; receipts_count: number; avg_ticket_cents: number | null;
  goals: Array<{ id: string; name: string; metric_type: string; target_cents: number; period_start: string; period_end: string; actual_cents: number; progress_bps: number }>;
  negative_accounts: Array<{ id: string; name: string; balance_cents: number }>;
};
export type Series = {
  monthly: Array<{ month: string; income_cents: number; expense_cents: number }>;
  balance: Array<{ date: string; balance_cents: number }>;
  expense_by_category: Array<{ category_id: string | null; name: string; cents: number; share_bps: number }>;
  income_by_category: Array<{ category_id: string | null; name: string; cents: number; share_bps: number }>;
  cost_centers: Array<{ cost_center_id: string; code: string; name: string; income_cents: number; expense_cents: number; net_cents: number }>;
  payables_aging: Array<{ bucket: string; label: string; cents: number; count: number }>;
  receivables_aging: Array<{ bucket: string; label: string; cents: number; count: number }>;
  planned_vs_actual: Array<{ month: string; planned_income_cents: number; actual_income_cents: number; planned_expense_cents: number; actual_expense_cents: number }>;
};
export type ProjectionRow = { period: string; inflow_cents: number; outflow_cents: number; net_cents: number; balance_cents: number };
export type RealizedRow = { period: string; inflow_cents: number; outflow_cents: number; transfers_net_cents: number; adjustments_net_cents: number; net_cents: number; closing_balance_cents: number };

const args = (org: string, f: Filters) => ({ p_org: org, p_from: f.from, p_to: f.to, p_account: f.account, p_category: f.category, p_cost_center: f.costCenter, p_counterparty: f.counterparty });

export const loadKpis = (ctx: Context, f: Filters) => rpc<Kpis>(ctx, 'fin_dashboard_kpis', args(ctx.membership.organization_id, f));
export const loadSeries = (ctx: Context, f: Filters) => rpc<Series>(ctx, 'fin_dashboard_series', args(ctx.membership.organization_id, f));
export const loadProjection = (ctx: Context, days: number, gran: Granularity, scenario: Scenario, account: string | null) =>
  rpc<ProjectionRow[]>(ctx, 'fin_cashflow_projection', { p_org: ctx.membership.organization_id, p_days: days, p_gran: gran, p_scenario: scenario, p_account: account });
export const loadRealized = (ctx: Context, from: string, to: string, gran: Granularity, account: string | null) =>
  rpc<RealizedRow[]>(ctx, 'fin_cashflow_realized', { p_org: ctx.membership.organization_id, p_from: from, p_to: to, p_gran: gran, p_account: account });
export const loadOpening = (ctx: Context, from: string, account: string | null) => rpc<number>(ctx, 'fin_cashflow_opening', { p_org: ctx.membership.organization_id, p_from: from, p_account: account });

/** Rótulo curto de data para eixos: «15/06». Mês: «06/2025». */
export function shortDate(iso: string, gran: Granularity | 'month' = 'day'): string {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return gran === 'month' ? `${m}/${y}` : `${d}/${m}`;
}
