import { Badge, Card, PageHeader } from '@/components/ui/primitives';
import { Disclosure, Pagination, Section } from '@/components/finance/bits';
import { ListFilters } from '@/components/finance/filter-bar';
import { ArchiveCounterpartyButton, CounterpartyEditForm, CounterpartyForm } from '@/components/finance/forms-catalogs';
import { loadCounterparties } from '@/lib/finance/data';
import { one, pageFrom, type SearchParams } from '@/lib/finance/filters';
import { COUNTERPARTY_LABELS } from '@/lib/finance/labels';
import { pageCtx } from '@/lib/finance/page';

/** Clientes e fornecedores: mesmo cadastro, filtrado por tipo. CPF/CNPJ é dado pessoal (LGPD): aparece mascarado na lista. */
export async function CounterpartiesPage({ kind, sp }: { kind: 'customer' | 'supplier'; sp: SearchParams }) {
  const p = await pageCtx();
  const page = pageFrom(one(sp.page));
  const showArchived = one(sp.arquivados) === '1';
  const { rows, total } = await loadCounterparties(p.ctx, { kind, q: one(sp.q), includeArchived: showArchived, limit: 25, page });
  const label = kind === 'customer' ? 'Clientes' : 'Fornecedores';
  const mask = (d: string | null) => (d ? (d.length === 11 ? `•••.•••.${d.slice(6, 9)}-${d.slice(9)}` : `••.•••.•••/${d.slice(8, 12)}-${d.slice(12)}`) : '—');
  return (
    <>
      <PageHeader title={label} description={`Cadastro de ${label.toLowerCase()}. Arquivar preserva todo o histórico de títulos e baixas; o cadastro apenas deixa de ser oferecido em novos lançamentos.`} />
      <ListFilters action={kind === 'customer' ? '/clientes' : '/fornecedores'} values={{ q: one(sp.q), arquivados: showArchived ? '1' : '' }} fields={[
        { name: 'q', label: 'Buscar por nome, documento ou e-mail', width: 'w-72' },
        { name: 'arquivados', label: 'Arquivados', all: 'Ocultar', options: [{ value: '1', label: 'Mostrar' }], width: 'w-32' },
      ]} />
      {rows.length === 0 ? <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted">Nenhum cadastro encontrado.</p> : (
        <ul className="space-y-3">
          {rows.map((c) => (
            <li key={c.id} className="rounded-lg border border-border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{c.name} {c.archived_at ? <Badge>Arquivado</Badge> : null} <Badge tone="neutral">{COUNTERPARTY_LABELS[c.kind]}</Badge></p>
                  <p className="text-sm text-muted">{c.legal_name ? `${c.legal_name} · ` : ''}{mask(c.document_number)}{c.email ? ` · ${c.email}` : ''}{c.phone ? ` · ${c.phone}` : ''}</p>
                </div>
                {p.perms.analyst ? <ArchiveCounterpartyButton id={c.id} archived={Boolean(c.archived_at)} /> : null}
              </div>
              {p.perms.analyst ? <div className="mt-3"><Disclosure summary="Editar cadastro"><CounterpartyEditForm c={c} /></Disclosure></div> : null}
            </li>
          ))}
        </ul>
      )}
      <Pagination base={kind === 'customer' ? '/clientes' : '/fornecedores'} sp={sp} page={page} total={total} size={25} />
      {p.perms.analyst ? <Section title={`Novo ${kind === 'customer' ? 'cliente' : 'fornecedor'}`}><Card><CounterpartyForm defaultKind={kind} /></Card></Section> : null}
    </>
  );
}
