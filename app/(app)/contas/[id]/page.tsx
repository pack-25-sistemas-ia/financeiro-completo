import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Alert, Badge, PageHeader } from '@/components/ui/primitives';
import { DateBR, Disclosure, Kpi, Money, Pagination, Section, TD, TH, TableShell } from '@/components/finance/bits';
import { ListFilters } from '@/components/finance/filter-bar';
import { AccountEditForm, ArchiveAccountButton, OpeningForm } from '@/components/finance/forms-accounts';
import { MovementsTable } from '@/components/finance/tables';
import { loadAccountHistory, listMovements } from '@/lib/finance/data';
import { formatDateBR } from '@/lib/finance/dates';
import { one, pageFrom, uuidOrNull, type SearchParams } from '@/lib/finance/filters';
import { ACCOUNT_TYPE_LABELS, MOVEMENT_LABELS, type AccountType } from '@/lib/finance/labels';
import { loadRefs, pageCtx } from '@/lib/finance/page';

export const metadata: Metadata = { title: 'Conta financeira' };

export default async function ContaPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const { id } = await params;
  if (!uuidOrNull(id)) notFound();
  const sp = await searchParams;
  const p = await pageCtx();
  const refs = await loadRefs(p.ctx, { allAccounts: true });
  const acc = refs.accounts.find((a) => a.account_id === id);
  if (!acc) notFound();
  const page = pageFrom(one(sp.page));
  const from = one(sp.from)?.match(/^\d{4}-\d{2}-\d{2}$/) ? one(sp.from) : undefined;
  const to = one(sp.to)?.match(/^\d{4}-\d{2}-\d{2}$/) ? one(sp.to) : undefined;
  const type = one(sp.type);
  const [mv, history] = await Promise.all([listMovements(p.ctx, p.tz, { account: id, from, to, type, q: one(sp.q), page }), loadAccountHistory(p.ctx, id)]);
  const exportQs = new URLSearchParams(Object.entries({ account: id, from: from ?? '', to: to ?? '', period: from && to ? 'custom' : 'year' }).filter(([, v]) => v) as Array<[string, string]>).toString();
  return (
    <>
      <PageHeader title={acc.name} description={`${ACCOUNT_TYPE_LABELS[acc.account_type as AccountType] ?? acc.account_type}${acc.institution_name ? ` · ${acc.institution_name}` : ''}`}>
        <div className="flex flex-wrap gap-2">
          <Link className="text-sm underline underline-offset-2" href="/contas">← Contas</Link>
          {p.perms.manager ? <a className="inline-flex min-h-9 items-center rounded-md border border-border px-3 text-sm hover:bg-black/5 dark:hover:bg-white/5" href={`/api/export/extrato?${exportQs}`}>Exportar extrato (CSV)</a> : null}
        </div>
      </PageHeader>
      {!acc.active ? <div className="mb-4"><Alert tone="info">Conta arquivada: não recebe novos movimentos. {p.perms.manager ? 'Você pode reativá-la abaixo.' : ''}</Alert></div> : null}
      {acc.balance_cents < 0 ? <div className="mb-4"><Alert tone="error">Saldo negativo nesta conta.</Alert></div> : null}
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Kpi label="Saldo atual" tone={acc.balance_cents < 0 ? 'danger' : 'neutral'} value={<Money cents={acc.balance_cents} />} definition="Saldo inicial + entradas efetivas − saídas efetivas. Não é saldo conciliado com o banco: confira em Conciliação." />
        <Kpi label="Saldo inicial" value={<Money cents={acc.opening_balance_cents} />} definition={`Em ${acc.opening_balance_date ? formatDateBR(acc.opening_balance_date) : '—'}. Movimentos anteriores a esta data não contam.`} />
        <Kpi label="Movimentos no livro" value={<span>{mv.total}</span>} definition="Registros efetivos desta conta (com os filtros abaixo)." />
      </div>
      <Section title="Extrato" description="Livro imutável: correção é feita por estorno ou ajuste, nunca por edição.">
        <ListFilters action={`/contas/${id}`} values={{ q: one(sp.q), type, from, to }} fields={[
          { name: 'q', label: 'Buscar', width: 'w-56' },
          { name: 'type', label: 'Tipo', all: 'Todos', options: Object.entries(MOVEMENT_LABELS).map(([value, label]) => ({ value, label })) },
          { name: 'from', label: 'De', type: 'date', width: 'w-40' }, { name: 'to', label: 'Até', type: 'date', width: 'w-40' },
        ]} />
        <MovementsTable rows={mv.rows} />
        <Pagination base={`/contas/${id}`} sp={sp} page={page} total={mv.total} />
      </Section>

      {p.perms.manager ? (
        <Section title="Gerenciar conta">
          <div className="space-y-3">
            <Disclosure summary="Editar nome, instituição e opções"><AccountEditForm id={id} name={acc.name} institution={acc.institution_name ?? null} include={acc.include_in_consolidated} allowNegative={acc.allow_negative ?? true} /></Disclosure>
            <ArchiveAccountButton id={id} archived={!acc.active} />
          </div>
        </Section>
      ) : null}
      {p.perms.admin ? (
        <Section title="Saldo inicial — correção auditada" description="Só administradores corrigem o saldo inicial, sempre com motivo; o histórico abaixo nunca é apagado.">
          <Disclosure summary="Corrigir saldo inicial" tone="danger"><OpeningForm id={id} cents={acc.opening_balance_cents} date={acc.opening_balance_date ?? p.today} today={p.today} /></Disclosure>
        </Section>
      ) : null}
      <Section title="Histórico do saldo inicial">
        <TableShell caption="Histórico do saldo inicial" empty={history.length === 0}>
          <thead><tr className="border-b border-border"><th className={TH}>Quando</th><th className={TH}>Antes</th><th className={TH}>Depois</th><th className={TH}>Motivo</th></tr></thead>
          <tbody>
            {history.map((h) => (
              <tr key={h.id} className="border-b border-border last:border-0">
                <td className={TD}><DateBR value={h.changed_at} /></td>
                <td className={TD}>{h.old_cents === null ? <Badge>Criação</Badge> : <><Money cents={h.old_cents} /> <span className="text-xs text-muted">({h.old_date ? formatDateBR(h.old_date) : '—'})</span></>}</td>
                <td className={TD}><Money cents={h.new_cents} /> <span className="text-xs text-muted">({formatDateBR(h.new_date)})</span></td><td className={TD}>{h.reason}</td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      </Section>
    </>
  );
}
