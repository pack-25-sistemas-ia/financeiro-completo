import type { Metadata } from 'next';
import Link from 'next/link';
import { Alert, Badge, Card, EmptyState, PageHeader } from '@/components/ui/primitives';
import { Kpi, Money, Section } from '@/components/finance/bits';
import { AgingChartClient, BalanceChartClient, CategoryChartClient, CostCenterChartClient, FlowChartClient, MonthlyChartClient, PlannedActualChartClient, ProjectionChartClient } from '@/components/finance/charts-loader';
import { FilterBar } from '@/components/finance/filter-bar';
import { loadKpis, loadProjection, loadRealized, loadSeries, shortDate, type Kpis, type Series } from '@/lib/finance/dashboard';
import { formatDateBR } from '@/lib/finance/dates';
import { resolveFilters, type SearchParams } from '@/lib/finance/filters';
import { GOAL_LABELS } from '@/lib/finance/labels';
import { formatBRL } from '@/lib/finance/money';
import { accountOpts, categoryOpts, costCenterOpts, counterpartyOpts, loadRefs, pageCtx } from '@/lib/finance/page';

export const metadata: Metadata = { title: 'Painel financeiro' };

/** Variação em relação ao período anterior de mesmo tamanho; indisponível quando a base é zero. */
function Delta({ cur, prev, goodWhenUp = true }: { cur: number; prev: number; goodWhenUp?: boolean }) {
  if (prev === 0) return <p className="mt-1 text-xs text-muted">Comparativo indisponível (período anterior sem movimento)</p>;
  const pct = Math.round(((cur - prev) * 10000) / Math.abs(prev)) / 100;
  const up = pct >= 0;
  return <p className={`mt-1 text-xs ${up === goodWhenUp ? 'text-success' : 'text-danger'}`}>{up ? '▲' : '▼'} {Math.abs(pct).toLocaleString('pt-BR')}% vs período anterior</p>;
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const p = await pageCtx();
  const { ctx } = p;
  const f = resolveFilters(sp, p.tz);
  const refs = await loadRefs(ctx);
  // Rotinas idempotentes (recorrências do dia e avisos): não dependem de agendador. Falha aqui não impede o painel.
  if (p.perms.analyst) await ctx.supabase.rpc('fin_run_routines', { p_org: p.org }).then(() => null, () => null);

  let kpis: Kpis | null = null;
  let series: Series | null = null;
  let flow: Awaited<ReturnType<typeof loadRealized>> = [];
  let projections: Record<'base' | 'conservative' | 'optimistic', Awaited<ReturnType<typeof loadProjection>>> | null = null;
  let failed = false;
  try {
    const gran = (Date.parse(f.to) - Date.parse(f.from)) / 86_400_000 > 120 ? 'month' : (Date.parse(f.to) - Date.parse(f.from)) / 86_400_000 > 31 ? 'week' : 'day';
    const [k, s, fl, b, c, o] = await Promise.all([
      loadKpis(ctx, f), loadSeries(ctx, f), loadRealized(ctx, f.from, f.to, gran, f.account),
      loadProjection(ctx, 30, 'day', 'base', f.account), loadProjection(ctx, 30, 'day', 'conservative', f.account), loadProjection(ctx, 30, 'day', 'optimistic', f.account),
    ]);
    kpis = k; series = s; flow = fl; projections = { base: b, conservative: c, optimistic: o };
  } catch {
    failed = true;
  }

  const filtersBar = <FilterBar action="/dashboard" filters={f} accounts={accountOpts(refs.accounts)} categories={categoryOpts(refs.categories)} costCenters={costCenterOpts(refs.costCenters)} counterparties={counterpartyOpts(refs.counterparties)} />;

  if (failed || !kpis || !series || !projections) {
    return (
      <>
        <PageHeader title="Painel financeiro" description="Indicadores calculados no banco de dados a partir dos movimentos efetivos e dos títulos." />
        {filtersBar}
        <Alert tone="error">Não foi possível consultar os indicadores agora. <Link className="underline" href="/dashboard">Tentar novamente</Link>.</Alert>
      </>
    );
  }
  if (refs.accounts.length === 0) {
    return (
      <>
        <PageHeader title="Painel financeiro" description="Indicadores calculados no banco de dados a partir dos movimentos efetivos e dos títulos." />
        <EmptyState title="Comece cadastrando uma conta financeira" description="Com o saldo inicial informado, o painel passa a mostrar saldo, entradas, saídas e projeções reais.">
          {p.perms.manager ? <Link className="inline-flex min-h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground" href="/contas">Cadastrar conta</Link> : <p className="text-sm text-muted">Peça a um administrador ou gestor financeiro para cadastrar as contas.</p>}
        </EmptyState>
      </>
    );
  }

  const k = kpis;
  const gran = flow.length > 62 ? 'month' : 'day';
  const projRows = projections.base.map((r, i) => ({ label: shortDate(r.period), base: r.balance_cents, conservative: projections!.conservative[i]?.balance_cents ?? 0, optimistic: projections!.optimistic[i]?.balance_cents ?? 0 }));
  const minProj = projections.base.reduce((m, r) => Math.min(m, r.balance_cents), Number.MAX_SAFE_INTEGER);
  const firstNeg = projections.base.find((r) => r.balance_cents < 0);
  const alerts: Array<{ tone: 'warning' | 'error'; text: React.ReactNode }> = [];
  if (k.payables_overdue_count > 0) alerts.push({ tone: 'error', text: <>Há <strong>{k.payables_overdue_count}</strong> parcela(s) a pagar vencida(s): <Money cents={k.payables_overdue_cents} />. <Link className="underline" href="/pagar?venc=vencidas">Ver</Link></> });
  if (k.receivables_overdue_count > 0) alerts.push({ tone: 'warning', text: <>Há <strong>{k.receivables_overdue_count}</strong> parcela(s) a receber atrasada(s): <Money cents={k.receivables_overdue_cents} />. <Link className="underline" href="/receber?venc=vencidas">Ver</Link></> });
  if (k.payables_due_today_count > 0) alerts.push({ tone: 'warning', text: <><strong>{k.payables_due_today_count}</strong> parcela(s) a pagar vencem hoje (<Money cents={k.payables_due_today_cents} />). <Link className="underline" href="/pagar?venc=hoje">Ver</Link></> });
  if (k.partial_payables_count > 0) alerts.push({ tone: 'warning', text: <><strong>{k.partial_payables_count}</strong> parcela(s) a pagar parcialmente paga(s). <Link className="underline" href="/pagar?venc=parciais">Ver</Link></> });
  if (firstNeg) alerts.push({ tone: 'error', text: <>O saldo projetado (cenário base) fica negativo em <strong>{formatDateBR(firstNeg.period)}</strong> (mínimo {formatBRL(minProj)}). <Link className="underline" href="/fluxo-caixa?aba=projetado">Ver projeção</Link></> });
  for (const a of k.negative_accounts) alerts.push({ tone: 'error', text: <>A conta <strong>{a.name}</strong> está com saldo negativo (<Money cents={a.balance_cents} />).</> });

  return (
    <>
      <PageHeader title="Painel financeiro" description={`Período: ${formatDateBR(f.from)} a ${formatDateBR(f.to)} · regime de caixa para realizados; títulos pendentes e projeções são previsões, não dinheiro garantido.`} />
      {filtersBar}
      {alerts.length ? <div className="mb-6 space-y-2" aria-label="Alertas financeiros">{alerts.map((a, i) => <Alert key={i} tone={a.tone}>{a.text}</Alert>)}</div> : null}

      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Saldo consolidado atual" tone={k.balance_now_cents < 0 ? 'danger' : 'neutral'} value={<Money cents={k.balance_now_cents} />} definition="Saldo inicial + entradas − saídas efetivas das contas incluídas no consolidado, até agora. Contas a receber não entram." />
        <Kpi label="Receitas realizadas" tone="success" value={<Money cents={k.income_cents} />} definition="Recebimentos efetivos no período, líquidos de estornos. Transferências e ajustes não contam."><Delta cur={k.income_cents} prev={k.previous_income_cents} /></Kpi>
        <Kpi label="Despesas realizadas" value={<Money cents={k.expense_cents} />} definition="Pagamentos efetivos no período, líquidos de estornos. Transferências e ajustes não contam."><Delta cur={k.expense_cents} prev={k.previous_expense_cents} goodWhenUp={false} /></Kpi>
        <Kpi label="Resultado líquido de caixa" tone={k.net_cents < 0 ? 'danger' : 'success'} value={<Money cents={k.net_cents} signed />} definition="Receitas realizadas − despesas realizadas no período."><Delta cur={k.net_cents} prev={k.previous_net_cents} /></Kpi>
        <Kpi label="Contas a pagar" value={<Money cents={k.payables_pending_cents} />} definition="Saldo ainda pendente dos títulos a pagar (previsto, não pago)." />
        <Kpi label="Contas a receber" value={<Money cents={k.receivables_pending_cents} />} definition="Saldo ainda pendente dos títulos a receber (previsto, não recebido)." />
        <Kpi label="Valores vencidos" tone={k.payables_overdue_cents + k.receivables_overdue_cents > 0 ? 'warning' : 'neutral'} value={<span className="text-lg">A pagar <Money cents={k.payables_overdue_cents} /> · A receber <Money cents={k.receivables_overdue_cents} /></span>} definition="Pendente de parcelas com vencimento anterior a hoje." />
        <Kpi label="Saldo projetado em 30 dias" tone={k.projected_30d_cents < 0 ? 'danger' : 'neutral'} value={<Money cents={k.projected_30d_cents} />} definition="Hipótese (cenário base): saldo atual + pendentes a receber − pendentes a pagar até 30 dias, incluindo vencidos e recorrências previstas. Não é garantia." />
        <Kpi label="Ticket médio de recebimentos" value={k.avg_ticket_cents === null ? <span className="text-base text-muted">Indisponível</span> : <Money cents={k.avg_ticket_cents} />} definition={`Receitas realizadas ÷ ${k.receipts_count} recebimento(s) individual(is) não estornado(s) no período (cada baixa conta uma vez; não é por título quitado).`} />
        <Kpi label="Maior categoria de despesa" value={series.expense_by_category[0] ? <span className="text-lg">{series.expense_by_category[0].name}</span> : <span className="text-base text-muted">Sem despesas</span>} definition={series.expense_by_category[0] ? `${formatBRL(series.expense_by_category[0].cents)} (${(series.expense_by_category[0].share_bps / 100).toLocaleString('pt-BR')}% das despesas realizadas).` : 'Nenhuma despesa realizada no período.'} />
        <Kpi label="Vencendo em 7 dias (a pagar)" value={<Money cents={k.payables_due_7d_cents} />} definition={`${k.payables_due_7d_count} parcela(s) a pagar até 7 dias; ${k.payables_due_30d_count} (${formatBRL(k.payables_due_30d_cents)}) até 30 dias.`} />
        <Kpi label="Parciais" value={<span className="text-lg">{k.partial_payables_count} a pagar · {k.partial_receivables_count} a receber</span>} definition="Parcelas com baixa parcial e saldo restante." />
      </div>

      {k.goals.length ? (
        <Section title="Metas">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {k.goals.map((g) => (
              <Card key={g.id} className="p-4">
                <p className="font-medium">{g.name} <Badge>{GOAL_LABELS[g.metric_type as keyof typeof GOAL_LABELS] ?? g.metric_type}</Badge></p>
                <p className="mt-1 text-sm text-muted">{formatDateBR(g.period_start)} a {formatDateBR(g.period_end)}</p>
                <p className="mt-2 tabular-nums"><Money cents={g.actual_cents} /> de <Money cents={g.target_cents} /></p>
                <progress className="mt-2 h-2 w-full" max={100} value={Math.min(100, g.progress_bps / 100)} aria-label={`Progresso da meta ${g.name}`} />
                <p className="mt-1 text-xs text-muted">{(g.progress_bps / 100).toLocaleString('pt-BR')}% da meta (caixa realizado)</p>
              </Card>
            ))}
          </div>
        </Section>
      ) : null}

      <Section title="Gráficos">
        <div className="grid gap-4 xl:grid-cols-2">
          <MonthlyChartClient rows={series.monthly.map((m) => ({ label: shortDate(m.month, 'month'), income: m.income_cents, expense: m.expense_cents }))} />
          <BalanceChartClient rows={series.balance.map((b) => ({ label: shortDate(b.date), balance: b.balance_cents }))} />
          <FlowChartClient title="Fluxo de caixa realizado" description="Entradas e saídas operacionais efetivas e o saldo no fim de cada período (transferências e ajustes entram só no saldo)." rows={flow.map((r) => ({ label: shortDate(r.period, gran), inflow: r.inflow_cents, outflow: r.outflow_cents, balance: r.closing_balance_cents }))} />
          <ProjectionChartClient rows={projRows} />
          <CategoryChartClient title="Despesas por categoria" income={false} rows={series.expense_by_category.map((c) => ({ name: c.name, cents: c.cents, share: c.share_bps }))} />
          <CategoryChartClient title="Receitas por categoria" income rows={series.income_by_category.map((c) => ({ name: c.name, cents: c.cents, share: c.share_bps }))} />
          <AgingChartClient title="Contas a pagar por vencimento" income={false} rows={series.payables_aging.map((b) => ({ label: b.label, cents: b.cents, count: b.count }))} />
          <AgingChartClient title="Contas a receber por vencimento" income rows={series.receivables_aging.map((b) => ({ label: b.label, cents: b.cents, count: b.count }))} />
          <PlannedActualChartClient rows={series.planned_vs_actual.map((r) => ({ label: shortDate(r.month, 'month'), plannedIncome: r.planned_income_cents, actualIncome: r.actual_income_cents, plannedExpense: r.planned_expense_cents, actualExpense: r.actual_expense_cents }))} />
          <CostCenterChartClient rows={series.cost_centers.map((c) => ({ name: c.name, income: c.income_cents, expense: c.expense_cents }))} />
        </div>
      </Section>
    </>
  );
}
