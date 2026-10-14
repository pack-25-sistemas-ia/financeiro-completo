import type { Metadata } from 'next';
import Link from 'next/link';
import { Alert, PageHeader } from '@/components/ui/primitives';
import { Kpi, Money, Section, TD, TH, TableShell, Tabs } from '@/components/finance/bits';
import { FlowChartClient, ProjectionChartClient } from '@/components/finance/charts-loader';
import { FilterBar, ListFilters } from '@/components/finance/filter-bar';
import { loadOpening, loadProjection, loadRealized, shortDate } from '@/lib/finance/dashboard';
import { formatDateBR } from '@/lib/finance/dates';
import { one, resolveFilters, uuidOrNull, withParams, type SearchParams } from '@/lib/finance/filters';
import { GRANULARITIES, GRANULARITY_LABELS, SCENARIO_LABELS, type Granularity } from '@/lib/finance/labels';
import { formatBRL } from '@/lib/finance/money';
import { accountOpts, loadRefs, pageCtx } from '@/lib/finance/page';

export const metadata: Metadata = { title: 'Fluxo de caixa' };

export default async function FluxoCaixaPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const p = await pageCtx();
  const refs = await loadRefs(p.ctx);
  const tab = one(sp.aba) === 'projetado' ? 'projetado' : 'realizado';
  const f = resolveFilters(sp, p.tz);
  const tabs = [{ key: 'realizado', label: 'Realizado', href: withParams('/fluxo-caixa', sp, { aba: null, days: null, gran: null }) }, { key: 'projetado', label: 'Projetado', href: withParams('/fluxo-caixa', sp, { aba: 'projetado' }) }];
  const granParam = one(sp.gran) as Granularity | undefined;
  const exportBtn = (qs: string, name: string) => (p.perms.manager ? <a className="inline-flex min-h-10 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/5" href={`/api/export/${name}?${qs}`}>Exportar CSV</a> : null);

  if (tab === 'realizado') {
    const span = (Date.parse(f.to) - Date.parse(f.from)) / 86_400_000;
    const gran: Granularity = granParam && GRANULARITIES.includes(granParam) ? granParam : span > 120 ? 'month' : span > 31 ? 'week' : 'day';
    let rows: Awaited<ReturnType<typeof loadRealized>> = [];
    let opening = 0;
    let failed = false;
    try { [rows, opening] = await Promise.all([loadRealized(p.ctx, f.from, f.to, gran, f.account), loadOpening(p.ctx, f.from, f.account)]); } catch { failed = true; }
    const tot = rows.reduce((a, r) => ({ i: a.i + r.inflow_cents, o: a.o + r.outflow_cents, t: a.t + r.transfers_net_cents, j: a.j + r.adjustments_net_cents }), { i: 0, o: 0, t: 0, j: 0 });
    const closing = rows.at(-1)?.closing_balance_cents ?? opening;
    const qs = new URLSearchParams(Object.entries({ period: f.period, from: f.from, to: f.to, account: f.account ?? '', gran }).filter(([, v]) => v) as Array<[string, string]>).toString();
    return (
      <>
        <PageHeader title="Fluxo de caixa" description="Realizado: o que de fato entrou e saiu das contas (regime de caixa).">{exportBtn(qs, 'fluxo-realizado')}</PageHeader>
        <Tabs items={tabs} current={tab} />
        <FilterBar action="/fluxo-caixa" filters={f} accounts={accountOpts(refs.accounts)} />
        {failed ? <Alert tone="error">Não foi possível consultar o fluxo agora. <Link className="underline" href="/fluxo-caixa">Tentar novamente</Link>.</Alert> : (
          <>
            <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <Kpi label="Saldo inicial do período" value={<Money cents={opening} />} definition={`Saldo ao fim de ${formatDateBR(new Date(Date.parse(f.from) - 86_400_000).toISOString().slice(0, 10))}.`} />
              <Kpi label="Entradas" tone="success" value={<Money cents={tot.i} />} definition="Recebimentos efetivos, líquidos de estornos." />
              <Kpi label="Saídas" value={<Money cents={tot.o} />} definition="Pagamentos efetivos, líquidos de estornos." />
              <Kpi label="Transferências e ajustes" value={<Money cents={tot.t + tot.j} signed />} definition={`Transferências ${formatBRL(tot.t)} (zero no consolidado) + ajustes ${formatBRL(tot.j)}. Fora de receita/despesa.`} />
              <Kpi label="Saldo final" tone={closing < 0 ? 'danger' : 'neutral'} value={<Money cents={closing} />} definition="Saldo inicial + entradas − saídas ± transferências ± ajustes." />
            </div>
            <FlowChartClient title="Fluxo de caixa realizado" description={`Granularidade: ${GRANULARITY_LABELS[gran].toLowerCase()}. As barras são entradas e saídas operacionais; a linha é o saldo ao fim do período.`}
              rows={rows.map((r) => ({ label: shortDate(r.period, gran), inflow: r.inflow_cents, outflow: r.outflow_cents, balance: r.closing_balance_cents }))} />
            <Section title="Tabela do período" description="Para detalhar a origem dos valores, abra as movimentações filtradas pelo período.">
              <TableShell caption="Fluxo de caixa realizado" empty={rows.length === 0}>
                <thead><tr className="border-b border-border"><th className={TH}>{gran === 'month' ? 'Mês' : gran === 'week' ? 'Semana (segunda)' : 'Dia'}</th><th className={TH}>Entradas</th><th className={TH}>Saídas</th><th className={TH}>Transferências</th><th className={TH}>Ajustes</th><th className={TH}>Variação</th><th className={TH}>Saldo final</th></tr></thead>
                <tbody>{rows.map((r) => (
                  <tr key={r.period} className="border-b border-border last:border-0">
                    <td className={TD}><Link className="underline underline-offset-2" href={`/movimentacoes?from=${r.period}&to=${gran === 'day' ? r.period : f.to}${f.account ? `&account=${f.account}` : ''}`}>{formatDateBR(r.period)}</Link></td>
                    <td className={TD}><Money cents={r.inflow_cents} /></td><td className={TD}><Money cents={r.outflow_cents} /></td><td className={TD}><Money cents={r.transfers_net_cents} signed /></td>
                    <td className={TD}><Money cents={r.adjustments_net_cents} signed /></td><td className={TD}><Money cents={r.net_cents} signed /></td><td className={TD}><Money cents={r.closing_balance_cents} /></td>
                  </tr>))}</tbody>
              </TableShell>
            </Section>
          </>
        )}
      </>
    );
  }

  // projetado
  const days = [30, 60, 90, 180, 365].includes(Number(one(sp.days))) ? Number(one(sp.days)) : Number.isInteger(Number(one(sp.days))) && Number(one(sp.days)) >= 1 && Number(one(sp.days)) <= 365 ? Number(one(sp.days)) : 30;
  const gran: Granularity = granParam && GRANULARITIES.includes(granParam) ? granParam : days > 120 ? 'month' : days > 45 ? 'week' : 'day';
  const account = uuidOrNull(one(sp.account));
  let base: Awaited<ReturnType<typeof loadProjection>> = [];
  let cons: typeof base = [];
  let opt: typeof base = [];
  let failed = false;
  try { [base, cons, opt] = await Promise.all([loadProjection(p.ctx, days, gran, 'base', account), loadProjection(p.ctx, days, gran, 'conservative', account), loadProjection(p.ctx, days, gran, 'optimistic', account)]); } catch { failed = true; }
  const first = base.find((r) => r.balance_cents < 0);
  const minBase = base.reduce((m, r) => Math.min(m, r.balance_cents), Number.MAX_SAFE_INTEGER);
  const qs = new URLSearchParams(Object.entries({ days: String(days), gran, account: account ?? '' }).filter(([, v]) => v) as Array<[string, string]>).toString();
  const s = p.settings;
  return (
    <>
      <PageHeader title="Fluxo de caixa" description="Projetado: hipóteses a partir do que está pendente. Não é previsão estatística nem valor garantido.">{exportBtn(qs, 'fluxo-projetado')}</PageHeader>
      <Tabs items={tabs} current={tab} />
      <ListFilters action="/fluxo-caixa" hidden={{ aba: 'projetado' }} values={{ days: String(days), gran, account }} fields={[
        { name: 'days', label: 'Janela', options: [30, 60, 90, 180, 365].map((d) => ({ value: String(d), label: `Próximos ${d} dias` })), all: 'Próximos 30 dias' },
        { name: 'gran', label: 'Visão', options: GRANULARITIES.map((g) => ({ value: g, label: GRANULARITY_LABELS[g] })), all: 'Automática', width: 'w-36' },
        { name: 'account', label: 'Conta', options: accountOpts(refs.accounts), all: 'Consolidado' },
      ]} />
      {failed ? <Alert tone="error">Não foi possível consultar a projeção agora. <Link className="underline" href="/fluxo-caixa?aba=projetado">Tentar novamente</Link>.</Alert> : (
        <>
          {first ? <div className="mb-4"><Alert tone="error">No cenário base o saldo fica negativo em <strong>{formatDateBR(first.period)}</strong> (mínimo {formatBRL(minBase)}). Antecipe recebimentos, renegocie vencimentos ou cubra o caixa.</Alert></div> : null}
          <div className="mb-6 grid gap-4 sm:grid-cols-3">
            {(['base', 'conservative', 'optimistic'] as const).map((sc) => {
              const rows = sc === 'base' ? base : sc === 'conservative' ? cons : opt;
              const end = rows.at(-1)?.balance_cents ?? 0;
              const def = sc === 'base' ? 'Valores previstos cadastrados: pendentes a receber e a pagar, vencidos em «hoje» e recorrências ainda não geradas.'
                : sc === 'conservative' ? `Recebimentos atrasam ${s.proj_cons_delay_days} dia(s) e são reduzidos em ${(s.proj_cons_cut_bps / 100).toLocaleString('pt-BR')}%. Pagamentos inalterados.`
                : `Recebimentos antecipam ${s.proj_opt_advance_days} dia(s) (nunca antes de hoje) e aumentam ${(s.proj_opt_gain_bps / 100).toLocaleString('pt-BR')}%. Pagamentos inalterados.`;
              return <Kpi key={sc} label={`Saldo em ${days} dias — ${SCENARIO_LABELS[sc]}`} tone={end < 0 ? 'danger' : 'neutral'} value={<Money cents={end} />} definition={def} />;
            })}
          </div>
          <ProjectionChartClient rows={base.map((r, i) => ({ label: shortDate(r.period, gran === 'month' ? 'month' : 'day'), base: r.balance_cents, conservative: cons[i]?.balance_cents ?? 0, optimistic: opt[i]?.balance_cents ?? 0 }))} />
          <Section title="Tabela da projeção (cenário base)" description="Cada linha: o que se espera receber e pagar no período e o saldo projetado ao fim dele.">
            <TableShell caption="Projeção do fluxo de caixa" empty={base.length === 0}>
              <thead><tr className="border-b border-border"><th className={TH}>Período</th><th className={TH}>Recebimentos previstos</th><th className={TH}>Pagamentos previstos</th><th className={TH}>Variação</th><th className={TH}>Saldo projetado</th></tr></thead>
              <tbody>{base.map((r) => (
                <tr key={r.period} className="border-b border-border last:border-0"><td className={TD}>{formatDateBR(r.period)}</td><td className={TD}><Money cents={r.inflow_cents} /></td><td className={TD}><Money cents={r.outflow_cents} /></td><td className={TD}><Money cents={r.net_cents} signed /></td><td className={TD}><Money cents={r.balance_cents} /></td></tr>))}</tbody>
            </TableShell>
          </Section>
        </>
      )}
    </>
  );
}
