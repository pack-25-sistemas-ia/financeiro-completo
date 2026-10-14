import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Alert, Badge, Card, PageHeader } from '@/components/ui/primitives';
import { ArchiveEntryButton, AllocationsForm, EntryEditForm, EntryForm, ReasonForm, RescheduleForm, ReplanForm, SettleForm } from '@/components/finance/forms-entries';
import { AttachmentPanel } from '@/components/finance/attachments';
import { DateBR, Disclosure, Kpi, Money, Pagination, Section, StatusBadge, TD, TH, TableShell } from '@/components/finance/bits';
import { ListFilters } from '@/components/finance/filter-bar';
import { InstallmentsTable } from '@/components/finance/tables';
import { cancelEntry, reverseSettlement } from '@/lib/finance/actions/entries';
import { installmentTotals, listInstallments, loadAudit, loadEntry } from '@/lib/finance/data';
import { formatDateBR } from '@/lib/finance/dates';
import { one, pageFrom, uuidOrNull, type SearchParams } from '@/lib/finance/filters';
import { ENTRY_TYPE_LABELS, METHOD_LABELS, STATUS_LABELS, type EntryType } from '@/lib/finance/labels';
import { accountOpts, categoryLabel, categoryOpts, costCenterOpts, counterpartyOpts, loadRefs, pageCtx } from '@/lib/finance/page';

const base = (t: EntryType) => (t === 'payable' ? '/pagar' : '/receber');
const noun = (t: EntryType) => (t === 'payable' ? 'contas a pagar' : 'contas a receber');

export async function EntriesListPage({ type, sp }: { type: EntryType; sp: SearchParams }) {
  const p = await pageCtx();
  const refs = await loadRefs(p.ctx);
  const page = pageFrom(one(sp.page));
  const status = one(sp.status);
  const venc = one(sp.venc);
  const q = {
    type, q: one(sp.q), venc, status, counterparty: uuidOrNull(one(sp.party)), category: uuidOrNull(one(sp.category)), account: uuidOrNull(one(sp.account)),
    from: one(sp.from)?.match(/^\d{4}-\d{2}-\d{2}$/) ? one(sp.from) : undefined, to: one(sp.to)?.match(/^\d{4}-\d{2}-\d{2}$/) ? one(sp.to) : undefined, page,
  };
  const [{ rows, total }, totals] = await Promise.all([listInstallments(p.ctx, p.tz, q), installmentTotals(p.ctx, p.tz, type)]);
  const isPay = type === 'payable';
  const exportQs = new URLSearchParams(Object.entries({ type, q: q.q, venc, status, party: q.counterparty, category: q.category, account: q.account, from: q.from, to: q.to }).filter(([, v]) => v) as Array<[string, string]>).toString();
  return (
    <>
      <PageHeader title={isPay ? 'Contas a pagar' : 'Contas a receber'} description={isPay ? 'Compromissos previstos. Pagar é dar baixa: só a baixa movimenta o saldo de uma conta.' : 'Direitos previstos. Receber é dar baixa: contas a receber não são saldo disponível.'}>
        <div className="flex flex-wrap gap-2">
          {p.perms.manager ? <a className="inline-flex min-h-10 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/5" href={`/api/export/titulos?${exportQs}`}>Exportar CSV</a> : null}
          {p.perms.analyst ? <Link className="inline-flex min-h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground" href={`${base(type)}/novo`}>{isPay ? 'Nova conta a pagar' : 'Nova conta a receber'}</Link> : null}
        </div>
      </PageHeader>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Em aberto" value={<Money cents={totals.open} />} definition="Saldo pendente de todas as parcelas não canceladas." />
        <Kpi label="Vencido" tone={totals.overdue > 0 ? 'danger' : 'neutral'} value={<Money cents={totals.overdue} />} definition="Pendente com vencimento anterior a hoje." />
        <Kpi label="A vencer" value={<Money cents={totals.upcoming} />} definition="Pendente com vencimento de hoje em diante." />
        <Kpi label={isPay ? 'Parcialmente pagas' : 'Parcialmente recebidas'} value={<span className="text-xl">{totals.partialCount} · <Money cents={totals.partialPending} /></span>} definition="Parcelas com baixa parcial e o saldo que falta." />
      </div>
      {totals.truncated ? <div className="mb-4"><Alert tone="warning">Há mais de 10.000 parcelas: os totais acima consideram apenas as primeiras 10.000. Use os relatórios para o total exato.</Alert></div> : null}
      <ListFilters action={base(type)} values={{ q: q.q, venc, status, party: q.counterparty, category: q.category, account: q.account, from: q.from, to: q.to }} fields={[
        { name: 'q', label: 'Buscar', width: 'w-56' },
        { name: 'venc', label: 'Vencimento', all: 'Qualquer', options: [{ value: 'vencidas', label: 'Vencidas' }, { value: 'hoje', label: 'Vencem hoje' }, { value: '7d', label: 'Próximos 7 dias' }, { value: '30d', label: 'Próximos 30 dias' }, { value: 'parciais', label: 'Parcialmente ' + (isPay ? 'pagas' : 'recebidas') }] },
        { name: 'status', label: 'Situação', all: 'Abertas e quitadas', options: [{ value: 'open', label: STATUS_LABELS[type].open }, { value: 'partial', label: STATUS_LABELS[type].partial }, { value: 'paid', label: STATUS_LABELS[type].paid }, { value: 'cancelled', label: STATUS_LABELS[type].cancelled }] },
        { name: 'party', label: isPay ? 'Fornecedor' : 'Cliente', all: 'Todos', options: counterpartyOpts(refs.counterparties, isPay ? 'supplier' : 'customer') },
        { name: 'category', label: 'Categoria', all: 'Todas', options: categoryOpts(refs.categories, isPay ? 'expense' : 'income') },
        { name: 'account', label: 'Conta prevista', all: 'Todas', options: accountOpts(refs.accounts) },
        { name: 'from', label: 'Vence de', type: 'date', width: 'w-40' }, { name: 'to', label: 'Vence até', type: 'date', width: 'w-40' },
      ]} />
      <InstallmentsTable rows={rows} type={type} />
      <Pagination base={base(type)} sp={sp} page={page} total={total} />
    </>
  );
}

export async function EntryNewPage({ type }: { type: EntryType }) {
  const p = await pageCtx();
  if (!p.perms.analyst) notFound();
  const refs = await loadRefs(p.ctx);
  const isPay = type === 'payable';
  return (
    <>
      <PageHeader title={isPay ? 'Nova conta a pagar' : 'Nova conta a receber'} description={`Registra o título PREVISTO. Isto não movimenta nenhuma conta: o saldo só muda quando você dá baixa (${isPay ? 'pagamento' : 'recebimento'}).`} />
      <Card>
        <EntryForm type={type} today={p.today} refs={{
          counterparties: counterpartyOpts(refs.counterparties, isPay ? 'supplier' : 'customer'), categories: categoryOpts(refs.categories, isPay ? 'expense' : 'income'),
          accounts: accountOpts(refs.accounts), costCenters: costCenterOpts(refs.costCenters),
        }} />
      </Card>
    </>
  );
}

export async function EntryDetailPage({ type, id }: { type: EntryType; id: string }) {
  if (!uuidOrNull(id)) notFound();
  const p = await pageCtx();
  const d = await loadEntry(p.ctx, id);
  if (!d || d.entry.entry_type !== type) notFound();
  const refs = await loadRefs(p.ctx);
  const { entry, installments, settlements, allocations, attachments } = d;
  const isPay = type === 'payable';
  const cp = refs.counterparties.find((c) => c.id === entry.counterparty_id);
  const cat = refs.categories.find((c) => c.id === entry.category_id);
  const acc = (id2: string | null) => refs.accounts.find((a) => a.account_id === id2)?.name ?? '—';
  const paid = installments.reduce((a, i) => a + i.paid_cents, 0);
  const pending = installments.reduce((a, i) => a + i.pending_cents, 0);
  const hasSettlements = settlements.length > 0;
  const accountsOptions = accountOpts(refs.accounts);
  const instById = new Map(installments.map((i) => [i.installment_id, i]));
  const audit = p.perms.admin ? await loadAudit(p.ctx, [entry.id, ...installments.map((i) => i.installment_id), ...settlements.map((s) => s.id)]) : [];
  const cancelled = Boolean(entry.cancelled_at);
  const centers = refs.costCenters.filter((c) => c.active).map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` }));
  return (
    <>
      <PageHeader title={entry.description} description={`${ENTRY_TYPE_LABELS[type]} · ${cp?.name ?? 'sem vínculo'} · ${cat ? categoryLabel(refs.categories, cat) : 'sem categoria'}`}>
        <Link className="text-sm underline underline-offset-2" href={base(type)}>← Voltar para {noun(type)}</Link>
      </PageHeader>
      {cancelled ? <div className="mb-4"><Alert tone="warning">Título cancelado em {formatDateBR(entry.cancelled_at!.slice(0, 10))}: {entry.cancel_reason}</Alert></div> : null}
      {entry.archived_at ? <div className="mb-4"><Alert tone="info">Título arquivado: não aparece nas listas padrão.</Alert></div> : null}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Valor do título" value={<Money cents={entry.amount_cents} />} definition={`${installments.length} parcela(s). Emissão ${formatDateBR(entry.issue_date)} · competência ${formatDateBR(entry.competence_date)}.`} />
        <Kpi label={isPay ? 'Pago' : 'Recebido'} tone="success" value={<Money cents={paid} />} definition="Soma das baixas não estornadas." />
        <Kpi label="Pendente" tone={pending > 0 && !cancelled ? 'warning' : 'neutral'} value={<Money cents={cancelled ? 0 : pending} />} definition="Valor das parcelas menos as baixas ativas." />
        <Kpi label="Conta prevista" value={<span className="text-lg">{acc(entry.expected_account_id)}</span>} definition="Previsão para a baixa; a conta real é escolhida em cada baixa." />
      </div>

      <Section title="Parcelas" description="Cada parcela tem a própria situação. A baixa pode ser parcial; o excesso sobre o pendente é recusado.">
        <TableShell caption="Parcelas do título">
          <thead><tr className="border-b border-border"><th className={TH}>Parcela</th><th className={TH}>Vencimento</th><th className={TH}>Valor</th><th className={TH}>{isPay ? 'Pago' : 'Recebido'}</th><th className={TH}>Pendente</th><th className={TH}>Situação</th></tr></thead>
          <tbody>
            {installments.map((i) => (
              <tr key={i.installment_id} className="border-b border-border last:border-0">
                <td className={TD}>{i.installment_number}/{i.total_installments}</td><td className={TD}><DateBR value={i.due_date} /></td>
                <td className={TD}><Money cents={i.amount_cents} /></td><td className={TD}><Money cents={i.paid_cents} /></td><td className={TD}><Money cents={i.pending_cents} /></td>
                <td className={TD}><StatusBadge type={type} status={i.status} overdue={i.is_overdue} /></td>
              </tr>
            ))}
          </tbody>
        </TableShell>
        {!cancelled && p.perms.manager ? (
          <div className="mt-4 space-y-3">
            {installments.filter((i) => i.pending_cents > 0).map((i) => (
              <Disclosure key={i.installment_id} summary={`${isPay ? 'Pagar' : 'Receber'} parcela ${i.installment_number}/${i.total_installments} — pendente ${(i.pending_cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`} tone="primary">
                <SettleForm installmentId={i.installment_id} pendingCents={i.pending_cents} accounts={accountsOptions} defaultAccount={entry.expected_account_id} today={p.today} type={type} />
              </Disclosure>
            ))}
          </div>
        ) : null}
        {!cancelled && p.perms.analyst && installments.some((i) => i.pending_cents > 0) ? (
          <div className="mt-3"><Disclosure summary="Alterar vencimento de uma parcela">
            <div className="space-y-3">{installments.filter((i) => i.pending_cents > 0).map((i) => (<div key={i.installment_id} className="flex flex-wrap items-center gap-3"><span className="w-24 text-sm">Parcela {i.installment_number}/{i.total_installments}</span><RescheduleForm installmentId={i.installment_id} due={i.due_date} /></div>))}</div>
          </Disclosure></div>
        ) : null}
      </Section>

      <Section title={`Histórico de ${isPay ? 'pagamentos' : 'recebimentos'}`} description="Baixas e estornos ficam preservados; correção é sempre por estorno, nunca por edição.">
        <TableShell caption="Baixas do título" empty={settlements.length === 0} emptyText="Nenhuma baixa registrada. O título ainda é só uma previsão.">
          <thead><tr className="border-b border-border"><th className={TH}>Data</th><th className={TH}>Parcela</th><th className={TH}>Conta</th><th className={TH}>Forma</th><th className={TH}>Valor</th><th className={TH}>Situação</th><th className={TH}>Estorno</th></tr></thead>
          <tbody>
            {settlements.map((s) => (
              <tr key={s.id} className="border-b border-border align-top last:border-0">
                <td className={TD}><DateBR value={s.settled_at} /></td><td className={TD}>{instById.get(s.installment_id)?.installment_number ?? '—'}</td><td className={TD}>{acc(s.account_id)}</td>
                <td className={TD}>{METHOD_LABELS[s.settlement_method as keyof typeof METHOD_LABELS] ?? s.settlement_method}{s.external_reference ? <span className="block text-xs text-muted">Ref. {s.external_reference}</span> : null}</td>
                <td className={TD}><Money cents={s.amount_cents} /></td>
                <td className={TD}>{s.reversed_at ? <><Badge tone="warning">Estornada</Badge><span className="block text-xs text-muted">{s.reversal_reason}</span></> : <Badge tone="success">Ativa</Badge>}</td>
                <td className={TD}>{!s.reversed_at && p.perms.manager ? <Disclosure summary="Estornar"><ReasonForm action={reverseSettlement} id={s.id} label="Estornar baixa" placeholder="Motivo do estorno" /></Disclosure> : <span className="text-muted">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      </Section>

      {allocations.length || (p.perms.analyst && centers.length && !cancelled) ? (
        <Section title="Rateio por centro de custo" description="Soma exata do valor do título. Distribui centavos pelo método do maior resto.">
          {allocations.length ? (
            <ul className="mb-3 grid gap-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
              {allocations.map((a) => { const c = refs.costCenters.find((x) => x.id === a.cost_center_id); return <li key={a.cost_center_id}>{c ? `${c.code} · ${c.name}` : 'Centro removido'}: <Money cents={a.amount_cents} /></li>; })}
            </ul>
          ) : <p className="mb-3 text-sm text-muted">Sem rateio: o valor não está atribuído a um centro de custo.</p>}
          {p.perms.analyst && !cancelled && centers.length ? <Disclosure summary="Definir ou alterar rateio"><AllocationsForm id={entry.id} centers={centers} current={allocations} /></Disclosure> : null}
        </Section>
      ) : null}

      <Section title="Comprovantes e anexos" description="PDF, PNG ou JPG de até 10 MB. Armazenados em área privada; abertura por link temporário.">
        <AttachmentPanel entityType="entry" entityId={entry.id} items={attachments.filter((a) => a.entity_id === entry.id)} canUpload={p.perms.analyst} />
        {settlements.length ? (
          <div className="mt-4 space-y-3">
            {settlements.map((s) => (
              <div key={s.id}><p className="mb-1 text-sm font-medium">Comprovante da baixa de {formatDateBR(s.settled_at.slice(0, 10))} ({(s.amount_cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })})</p>
                <AttachmentPanel entityType="settlement" entityId={s.id} items={attachments.filter((a) => a.entity_id === s.id)} canUpload={p.perms.analyst} /></div>
            ))}
          </div>
        ) : null}
      </Section>

      {p.perms.analyst && !cancelled ? (
        <Section title="Editar e gerenciar">
          <div className="space-y-3">
            <Disclosure summary="Editar dados do título (descrição, vínculo, categoria, competência)">
              <EntryEditForm id={entry.id} type={type} values={{ description: entry.description, counterparty_id: entry.counterparty_id, category_id: entry.category_id, expected_account_id: entry.expected_account_id, competence_date: entry.competence_date, notes: entry.notes }}
                refs={{ counterparties: counterpartyOpts(refs.counterparties, isPay ? 'supplier' : 'customer'), categories: categoryOpts(refs.categories, isPay ? 'expense' : 'income'), accounts: accountsOptions, costCenters: centers }} />
            </Disclosure>
            {p.perms.manager && !hasSettlements ? <Disclosure summary="Refazer o plano de parcelas (valor, número, datas)"><ReplanForm id={entry.id} amountCents={entry.amount_cents} first={installments[0]?.due_date ?? entry.due_date} /></Disclosure> : null}
            {p.perms.manager && hasSettlements ? <p className="text-sm text-muted">O valor e as parcelas não podem mais ser refeitos porque já existe baixa (mesmo estornada). Para corrigir, cancele este título e lance outro.</p> : null}
            {p.perms.manager ? <Disclosure summary="Cancelar título" tone="danger"><ReasonForm action={cancelEntry} id={entry.id} label="Cancelar título" placeholder="Motivo do cancelamento" /><p className="mt-2 text-xs text-muted">Só é possível cancelar sem baixas ativas. O título cancelado permanece no histórico.</p></Disclosure> : null}
            {p.perms.manager && pending === 0 ? <ArchiveEntryButton id={entry.id} /> : null}
          </div>
        </Section>
      ) : null}
      {p.perms.manager && cancelled && !entry.archived_at ? <Section title="Gerenciar"><ArchiveEntryButton id={entry.id} /></Section> : null}

      {p.perms.admin ? (
        <Section title="Trilha de auditoria" description="Alterações registradas (somente nomes dos campos, nunca valores). Visível apenas para administradores.">
          <TableShell caption="Auditoria do título" empty={audit.length === 0}>
            <thead><tr className="border-b border-border"><th className={TH}>Quando</th><th className={TH}>Ação</th><th className={TH}>Registro</th><th className={TH}>Campos</th></tr></thead>
            <tbody>{audit.map((a) => <tr key={a.id} className="border-b border-border last:border-0"><td className={TD}>{formatDateBR(a.created_at.slice(0, 10))}</td><td className={TD}>{a.action}</td><td className={TD}>{a.entity}</td><td className={TD}>{a.changes?.columns?.join(', ') ?? '—'}</td></tr>)}</tbody>
          </TableShell>
        </Section>
      ) : null}
    </>
  );
}
