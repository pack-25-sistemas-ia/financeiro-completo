import 'server-only';
import type { Context } from '@/lib/auth/session';
import { toCsv, type CsvValue } from './csv';
import { loadOpening, loadProjection, loadRealized, loadSeries, type Series } from './dashboard';
import { listInstallments, listMovements, rpc, type InstallmentRow, type MovementRow } from './data';
import { addDays, formatDateBR, todayIn } from './dates';
import type { Filters } from './filters';
import { MOVEMENT_LABELS, STATUS_LABELS, type Granularity, type Scenario } from './labels';
import { divideRound, formatPlain } from './money';

export type ColKind = 'text' | 'money' | 'date' | 'int' | 'pct';
export type Col = { key: string; label: string; kind: ColKind };
export type Cell = string | number | null;
export type Report = { name: string; title: string; description: string; regime: string; cols: Col[]; rows: Array<Record<string, Cell>>; totals?: Record<string, number>; truncated?: boolean; note?: string };

export const REPORT_LIST: Array<{ name: string; title: string; description: string; group: string }> = [
  { name: 'fluxo-realizado', title: 'Fluxo de caixa realizado', description: 'Entradas, saídas, transferências, ajustes e saldo por período (caixa).', group: 'Fluxo de caixa' },
  { name: 'fluxo-projetado', title: 'Fluxo de caixa projetado', description: 'Saldo projetado por data nos cenários base, conservador e otimista (hipótese).', group: 'Fluxo de caixa' },
  { name: 'extrato', title: 'Extrato por conta', description: 'Movimentos de uma conta com saldo corrente.', group: 'Fluxo de caixa' },
  { name: 'movimentacoes', title: 'Movimentações consolidadas', description: 'Todos os movimentos efetivos das contas no período.', group: 'Fluxo de caixa' },
  { name: 'contas-pagar', title: 'Contas a pagar', description: 'Parcelas a pagar com situação, pago e pendente.', group: 'Títulos' },
  { name: 'contas-receber', title: 'Contas a receber', description: 'Parcelas a receber com situação, recebido e pendente.', group: 'Títulos' },
  { name: 'vencimentos', title: 'Previsão de vencimentos', description: 'Pendentes a pagar e a receber por data de vencimento (inclui vencidos).', group: 'Títulos' },
  { name: 'despesas-categoria', title: 'Despesas por categoria', description: 'Por caixa (pago) ou competência (fato gerador).', group: 'Resultados' },
  { name: 'receitas-categoria', title: 'Receitas por categoria', description: 'Por caixa (recebido) ou competência (fato gerador).', group: 'Resultados' },
  { name: 'centros-custo', title: 'Resultados por centro de custo', description: 'Receitas e despesas realizadas, ponderadas pelo rateio.', group: 'Resultados' },
  { name: 'mensal', title: 'Comparativo mensal — Resumo gerencial de receitas e despesas', description: 'Caixa e competência lado a lado. Demonstrativo gerencial, não é DRE contábil.', group: 'Resultados' },
  { name: 'previsto-realizado', title: 'Previsto × realizado', description: 'Parcelas com vencimento no mês × baixas efetivas no mês.', group: 'Resultados' },
  { name: 'pendencias-conciliacao', title: 'Pendências de conciliação', description: 'Linhas de extrato ainda sem conciliar, divergentes ou ignoradas.', group: 'Controle' },
  { name: 'fornecedores', title: 'Pagamentos por fornecedor', description: 'Pago no período, pendente e vencido por fornecedor.', group: 'Contrapartes' },
  { name: 'clientes', title: 'Recebimentos por cliente', description: 'Recebido no período, pendente e vencido por cliente.', group: 'Contrapartes' },
];
export const REPORT_NAMES = REPORT_LIST.map((r) => r.name);

export type ReportOpts = { gran?: Granularity; days?: number; scenario?: Scenario; regime?: 'cash' | 'accrual'; status?: string | null; venc?: string | null; maxRows?: number };
const num = (k: string, label: string, kind: ColKind = 'money'): Col => ({ key: k, label, kind });
const MAX_EXPORT = 5000;

async function allInstallments(ctx: Context, tz: string, type: 'payable' | 'receivable', f: Filters, o: ReportOpts) {
  const out: InstallmentRow[] = [];
  const cap = o.maxRows ?? MAX_EXPORT;
  for (let page = 1; out.length < cap; page++) {
    const { rows } = await listInstallments(ctx, tz, { type, from: f.from, to: f.to, counterparty: f.counterparty, category: f.category, account: f.account, status: o.status ?? undefined, venc: o.venc ?? undefined, page }, 1000);
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return { rows: out.slice(0, cap), truncated: out.length >= cap };
}

export async function buildReport(ctx: Context, tz: string, name: string, f: Filters, o: ReportOpts = {}): Promise<Report | null> {
  const org = ctx.membership.organization_id;
  const days = (Date.parse(f.to) - Date.parse(f.from)) / 86_400_000;
  const meta = REPORT_LIST.find((r) => r.name === name);
  if (!meta) return null;
  const base = { name, title: meta.title, description: meta.description };

  switch (name) {
    case 'fluxo-realizado': {
      const gran: Granularity = o.gran ?? (days > 120 ? 'month' : days > 31 ? 'week' : 'day');
      const [rows, opening] = await Promise.all([loadRealized(ctx, f.from, f.to, gran, f.account), loadOpening(ctx, f.from, f.account)]);
      return { ...base, regime: 'Caixa (movimentos efetivos)', note: `Saldo inicial do período: ${formatPlain(opening).replace('.', ',')}. Saldo final = saldo inicial + entradas − saídas ± transferências ± ajustes.`,
        cols: [{ key: 'period', label: gran === 'month' ? 'Mês' : gran === 'week' ? 'Semana (segunda)' : 'Dia', kind: 'date' }, num('inflow', 'Entradas'), num('outflow', 'Saídas'), num('transfers', 'Transferências'), num('adjustments', 'Ajustes'), num('net', 'Variação'), num('closing', 'Saldo final')],
        rows: rows.map((r) => ({ period: r.period, inflow: r.inflow_cents, outflow: r.outflow_cents, transfers: r.transfers_net_cents, adjustments: r.adjustments_net_cents, net: r.net_cents, closing: r.closing_balance_cents })),
        totals: { inflow: rows.reduce((a, r) => a + r.inflow_cents, 0), outflow: rows.reduce((a, r) => a + r.outflow_cents, 0), transfers: rows.reduce((a, r) => a + r.transfers_net_cents, 0), adjustments: rows.reduce((a, r) => a + r.adjustments_net_cents, 0), net: rows.reduce((a, r) => a + r.net_cents, 0) } };
    }
    case 'fluxo-projetado': {
      const horizon = Math.min(365, Math.max(1, o.days ?? 30));
      const gran: Granularity = o.gran ?? (horizon > 120 ? 'month' : horizon > 45 ? 'week' : 'day');
      const [b, c, op] = await Promise.all([loadProjection(ctx, horizon, gran, 'base', f.account), loadProjection(ctx, horizon, gran, 'conservative', f.account), loadProjection(ctx, horizon, gran, 'optimistic', f.account)]);
      return { ...base, regime: 'Previsto (hipótese, não garantia)', note: 'Usa apenas o saldo pendente dos títulos e as recorrências previstas; vencidos entram em «hoje». Parâmetros dos cenários em Configurações financeiras.',
        cols: [{ key: 'period', label: 'Período', kind: 'date' }, num('inflow', 'Recebimentos previstos'), num('outflow', 'Pagamentos previstos'), num('base', 'Saldo — base'), num('conservative', 'Saldo — conservador'), num('optimistic', 'Saldo — otimista')],
        rows: b.map((r, i) => ({ period: r.period, inflow: r.inflow_cents, outflow: r.outflow_cents, base: r.balance_cents, conservative: c[i]?.balance_cents ?? null, optimistic: op[i]?.balance_cents ?? null })) };
    }
    case 'extrato':
    case 'movimentacoes': {
      if (name === 'extrato' && !f.account) return { ...base, regime: 'Caixa', cols: [], rows: [], note: 'Selecione uma conta para ver o extrato.' };
      const rows: MovementRow[] = [];
      for (let page = 1; rows.length < (o.maxRows ?? MAX_EXPORT); page++) {
        const r = await listMovements(ctx, tz, { account: f.account, from: f.from, to: f.to, page }, 1000);
        rows.push(...r.rows);
        if (r.rows.length < 1000) break;
      }
      rows.sort((a, b) => a.effective_at.localeCompare(b.effective_at));
      let running = f.account ? await loadOpening(ctx, f.from, f.account) : null;
      const cols: Col[] = [{ key: 'date', label: 'Data', kind: 'date' }, ...(name === 'movimentacoes' || !f.account ? [{ key: 'account', label: 'Conta', kind: 'text' as const }] : []), { key: 'type', label: 'Tipo', kind: 'text' }, { key: 'desc', label: 'Descrição', kind: 'text' }, { key: 'party', label: 'Contraparte', kind: 'text' }, { key: 'cat', label: 'Categoria', kind: 'text' }, num('in', 'Entrada'), num('out', 'Saída'), ...(running !== null ? [num('balance', 'Saldo')] : [])];
      return { ...base, regime: 'Caixa (movimentos efetivos)', cols, truncated: rows.length >= (o.maxRows ?? MAX_EXPORT),
        note: running !== null ? 'Saldo corrente = saldo inicial do período + movimentos em ordem cronológica.' : undefined,
        rows: rows.map((m) => { if (running !== null) running += m.amount_cents; return { date: m.effective_at.slice(0, 10), account: m.account_name, type: MOVEMENT_LABELS[m.movement_type] ?? m.movement_type, desc: m.entry_description ?? m.description, party: m.counterparty_name, cat: m.category_name, in: m.amount_cents > 0 ? m.amount_cents : null, out: m.amount_cents < 0 ? -m.amount_cents : null, balance: running }; }) };
    }
    case 'contas-pagar':
    case 'contas-receber': {
      const type = name === 'contas-pagar' ? 'payable' : 'receivable';
      const { rows, truncated } = await allInstallments(ctx, tz, type, f, o);
      return { ...base, regime: 'Títulos (previsto) e baixas (realizado)', truncated,
        cols: [{ key: 'due', label: 'Vencimento', kind: 'date' }, { key: 'desc', label: 'Descrição', kind: 'text' }, { key: 'part', label: 'Parcela', kind: 'text' }, { key: 'party', label: type === 'payable' ? 'Fornecedor' : 'Cliente', kind: 'text' }, { key: 'cat', label: 'Categoria', kind: 'text' }, { key: 'comp', label: 'Competência', kind: 'date' }, num('amount', 'Valor'), num('paid', type === 'payable' ? 'Pago' : 'Recebido'), num('pending', 'Pendente'), { key: 'status', label: 'Situação', kind: 'text' }],
        rows: rows.map((r) => ({ due: r.due_date, desc: r.description, part: `${r.installment_number}/${r.total_installments}`, party: r.counterparty_name, cat: r.category_name, comp: r.competence_date, amount: r.amount_cents, paid: r.paid_cents, pending: r.pending_cents, status: STATUS_LABELS[type][r.status] + (r.is_overdue ? ' (vencida)' : '') })),
        totals: { amount: rows.reduce((a, r) => a + r.amount_cents, 0), paid: rows.reduce((a, r) => a + r.paid_cents, 0), pending: rows.reduce((a, r) => a + r.pending_cents, 0) } };
    }
    case 'vencimentos': {
      const today = todayIn(tz);
      const horizon = Math.min(365, Math.max(1, o.days ?? 30));
      const rows: Array<{ type: string; r: InstallmentRow }> = [];
      for (const type of ['payable', 'receivable'] as const) {
        const { rows: rs } = await listInstallments(ctx, tz, { type, to: addDays(today, horizon), account: f.account, category: f.category, counterparty: f.counterparty, status: undefined }, 1000);
        for (const r of rs) if (r.pending_cents > 0 && r.status !== 'cancelled') rows.push({ type: type === 'payable' ? 'A pagar' : 'A receber', r });
      }
      rows.sort((a, b) => a.r.due_date.localeCompare(b.r.due_date));
      return { ...base, regime: 'Previsto', note: `Pendentes com vencimento até ${formatDateBR(addDays(today, horizon))}, incluindo vencidos.`,
        cols: [{ key: 'due', label: 'Vencimento', kind: 'date' }, { key: 'type', label: 'Tipo', kind: 'text' }, { key: 'desc', label: 'Descrição', kind: 'text' }, { key: 'party', label: 'Contraparte', kind: 'text' }, num('pending', 'Pendente'), { key: 'late', label: 'Atraso (dias)', kind: 'int' }],
        rows: rows.map(({ type, r }) => ({ due: r.due_date, type, desc: r.description, party: r.counterparty_name, pending: r.pending_cents, late: r.is_overdue ? Math.round((Date.parse(today) - Date.parse(r.due_date)) / 86_400_000) : 0 })),
        totals: { pending: rows.reduce((a, x) => a + (x.type === 'A pagar' ? -x.r.pending_cents : x.r.pending_cents), 0) } };
    }
    case 'despesas-categoria':
    case 'receitas-categoria': {
      const nature = name === 'despesas-categoria' ? 'expense' : 'income';
      const regime = o.regime ?? 'cash';
      const rows = await rpc<Array<{ category_id: string | null; name: string; parent_name: string | null; cents: number; count: number }>>(ctx, 'fin_report_by_category', { p_org: org, p_from: f.from, p_to: f.to, p_nature: nature, p_regime: regime, p_account: f.account });
      const total = rows.reduce((a, r) => a + r.cents, 0);
      return { ...base, regime: regime === 'cash' ? 'Caixa (baixas efetivas)' : 'Competência (data do fato gerador)', cols: [{ key: 'name', label: 'Categoria', kind: 'text' }, { key: 'parent', label: 'Categoria-pai', kind: 'text' }, num('cents', 'Valor'), { key: 'share', label: '% do total', kind: 'pct' }, { key: 'count', label: regime === 'cash' ? 'Baixas' : 'Títulos', kind: 'int' }],
        rows: rows.map((r) => ({ name: r.name, parent: r.parent_name, cents: r.cents, share: total ? (divideRound(r.cents * 10000, total) ?? 0) : 0, count: r.count })), totals: { cents: total } };
    }
    case 'centros-custo': {
      const rows = await rpc<Array<{ code: string | null; name: string; income_cents: number; expense_cents: number; net_cents: number }>>(ctx, 'fin_report_cost_centers', { p_org: org, p_from: f.from, p_to: f.to });
      return { ...base, regime: 'Caixa (rateio proporcional)', cols: [{ key: 'code', label: 'Código', kind: 'text' }, { key: 'name', label: 'Centro de custo', kind: 'text' }, num('income', 'Receitas'), num('expense', 'Despesas'), num('net', 'Resultado')],
        rows: rows.map((r) => ({ code: r.code, name: r.name, income: r.income_cents, expense: r.expense_cents, net: r.net_cents })), totals: { income: rows.reduce((a, r) => a + r.income_cents, 0), expense: rows.reduce((a, r) => a + r.expense_cents, 0), net: rows.reduce((a, r) => a + r.net_cents, 0) } };
    }
    case 'mensal': {
      const rows = await rpc<Array<{ month: string; cash_income_cents: number; cash_expense_cents: number; cash_net_cents: number; accrual_income_cents: number; accrual_expense_cents: number; accrual_net_cents: number }>>(ctx, 'fin_report_monthly', { p_org: org, p_from: f.from, p_to: f.to, p_account: f.account });
      return { ...base, regime: 'Caixa e competência (lado a lado)', note: 'Resumo gerencial. Não é DRE nem demonstração contábil oficial.',
        cols: [{ key: 'month', label: 'Mês', kind: 'date' }, num('ci', 'Receitas (caixa)'), num('ce', 'Despesas (caixa)'), num('cn', 'Resultado (caixa)'), num('ai', 'Receitas (competência)'), num('ae', 'Despesas (competência)'), num('an', 'Resultado (competência)')],
        rows: rows.map((r) => ({ month: r.month, ci: r.cash_income_cents, ce: r.cash_expense_cents, cn: r.cash_net_cents, ai: r.accrual_income_cents, ae: r.accrual_expense_cents, an: r.accrual_net_cents })),
        totals: { ci: rows.reduce((a, r) => a + r.cash_income_cents, 0), ce: rows.reduce((a, r) => a + r.cash_expense_cents, 0), cn: rows.reduce((a, r) => a + r.cash_net_cents, 0), ai: rows.reduce((a, r) => a + r.accrual_income_cents, 0), ae: rows.reduce((a, r) => a + r.accrual_expense_cents, 0), an: rows.reduce((a, r) => a + r.accrual_net_cents, 0) } };
    }
    case 'previsto-realizado': {
      const s: Series = await loadSeries(ctx, f);
      return { ...base, regime: 'Previsto (vencimento) × Realizado (caixa)', note: 'Critérios diferentes por definição: previsto = parcelas com vencimento no mês; realizado = baixas efetivas no mês.',
        cols: [{ key: 'month', label: 'Mês', kind: 'date' }, num('pi', 'Receita prevista'), num('ai', 'Receita realizada'), num('pe', 'Despesa prevista'), num('ae', 'Despesa realizada')],
        rows: s.planned_vs_actual.map((r) => ({ month: r.month, pi: r.planned_income_cents, ai: r.actual_income_cents, pe: r.planned_expense_cents, ae: r.actual_expense_cents })) };
    }
    case 'pendencias-conciliacao': {
      const { data } = await ctx.supabase.from('bank_statement_lines').select('account_id, transaction_date, amount_cents, description, external_reference, reconciliation_status, ignore_reason').eq('organization_id', org)
        .in('reconciliation_status', ['pending', 'divergent', 'ignored']).gte('transaction_date', f.from).lte('transaction_date', f.to).order('transaction_date').limit(MAX_EXPORT);
      const { data: acc } = await ctx.supabase.from('financial_accounts').select('id, name').eq('organization_id', org);
      const names = new Map((acc ?? []).map((a) => [a.id as string, a.name as string]));
      const lines = (data ?? []) as Array<{ account_id: string; transaction_date: string; amount_cents: number; description: string; external_reference: string | null; reconciliation_status: string; ignore_reason: string | null }>;
      const L: Record<string, string> = { pending: 'Pendente', divergent: 'Divergente', ignored: 'Ignorado' };
      return { ...base, regime: 'Extrato × livro de movimentos', cols: [{ key: 'date', label: 'Data', kind: 'date' }, { key: 'account', label: 'Conta', kind: 'text' }, { key: 'desc', label: 'Descrição', kind: 'text' }, { key: 'ref', label: 'Referência', kind: 'text' }, num('amount', 'Valor'), { key: 'status', label: 'Situação', kind: 'text' }, { key: 'why', label: 'Justificativa', kind: 'text' }],
        rows: lines.map((l) => ({ date: l.transaction_date, account: names.get(l.account_id) ?? '—', desc: l.description, ref: l.external_reference, amount: l.amount_cents, status: L[l.reconciliation_status] ?? l.reconciliation_status, why: l.ignore_reason })) };
    }
    case 'fornecedores':
    case 'clientes': {
      const kind = name === 'fornecedores' ? 'supplier' : 'customer';
      const rows = await rpc<Array<{ name: string; settled_cents: number; pending_cents: number; overdue_cents: number; settlements: number }>>(ctx, 'fin_report_by_counterparty', { p_org: org, p_from: f.from, p_to: f.to, p_kind: kind });
      return { ...base, regime: 'Caixa (período) + posição atual', note: 'Liquidado no período; pendente e vencido refletem a posição de hoje.',
        cols: [{ key: 'name', label: kind === 'supplier' ? 'Fornecedor' : 'Cliente', kind: 'text' }, num('settled', kind === 'supplier' ? 'Pago no período' : 'Recebido no período'), num('pending', 'Pendente'), num('overdue', 'Vencido'), { key: 'n', label: kind === 'supplier' ? 'Pagamentos' : 'Recebimentos', kind: 'int' }],
        rows: rows.map((r) => ({ name: r.name, settled: r.settled_cents, pending: r.pending_cents, overdue: r.overdue_cents, n: r.settlements })),
        totals: { settled: rows.reduce((a, r) => a + r.settled_cents, 0), pending: rows.reduce((a, r) => a + r.pending_cents, 0), overdue: rows.reduce((a, r) => a + r.overdue_cents, 0) } };
    }
    default: return null;
  }
}

/** CSV do relatório: texto neutralizado contra fórmulas; valores com ponto decimal e 2 casas. */
export function reportToCsv(r: Report): string {
  const conv = (c: Col, v: Cell): CsvValue => {
    if (v === null || v === undefined) return '';
    switch (c.kind) {
      case 'money': return { num: formatPlain(Number(v)) };
      case 'pct': return { num: (Number(v) / 100).toFixed(2) };
      case 'int': return Number(v);
      case 'date': return formatDateBR(String(v).slice(0, 10));
      default: return String(v);
    }
  };
  const rows = r.rows.map((row) => r.cols.map((c) => conv(c, row[c.key] ?? null)));
  if (r.totals) rows.push(r.cols.map((c, i) => (i === 0 ? 'TOTAL' : r.totals![c.key] !== undefined ? conv(c, r.totals![c.key]!) : '')));
  return toCsv(r.cols.map((c) => c.label), rows);
}
