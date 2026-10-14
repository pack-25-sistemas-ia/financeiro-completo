import type { Metadata } from 'next';
import { Alert, Badge, Card, PageHeader } from '@/components/ui/primitives';
import { Money, Section, TD, TH, TableShell } from '@/components/finance/bits';
import { FilterBar } from '@/components/finance/filter-bar';
import { CostCenterForm, CostCenterRowForm } from '@/components/finance/forms-catalogs';
import { loadCostCenters, rpc } from '@/lib/finance/data';
import { formatDateBR } from '@/lib/finance/dates';
import { resolveFilters, type SearchParams } from '@/lib/finance/filters';
import { pageCtx } from '@/lib/finance/page';

export const metadata: Metadata = { title: 'Centros de custo' };
type Row = { cost_center_id: string | null; code: string | null; name: string; income_cents: number; expense_cents: number; net_cents: number };

export default async function CentrosPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const p = await pageCtx();
  const f = resolveFilters(sp, p.tz);
  const [centers, result] = await Promise.all([
    loadCostCenters(p.ctx),
    rpc<Row[]>(p.ctx, 'fin_report_cost_centers', { p_org: p.org, p_from: f.from, p_to: f.to }).catch(() => null),
  ]);
  return (
    <>
      <PageHeader title="Centros de custo" description="Classifica resultados gerenciais por área. Um título pode ser rateado entre vários centros; a soma dos rateios é sempre exatamente o valor do título." />
      <FilterBar action="/centros-custo" filters={f} />
      <Section title={`Resultado por centro — ${formatDateBR(f.from)} a ${formatDateBR(f.to)}`} description="Regime de caixa: baixas efetivas ponderadas pelo rateio. «Sem centro de custo» reúne o que não foi ratado.">
        {result === null ? <Alert tone="error">Não foi possível consultar o resultado agora.</Alert> : (
          <TableShell caption="Resultado por centro de custo" empty={result.length === 0} emptyText="Sem movimento realizado no período.">
            <thead><tr className="border-b border-border"><th className={TH}>Centro</th><th className={TH}>Receitas</th><th className={TH}>Despesas</th><th className={TH}>Resultado</th></tr></thead>
            <tbody>{result.map((r) => (
              <tr key={r.cost_center_id ?? 'sem'} className="border-b border-border last:border-0"><td className={TD}>{r.code ? `${r.code} · ` : ''}{r.name}</td><td className={TD}><Money cents={r.income_cents} /></td><td className={TD}><Money cents={r.expense_cents} /></td><td className={TD}><Money cents={r.net_cents} signed /></td></tr>
            ))}</tbody>
          </TableShell>
        )}
      </Section>
      <Section title="Cadastro">
        {centers.length === 0 ? <p className="text-sm text-muted">Nenhum centro de custo cadastrado.</p> : (
          <ul className="space-y-2">
            {centers.map((c) => (
              <li key={c.id} className="rounded-lg border border-border bg-card p-3">
                {p.perms.manager ? <CostCenterRowForm id={c.id} name={c.name} code={c.code} description={c.description} active={c.active} />
                  : <p className="text-sm">{c.code} · {c.name} {c.active ? null : <Badge>Inativo</Badge>}{c.description ? <span className="block text-muted">{c.description}</span> : null}</p>}
              </li>
            ))}
          </ul>
        )}
      </Section>
      {p.perms.manager ? <Section title="Novo centro de custo"><Card><CostCenterForm /></Card></Section> : null}
    </>
  );
}
