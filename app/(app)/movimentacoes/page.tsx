import type { Metadata } from 'next';
import { Badge, PageHeader } from '@/components/ui/primitives';
import { Disclosure, DateBR, Money, Pagination, Section, TD, TH, TableShell } from '@/components/finance/bits';
import { ListFilters } from '@/components/finance/filter-bar';
import { AdjustmentForm, ReverseTransferForm, TransferForm } from '@/components/finance/forms-accounts';
import { MovementsTable } from '@/components/finance/tables';
import { listMovements, loadTransfers } from '@/lib/finance/data';
import { one, pageFrom, uuidOrNull, type SearchParams } from '@/lib/finance/filters';
import { MOVEMENT_LABELS } from '@/lib/finance/labels';
import { accountOpts, loadRefs, pageCtx } from '@/lib/finance/page';

export const metadata: Metadata = { title: 'Movimentações' };

export default async function MovimentacoesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const p = await pageCtx();
  const refs = await loadRefs(p.ctx, { allAccounts: true });
  const page = pageFrom(one(sp.page));
  const iso = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
  const account = uuidOrNull(one(sp.account));
  const [mv, transfers] = await Promise.all([
    listMovements(p.ctx, p.tz, { account, from: iso(one(sp.from)), to: iso(one(sp.to)), type: one(sp.type), q: one(sp.q), recon: one(sp.recon), page }),
    loadTransfers(p.ctx, 30),
  ]);
  const name = (id: string) => refs.accounts.find((a) => a.account_id === id)?.name ?? '—';
  const opts = accountOpts(refs.accounts);
  const exportQs = new URLSearchParams(Object.entries({ account: account ?? '', from: iso(one(sp.from)) ?? '', to: iso(one(sp.to)) ?? '', period: iso(one(sp.from)) && iso(one(sp.to)) ? 'custom' : 'year' }).filter(([, v]) => v) as Array<[string, string]>).toString();
  return (
    <>
      <PageHeader title="Movimentações" description="Livro de movimentos efetivos de todas as contas. Transferências entre contas não são receita nem despesa; correções são feitas por estorno.">
        {p.perms.manager ? <a className="inline-flex min-h-10 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/5" href={`/api/export/movimentacoes?${exportQs}`}>Exportar CSV</a> : null}
      </PageHeader>
      <ListFilters action="/movimentacoes" values={{ q: one(sp.q), account, type: one(sp.type), recon: one(sp.recon), from: iso(one(sp.from)), to: iso(one(sp.to)) }} fields={[
        { name: 'q', label: 'Buscar', width: 'w-52' },
        { name: 'account', label: 'Conta', all: 'Todas', options: refs.accounts.map((a) => ({ value: a.account_id, label: a.name })) },
        { name: 'type', label: 'Tipo', all: 'Todos', options: Object.entries(MOVEMENT_LABELS).map(([value, label]) => ({ value, label })) },
        { name: 'recon', label: 'Conciliação', all: 'Todas', options: [{ value: 'sim', label: 'Conciliados' }, { value: 'nao', label: 'Pendentes' }], width: 'w-40' },
        { name: 'from', label: 'De', type: 'date', width: 'w-40' }, { name: 'to', label: 'Até', type: 'date', width: 'w-40' },
      ]} />
      <MovementsTable rows={mv.rows} />
      <Pagination base="/movimentacoes" sp={sp} page={page} total={mv.total} />

      {p.perms.manager ? (
        <Section title="Transferir entre contas" description="Gera uma saída e uma entrada ligadas no mesmo evento; o saldo consolidado não muda.">
          <TransferForm accounts={opts} today={p.today} />
        </Section>
      ) : null}
      <Section title="Transferências recentes">
        <TableShell caption="Transferências recentes" empty={transfers.length === 0} emptyText="Nenhuma transferência registrada.">
          <thead><tr className="border-b border-border"><th className={TH}>Data</th><th className={TH}>Origem</th><th className={TH}>Destino</th><th className={TH}>Valor</th><th className={TH}>Descrição</th><th className={TH}>Situação</th></tr></thead>
          <tbody>
            {transfers.map((t) => (
              <tr key={t.id} className="border-b border-border align-top last:border-0">
                <td className={TD}><DateBR value={t.transferred_at} /></td><td className={TD}>{name(t.source_account_id)}</td><td className={TD}>{name(t.destination_account_id)}</td>
                <td className={TD}><Money cents={t.amount_cents} /></td><td className={TD}>{t.description ?? '—'}</td>
                <td className={TD}>
                  {t.status === 'reversed' ? <><Badge tone="warning">Estornada</Badge><span className="block text-xs text-muted">{t.reversal_reason}</span></>
                    : p.perms.manager ? <Disclosure summary="Estornar"><ReverseTransferForm id={t.id} /></Disclosure> : <Badge tone="success">Efetivada</Badge>}
                </td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      </Section>
      {p.perms.manager ? (
        <Section title="Ajuste de saldo (tarifa, juros, correção)" description="Fica fora de receita e despesa operacionais e exige motivo. Prefira lançar uma conta a pagar para custos do negócio.">
          <Disclosure summary="Registrar ajuste"><AdjustmentForm accounts={opts} today={p.today} /></Disclosure>
        </Section>
      ) : null}
    </>
  );
}
