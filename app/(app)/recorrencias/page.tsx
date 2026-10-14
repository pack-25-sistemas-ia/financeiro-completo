import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge, Card, PageHeader } from '@/components/ui/primitives';
import { DateBR, Disclosure, Money, Section, TD, TH, TableShell } from '@/components/finance/bits';
import { GenerateButton, RuleEditForm, RuleForm, RuleOps } from '@/components/finance/forms-recurring';
import { loadOccurrences, loadRules } from '@/lib/finance/data';
import { formatDateBR } from '@/lib/finance/dates';
import { ENTRY_TYPE_LABELS, FREQUENCY_NAMES } from '@/lib/finance/labels';
import { accountOpts, categoryOpts, counterpartyOpts, loadRefs, pageCtx } from '@/lib/finance/page';

export const metadata: Metadata = { title: 'Recorrências' };

export default async function RecorrenciasPage() {
  const p = await pageCtx();
  const refs = await loadRefs(p.ctx);
  // Gera o que estiver vencido para gerar (idempotente; sem agendador externo).
  if (p.perms.analyst) await p.ctx.supabase.rpc('fin_run_routines', { p_org: p.org }).then(() => null, () => null);
  const rules = await loadRules(p.ctx);
  const occ = new Map(await Promise.all(rules.filter((r) => r.active || r.ended_at).slice(0, 30).map(async (r) => [r.id, await loadOccurrences(p.ctx, r.id, 6)] as const)));
  const opts = { counterparties: counterpartyOpts(refs.counterparties), categories: categoryOpts(refs.categories), accounts: accountOpts(refs.accounts) };
  return (
    <>
      <PageHeader title="Recorrências" description="Compromissos que se repetem (aluguel, assinaturas, mensalidades). A regra gera TÍTULOS PREVISTOS; nunca marca nada como pago nem movimenta conta.">
        {p.perms.analyst ? <GenerateButton /> : null}
      </PageHeader>
      <TableShell caption="Regras de recorrência" empty={rules.length === 0} emptyText="Nenhuma regra cadastrada.">
        <thead><tr className="border-b border-border"><th className={TH}>Descrição</th><th className={TH}>Tipo</th><th className={TH}>Valor</th><th className={TH}>Periodicidade</th><th className={TH}>Início</th><th className={TH}>Término</th><th className={TH}>Situação</th><th className={TH}><span className="sr-only">Ações</span></th></tr></thead>
        <tbody>
          {rules.map((r) => (
            <tr key={r.id} className="border-b border-border align-top last:border-0">
              <td className={TD}>{r.description}<span className="block text-xs text-muted">{r.next_index} ocorrência(s) processada(s) · gera {r.lead_days} dia(s) antes</span></td>
              <td className={TD}>{ENTRY_TYPE_LABELS[r.entry_type]}</td><td className={TD}><Money cents={r.amount_cents} /></td>
              <td className={TD}>{r.interval_count > 1 ? `A cada ${r.interval_count} · ` : ''}{FREQUENCY_NAMES[r.frequency as keyof typeof FREQUENCY_NAMES] ?? r.frequency}</td>
              <td className={TD}><DateBR value={r.starts_on} /></td><td className={TD}>{r.ends_on ? <DateBR value={r.ends_on} /> : '—'}</td>
              <td className={TD}>{r.ended_at ? <Badge>Encerrada</Badge> : r.active ? <Badge tone="success">Ativa</Badge> : <Badge tone="warning">Pausada</Badge>}</td>
              <td className={TD}>{p.perms.analyst ? <RuleOps id={r.id} active={r.active} ended={Boolean(r.ended_at)} /> : null}</td>
            </tr>
          ))}
        </tbody>
      </TableShell>

      {rules.length ? (
        <Section title="Ocorrências recentes" description="O que cada regra já gerou ou pulou (após pausa). Títulos gerados aparecem em Contas a pagar/receber.">
          <div className="grid gap-4 lg:grid-cols-2">
            {rules.filter((r) => (occ.get(r.id) ?? []).length > 0).map((r) => (
              <Card key={r.id} title={r.description}>
                <ul className="space-y-1 text-sm">
                  {(occ.get(r.id) ?? []).map((o) => (
                    <li key={o.id} className="flex items-center justify-between gap-2"><span>{formatDateBR(o.scheduled_date)}</span>
                      {o.status === 'generated' && o.generated_entry_id ? <Link className="underline underline-offset-2" href={`/${r.entry_type === 'payable' ? 'pagar' : 'receber'}/${o.generated_entry_id}`}>Título gerado</Link> : <Badge tone="warning">Pulada (regra pausada)</Badge>}
                    </li>
                  ))}
                </ul>
                {p.perms.analyst && !r.ended_at ? <div className="mt-3"><Disclosure summary="Editar regra (vale para as próximas ocorrências)"><RuleEditForm refs={opts} rule={r} /></Disclosure></div> : null}
              </Card>
            ))}
          </div>
        </Section>
      ) : null}

      {p.perms.analyst ? (
        <Section title="Nova regra"><Card><RuleForm refs={opts} today={p.today} /></Card></Section>
      ) : null}
    </>
  );
}
