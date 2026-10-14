import type { Metadata } from 'next';
import Link from 'next/link';
import { Alert, Badge, EmptyState, PageHeader } from '@/components/ui/primitives';
import { DateBR, Disclosure, Kpi, Money, Pagination, Section } from '@/components/finance/bits';
import { ListFilters } from '@/components/finance/filter-bar';
import { ReasonInline, ReconcileForm, UnignoreForm, type Candidate } from '@/components/finance/forms-recon';
import { undoReconciliation } from '@/lib/finance/actions/recon';
import { loadStatementLines, loadUnreconciledMovements, rpc } from '@/lib/finance/data';
import { addDays } from '@/lib/finance/dates';
import { ignoreLine } from '@/lib/finance/actions/recon';
import { one, pageFrom, uuidOrNull, type SearchParams } from '@/lib/finance/filters';
import { RECON_LABELS, RECON_TONES, type Tone } from '@/lib/finance/labels';
import { accountOpts, loadRefs, pageCtx } from '@/lib/finance/page';

export const metadata: Metadata = { title: 'Conciliação' };

type Summary = { system_balance_cents: number; movements_net_cents: number; statement_total_cents: number; difference_cents: number; lines_pending: number; lines_pending_cents: number; lines_reconciled: number; lines_divergent: number; divergence_cents: number; lines_ignored: number; movements_unreconciled: number; movements_unreconciled_cents: number };
type Suggestion = { line_id: string; movement_id: string; score: number; date_diff: number; amount_equal: boolean; ambiguous: boolean; reasons: string[] };

export default async function ConciliacaoPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const p = await pageCtx();
  const refs = await loadRefs(p.ctx);
  const accountId = uuidOrNull(one(sp.account)) ?? refs.accounts[0]?.account_id ?? null;
  const iso = (v: string | undefined, d: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : d);
  const from = iso(one(sp.from), addDays(p.today, -60));
  const to = iso(one(sp.to), p.today);
  const status = one(sp.status) ?? 'pending';
  const page = pageFrom(one(sp.page));
  const head = (
    <>
      <PageHeader title="Conciliação manual" description="Compara o extrato importado com os movimentos registrados. Nenhuma correspondência é confirmada sozinha: você decide, e diferenças exigem justificativa.">
        {p.perms.analyst ? <Link className="inline-flex min-h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground" href="/importacoes">Importar extrato</Link> : null}
      </PageHeader>
    </>
  );
  if (!accountId) return <>{head}<EmptyState title="Nenhuma conta cadastrada" description="Cadastre uma conta e importe um extrato para conciliar." /></>;

  const [summary, lines, moves, suggestions] = await Promise.all([
    rpc<Summary>(p.ctx, 'fin_reconciliation_summary', { p_org: p.org, p_account: accountId, p_from: from, p_to: to }),
    loadStatementLines(p.ctx, accountId, { status, from, to, page }, 30),
    loadUnreconciledMovements(p.ctx, accountId, addDays(from, -7), addDays(to, 7), p.tz),
    rpc<Suggestion[]>(p.ctx, 'fin_suggest_matches', { p_org: p.org, p_account: accountId, p_tolerance_days: 3 }),
  ]);
  const moveById = new Map(moves.map((m) => [m.movement_id, m]));
  const sugByLine = new Map<string, Suggestion[]>();
  for (const s of suggestions) (sugByLine.get(s.line_id) ?? sugByLine.set(s.line_id, []).get(s.line_id)!).push(s);

  const { data: matches } = await p.ctx.supabase.from('reconciliation_matches').select('id, statement_line_id, movement_id, difference_cents, note, matched_at')
    .eq('organization_id', p.org).eq('account_id', accountId).eq('status', 'active').in('statement_line_id', lines.rows.map((l) => l.id).concat(['00000000-0000-0000-0000-000000000000']));
  const matchByLine = new Map((matches ?? []).map((m) => [m.statement_line_id as string, m as { id: string; movement_id: string; difference_cents: number; note: string | null }]));

  return (
    <>
      {head}
      <ListFilters action="/conciliacao" values={{ account: accountId, status, from, to }} fields={[
        { name: 'account', label: 'Conta', options: accountOpts(refs.accounts), all: 'Selecione', width: 'w-52' },
        { name: 'status', label: 'Situação da linha', options: Object.entries(RECON_LABELS).map(([value, label]) => ({ value, label })), all: 'Todas' },
        { name: 'from', label: 'De', type: 'date', width: 'w-40' }, { name: 'to', label: 'Até', type: 'date', width: 'w-40' },
      ]} />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Saldo do sistema (fim do período)" value={<Money cents={summary.system_balance_cents} />} definition="Saldo inicial + movimentos até a data final. Não presume que o banco esteja igual: confira pelo extrato." />
        <Kpi label="Movimentos no período (sistema)" value={<Money cents={summary.movements_net_cents} signed />} definition="Soma líquida dos movimentos efetivos da conta no período." />
        <Kpi label="Total do extrato no período" value={<Money cents={summary.statement_total_cents} signed />} definition="Soma líquida das linhas de extrato importadas no período." />
        <Kpi label="Diferença (sistema − extrato)" tone={summary.difference_cents === 0 ? 'success' : 'warning'} value={<Money cents={summary.difference_cents} signed />} definition={summary.difference_cents === 0 ? 'Sistema e extrato somam o mesmo valor no período.' : 'Há movimentos sem linha de extrato (ou o contrário) ou valores divergentes.'} />
      </div>
      <div className="mb-6 flex flex-wrap gap-2 text-sm">
        <Badge tone="warning">Pendentes: {summary.lines_pending} (<Money cents={summary.lines_pending_cents} />)</Badge>
        <Badge tone="success">Conciliadas: {summary.lines_reconciled}</Badge>
        <Badge tone="danger">Divergentes: {summary.lines_divergent} (<Money cents={summary.divergence_cents} signed />)</Badge>
        <Badge>Ignoradas: {summary.lines_ignored}</Badge>
        <Badge tone={summary.movements_unreconciled ? 'warning' : 'success'}>Movimentos sem extrato: {summary.movements_unreconciled} (<Money cents={summary.movements_unreconciled_cents} signed />)</Badge>
      </div>

      <Section title="Linhas do extrato" description="Para cada linha, escolha o movimento correspondente. Sugestões marcadas como ambíguas têm mais de um candidato semelhante: confira antes de confirmar.">
        {lines.rows.length === 0 ? <EmptyState title="Nenhuma linha neste filtro" description="Importe um extrato da conta em Importações → Extrato bancário, ou ajuste o período e a situação." /> : (
          <ul className="space-y-3">
            {lines.rows.map((l) => {
              const m = matchByLine.get(l.id);
              const cands: Candidate[] = (sugByLine.get(l.id) ?? []).flatMap((s2): Candidate[] => {
                const mv = moveById.get(s2.movement_id);
                return mv ? [{ movementId: mv.movement_id, label: mv.entry_description ?? mv.description ?? 'Movimento', cents: mv.amount_cents, date: mv.effective_at.slice(0, 10), score: s2.score, ambiguous: s2.ambiguous, reasons: s2.reasons }] : [];
              });
              const others: Candidate[] = moves.filter((mv) => Math.sign(mv.amount_cents) === Math.sign(l.amount_cents) && !cands.some((c) => c.movementId === mv.movement_id)).slice(0, 12)
                .map((mv) => ({ movementId: mv.movement_id, label: mv.entry_description ?? mv.description ?? 'Movimento', cents: mv.amount_cents, date: mv.effective_at.slice(0, 10) }));
              return (
                <li key={l.id} className="rounded-lg border border-border bg-card p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium"><DateBR value={l.transaction_date} /> · {l.description}</p>
                      <p className="text-xs text-muted">{l.external_reference ? `Ref. ${l.external_reference}` : 'Sem identificador externo'}</p>
                    </div>
                    <div className="text-right"><Money cents={l.amount_cents} signed className="text-lg font-semibold" /><div><Badge tone={RECON_TONES[l.reconciliation_status] as Tone}>{RECON_LABELS[l.reconciliation_status]}</Badge></div></div>
                  </div>
                  {l.reconciliation_status === 'pending' && p.perms.analyst ? (
                    <div className="mt-3 space-y-3">
                      <Disclosure summary={cands.length ? `Conciliar (${cands.length} sugestão(ões))` : 'Conciliar com um movimento'} open={cands.length === 1 && !cands[0]!.ambiguous}>
                        <ReconcileForm lineId={l.id} lineCents={l.amount_cents} candidates={[...cands, ...others]} />
                      </Disclosure>
                      <Disclosure summary="Ignorar linha (com justificativa)"><ReasonInline action={ignoreLine} id={l.id} label="Ignorar" placeholder="Por que ignorar? (ex.: lançamento duplicado do banco)" /></Disclosure>
                    </div>
                  ) : null}
                  {m ? (
                    <div className="mt-3 text-sm">
                      <p>Conciliada com: <strong>{moveById.get(m.movement_id)?.entry_description ?? moveById.get(m.movement_id)?.description ?? 'movimento do livro'}</strong>{m.difference_cents !== 0 ? <> — diferença <Money cents={m.difference_cents} signed />{m.note ? `: ${m.note}` : ''}</> : null}</p>
                      {p.perms.manager ? <div className="mt-2"><Disclosure summary="Desfazer conciliação"><ReasonInline action={undoReconciliation} id={m.id} label="Desfazer" placeholder="Motivo (fica no histórico)" variant="danger" /></Disclosure></div> : null}
                    </div>
                  ) : null}
                  {l.reconciliation_status === 'ignored' ? (
                    <div className="mt-3 text-sm"><p className="text-muted">Justificativa: {l.ignore_reason}</p>{p.perms.manager ? <div className="mt-2"><UnignoreForm id={l.id} /></div> : null}</div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        <Pagination base="/conciliacao" sp={sp} page={page} total={lines.total} size={30} />
      </Section>

      <Section title="Movimentos sem linha de extrato" description="Movimentos efetivos da conta ainda não vinculados a nenhuma linha. Podem ser lançamentos que o banco ainda não mostrou ou erros de registro.">
        {moves.length === 0 ? <p className="text-sm text-muted">Nenhum movimento pendente neste intervalo.</p> : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-card text-sm">
            {moves.slice(0, 50).map((m) => (
              <li key={m.movement_id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"><span><DateBR value={m.effective_at} /> · {m.entry_description ?? m.description ?? 'Movimento'}{m.counterparty_name ? ` · ${m.counterparty_name}` : ''}</span><Money cents={m.amount_cents} signed /></li>
            ))}
          </ul>
        )}
      </Section>
      {!p.perms.analyst ? <div className="mt-4"><Alert tone="info">Seu perfil é de consulta: você vê a conciliação, mas não pode confirmar vínculos.</Alert></div> : null}
    </>
  );
}
