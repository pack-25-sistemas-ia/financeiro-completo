import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui/primitives';
import { Disclosure, DateBR, Kpi, Money, Section, TD, TH, TableShell } from '@/components/finance/bits';
import { AccountCreateForm } from '@/components/finance/forms-accounts';
import { ACCOUNT_TYPE_LABELS, type AccountType } from '@/lib/finance/labels';
import { loadRefs, pageCtx } from '@/lib/finance/page';

export const metadata: Metadata = { title: 'Contas financeiras' };

export default async function ContasPage() {
  const p = await pageCtx();
  const refs = await loadRefs(p.ctx, { allAccounts: true });
  const active = refs.accounts.filter((a) => a.active);
  const archived = refs.accounts.filter((a) => !a.active);
  const consolidated = active.filter((a) => a.include_in_consolidated).reduce((s, a) => s + a.balance_cents, 0);
  const outside = active.filter((a) => !a.include_in_consolidated).reduce((s, a) => s + a.balance_cents, 0);
  return (
    <>
      <PageHeader title="Contas financeiras" description="Contas de disponibilidade (banco, caixa, poupança). O saldo é sempre calculado: saldo inicial + movimentos efetivos. Limite de crédito não é saldo." />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Kpi label="Saldo consolidado" tone={consolidated < 0 ? 'danger' : 'neutral'} value={<Money cents={consolidated} />} definition="Soma das contas ativas incluídas no consolidado. Transferências entre contas não alteram este total." />
        <Kpi label="Fora do consolidado" value={<Money cents={outside} />} definition="Contas ativas marcadas para ficar de fora da soma." />
        <Kpi label="Contas ativas" value={<span>{active.length}</span>} definition={`${archived.length} arquivada(s). Conta arquivada só é possível com saldo zero e sem títulos em aberto previstos.`} />
      </div>
      {active.length === 0 ? (
        <EmptyState title="Nenhuma conta cadastrada" description={p.perms.manager ? 'Cadastre ao menos uma conta com o saldo inicial para começar.' : 'Peça a um administrador ou gestor financeiro para cadastrar as contas.'} />
      ) : (
        <TableShell caption="Contas financeiras ativas">
          <thead><tr className="border-b border-border"><th className={TH}>Conta</th><th className={TH}>Tipo</th><th className={TH}>Instituição</th><th className={TH}>Saldo inicial</th><th className={TH}>Saldo atual</th><th className={TH}>Consolidado</th><th className={TH}><span className="sr-only">Ações</span></th></tr></thead>
          <tbody>
            {active.map((a) => (
              <tr key={a.account_id} className="border-b border-border last:border-0">
                <td className={TD}><Link className="font-medium underline-offset-2 hover:underline" href={`/contas/${a.account_id}`}>{a.name}</Link></td>
                <td className={TD}>{ACCOUNT_TYPE_LABELS[a.account_type as AccountType] ?? a.account_type}</td><td className={TD}>{a.institution_name ?? '—'}</td>
                <td className={TD}><Money cents={a.opening_balance_cents} /> <span className="text-xs text-muted">em <DateBR value={a.opening_balance_date} /></span></td>
                <td className={TD}><Money cents={a.balance_cents} className="font-medium" /></td>
                <td className={TD}>{a.include_in_consolidated ? <Badge tone="success">Sim</Badge> : <Badge>Não</Badge>}</td>
                <td className={TD}><Link className="underline underline-offset-2" href={`/contas/${a.account_id}`}>Extrato</Link></td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      )}
      {archived.length ? (
        <Section title="Arquivadas"><ul className="text-sm">{archived.map((a) => <li key={a.account_id}><Link className="underline" href={`/contas/${a.account_id}`}>{a.name}</Link></li>)}</ul></Section>
      ) : null}
      {p.perms.manager ? (
        <div className="mt-6"><Disclosure summary="Nova conta financeira" open tone="primary"><Card className="border-0 p-0 shadow-none"><AccountCreateForm today={p.today} /></Card></Disclosure></div>
      ) : null}
    </>
  );
}
