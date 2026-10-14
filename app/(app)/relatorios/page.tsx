import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Alert, Badge, Card, PageHeader } from '@/components/ui/primitives';
import { DateBR, Money, Pagination, TD, TH, TableShell } from '@/components/finance/bits';
import { FilterBar, ListFilters } from '@/components/finance/filter-bar';
import { formatDateBR } from '@/lib/finance/dates';
import { one, pageFrom, resolveFilters, type SearchParams } from '@/lib/finance/filters';
import { buildReport, REPORT_LIST, type Col, type Report } from '@/lib/finance/reports';
import { accountOpts, categoryOpts, counterpartyOpts, loadRefs, pageCtx } from '@/lib/finance/page';
import { GRANULARITIES, GRANULARITY_LABELS, type Granularity, type Scenario } from '@/lib/finance/labels';

export const metadata: Metadata = { title: 'Relatórios' };
const SHOW = 100;

function Cell({ col, value }: { col: Col; value: string | number | null }) {
  if (value === null || value === undefined || value === '') return <span className="text-muted">—</span>;
  switch (col.kind) {
    case 'money': return <Money cents={Number(value)} />;
    case 'date': return <DateBR value={String(value)} />;
    case 'pct': return <span className="tabular-nums">{(Number(value) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}%</span>;
    case 'int': return <span className="tabular-nums">{Number(value)}</span>;
    default: return <>{String(value)}</>;
  }
}

function ReportTable({ r, page }: { r: Report; page: number }) {
  const slice = r.rows.slice((page - 1) * SHOW, page * SHOW);
  return (
    <>
      <TableShell caption={r.title} empty={r.rows.length === 0} emptyText={r.note && r.cols.length === 0 ? r.note : 'Sem dados para os filtros escolhidos.'}>
        <thead><tr className="border-b border-border">{r.cols.map((c) => <th key={c.key} className={`${TH} ${c.kind === 'money' || c.kind === 'int' || c.kind === 'pct' ? 'text-right' : ''}`}>{c.label}</th>)}</tr></thead>
        <tbody>
          {slice.map((row, i) => <tr key={i} className="border-b border-border last:border-0">{r.cols.map((c) => <td key={c.key} className={`${TD} ${c.kind === 'money' || c.kind === 'int' || c.kind === 'pct' ? 'text-right' : ''}`}><Cell col={c} value={row[c.key] ?? null} /></td>)}</tr>)}
        </tbody>
        {r.totals ? <tfoot><tr className="border-t-2 border-border font-semibold">{r.cols.map((c, idx) => <td key={c.key} className={`${TD} ${c.kind === 'money' ? 'text-right' : ''}`}>{idx === 0 ? 'Total' : r.totals![c.key] !== undefined ? <Cell col={c} value={r.totals![c.key]!} /> : ''}</td>)}</tr></tfoot> : null}
      </TableShell>
      <Pagination base="/relatorios" sp={{}} page={page} total={r.rows.length} size={SHOW} />
    </>
  );
}

export default async function RelatoriosPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const p = await pageCtx();
  const name = one(sp.r);

  if (!name) {
    const groups = [...new Set(REPORT_LIST.map((r) => r.group))];
    return (
      <>
        <PageHeader title="Central de relatórios" description="Relatórios gerenciais calculados no banco de dados. Cada um indica o regime (caixa, competência ou previsto). Não são documentos contábeis ou fiscais oficiais." />
        <div className="space-y-8">
          {groups.map((g) => (
            <section key={g}>
              <h2 className="mb-3 text-lg font-semibold">{g}</h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {REPORT_LIST.filter((r) => r.group === g).map((r) => (
                  <Card key={r.name} title={r.title} description={r.description}>
                    <Link className="inline-flex min-h-9 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground" href={`/relatorios?r=${r.name}`}>Abrir relatório</Link>
                  </Card>
                ))}
              </div>
            </section>
          ))}
        </div>
      </>
    );
  }

  if (!REPORT_LIST.some((r) => r.name === name)) notFound();
  const refs = await loadRefs(p.ctx);
  const f = resolveFilters(sp, p.tz);
  const gran = one(sp.gran) as Granularity | undefined;
  const regime = one(sp.regime) === 'accrual' ? 'accrual' : 'cash';
  const days = Number(one(sp.days));
  const page = pageFrom(one(sp.page));
  const o = { gran: gran && GRANULARITIES.includes(gran) ? gran : undefined, regime: regime as 'cash' | 'accrual', days: Number.isInteger(days) && days > 0 ? days : undefined, status: one(sp.status) ?? null, venc: one(sp.venc) ?? null, scenario: undefined as Scenario | undefined };
  let report: Report | null = null;
  let failed = false;
  try { report = await buildReport(p.ctx, p.tz, name, f, { ...o, maxRows: 2000 }); } catch { failed = true; }
  const meta = REPORT_LIST.find((r) => r.name === name)!;
  const qs = new URLSearchParams(Object.entries({ period: f.period, from: f.from, to: f.to, account: f.account ?? '', category: f.category ?? '', party: f.counterparty ?? '', gran: o.gran ?? '', regime: name.includes('categoria') ? regime : '', days: o.days ? String(o.days) : '', status: o.status ?? '', venc: o.venc ?? '' }).filter(([, v]) => v) as Array<[string, string]>).toString();
  const needsPeriod = !['vencimentos', 'fluxo-projetado'].includes(name);
  return (
    <>
      <PageHeader title={meta.title} description={meta.description}>
        <div className="flex flex-wrap gap-2">
          <Link className="text-sm underline underline-offset-2" href="/relatorios">← Central de relatórios</Link>
          {p.perms.manager ? <a className="inline-flex min-h-9 items-center rounded-md border border-border px-3 text-sm hover:bg-black/5 dark:hover:bg-white/5" href={`/api/export/${name}?${qs}`}>Exportar CSV</a> : null}
        </div>
      </PageHeader>
      {needsPeriod ? <FilterBar action="/relatorios" extra={{ r: name, ...(o.gran ? { gran: o.gran } : {}), ...(name.includes('categoria') ? { regime } : {}) }} filters={f} accounts={accountOpts(refs.accounts)}
        categories={['contas-pagar', 'contas-receber', 'vencimentos'].includes(name) ? categoryOpts(refs.categories) : undefined} counterparties={['contas-pagar', 'contas-receber'].includes(name) ? counterpartyOpts(refs.counterparties) : undefined} />
        : <ListFilters action="/relatorios" hidden={{ r: name }} values={{ days: o.days ? String(o.days) : '30', account: f.account }} fields={[{ name: 'days', label: 'Janela (dias)', type: 'text', width: 'w-28' }, { name: 'account', label: 'Conta', options: accountOpts(refs.accounts), all: 'Consolidado' }]} />}
      {name.includes('categoria') ? (
        <p className="mb-4 flex flex-wrap items-center gap-2 text-sm">Critério:
          <Link className={`rounded-md border px-3 py-1 ${regime === 'cash' ? 'border-primary font-medium' : 'border-border'}`} href={`/relatorios?${new URLSearchParams({ ...Object.fromEntries(new URLSearchParams(qs)), r: name, regime: 'cash' })}`}>Caixa (pago/recebido)</Link>
          <Link className={`rounded-md border px-3 py-1 ${regime === 'accrual' ? 'border-primary font-medium' : 'border-border'}`} href={`/relatorios?${new URLSearchParams({ ...Object.fromEntries(new URLSearchParams(qs)), r: name, regime: 'accrual' })}`}>Competência (fato gerador)</Link>
        </p>
      ) : null}
      {['fluxo-realizado'].includes(name) ? (
        <p className="mb-4 flex flex-wrap items-center gap-2 text-sm">Visão: {GRANULARITIES.map((g) => <Link key={g} className={`rounded-md border px-3 py-1 ${(o.gran ?? 'auto') === g ? 'border-primary font-medium' : 'border-border'}`} href={`/relatorios?${new URLSearchParams({ ...Object.fromEntries(new URLSearchParams(qs)), r: name, gran: g })}`}>{GRANULARITY_LABELS[g]}</Link>)}</p>
      ) : null}
      {failed || !report ? <Alert tone="error">Não foi possível gerar o relatório agora. <Link className="underline" href={`/relatorios?r=${name}`}>Tentar novamente</Link>.</Alert> : (
        <>
          <p className="mb-2 flex flex-wrap items-center gap-2 text-sm text-muted"><Badge>{report.regime}</Badge> {needsPeriod ? `Período: ${formatDateBR(f.from)} a ${formatDateBR(f.to)}.` : null}</p>
          {report.note ? <div className="mb-3"><Alert tone="info">{report.note}</Alert></div> : null}
          {report.truncated ? <div className="mb-3"><Alert tone="warning">Resultado limitado às primeiras linhas. Refine os filtros ou exporte o CSV (até 5.000 linhas).</Alert></div> : null}
          <ReportTable r={report} page={page} />
        </>
      )}
      <p className="mt-6 text-xs text-muted">Demonstrativo gerencial. Não substitui escrituração, DRE, balanço ou obrigações fiscais — consulte um contador para documentos oficiais.</p>
    </>
  );
}
