'use client';

import { useMemo, useState, useId } from 'react';
import { FormMessage, SubmitButton } from '@/components/ui/client';
import { Field, Input, Select, Textarea } from '@/components/ui/primitives';
import { archiveEntry, cancelEntry, createEntry, replanEntry, rescheduleInstallment, setAllocations, settleInstallment, updateEntry } from '@/lib/finance/actions/entries';
import { dueDates, formatDateBR, type Frequency } from '@/lib/finance/dates';
import { FREQUENCY_NAMES, FREQUENCY_OPTIONS, METHOD_LABELS, SETTLEMENT_METHODS, type EntryType } from '@/lib/finance/labels';
import { formatBRL, formatInput, parseBRL, splitInstallments } from '@/lib/finance/money';
import type { Opt } from './forms-accounts';
import { useFinAction } from './use-fin-action';

const sel = (p: string, id: string, name: string, opts: Opt[], value: string | undefined, blank: string, required = false) => (
  <Select id={`${p}${id}`} name={name} required={required} defaultValue={value ?? ''}>
    <option value="">{blank}</option>
    {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
  </Select>
);

type Refs = { counterparties: Opt[]; categories: Opt[]; accounts: Opt[]; costCenters: Opt[] };

export function EntryForm({ type, refs, today }: { type: EntryType; refs: Refs; today: string }) {
  const p = useId();
  const [state, action, ref] = useFinAction(createEntry);
  const e = state.fieldErrors ?? {};
  const [amount, setAmount] = useState('');
  const [n, setN] = useState(1);
  const [first, setFirst] = useState(today);
  const [freq, setFreq] = useState<Frequency>('monthly');
  const preview = useMemo(() => {
    const c = parseBRL(amount);
    if (c === null || c <= 0 || n < 1 || n > 360 || n > 24 || !/^\d{4}-\d{2}-\d{2}$/.test(first)) return null;
    try {
      const parts = splitInstallments(c, n);
      const dates = dueDates(first, n, freq);
      return parts.map((p, i) => ({ n: i + 1, cents: p, due: dates[i]! }));
    } catch { return null; }
  }, [amount, n, first, freq]);
  const label = type === 'payable' ? 'Fornecedor' : 'Cliente';
  return (
    <form ref={ref} action={action} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" noValidate>
      <input type="hidden" name="entry_type" value={type} />
      <div className="sm:col-span-2 lg:col-span-3"><Field label="Descrição" name={`${p}description`} errors={e.description}><Input id={`${p}description`} name="description" required maxLength={200} defaultValue={state.values?.description} aria-invalid={Boolean(e.description)} /></Field></div>
      <Field label={label} name={`${p}counterparty_id`} errors={e.counterparty_id}>{sel(p, 'counterparty_id', 'counterparty_id', refs.counterparties, state.values?.counterparty_id, '— sem vínculo —')}</Field>
      <Field label="Categoria" name={`${p}category_id`} errors={e.category_id}>{sel(p, 'category_id', 'category_id', refs.categories, state.values?.category_id, '— sem categoria —')}</Field>
      <Field label="Conta prevista" name={`${p}expected_account_id`} errors={e.expected_account_id} hint="Onde se espera pagar/receber. Não movimenta saldo.">{sel(p, 'expected_account_id', 'expected_account_id', refs.accounts, state.values?.expected_account_id, '— a definir na baixa —')}</Field>
      <Field label="Valor total (R$)" name={`${p}amount`} errors={e.amount}><Input id={`${p}amount`} name="amount" inputMode="decimal" required placeholder="0,00" value={amount} onChange={(ev) => setAmount(ev.target.value)} aria-invalid={Boolean(e.amount)} /></Field>
      <Field label="Emissão" name={`${p}issue_date`} errors={e.issue_date}><Input id={`${p}issue_date`} name="issue_date" type="date" required defaultValue={state.values?.issue_date ?? today} /></Field>
      <Field label="Competência" name={`${p}competence_date`} errors={e.competence_date} hint="Mês a que o fato pertence (relatórios por competência)."><Input id={`${p}competence_date`} name="competence_date" type="date" required defaultValue={state.values?.competence_date ?? today} /></Field>
      <Field label="1º vencimento" name={`${p}first_due`} errors={e.first_due}><Input id={`${p}first_due`} name="first_due" type="date" required value={first} onChange={(ev) => setFirst(ev.target.value)} aria-invalid={Boolean(e.first_due)} /></Field>
      <Field label="Parcelas" name={`${p}installments`} errors={e.installments}><Input id={`${p}installments`} name="installments" type="number" min={1} max={360} required value={n} onChange={(ev) => setN(Number(ev.target.value) || 1)} /></Field>
      <Field label="Frequência" name={`${p}frequency`} errors={e.frequency}>
        <Select id={`${p}frequency`} name="frequency" value={freq} onChange={(ev) => setFreq(ev.target.value as Frequency)}>{FREQUENCY_OPTIONS.map((f) => <option key={f} value={f}>{FREQUENCY_NAMES[f]}</option>)}</Select>
      </Field>
      {n > 1 && preview ? (
        <div className="sm:col-span-2 lg:col-span-3 rounded-md border border-border p-3 text-sm" aria-live="polite">
          <p className="font-medium">Prévia das parcelas (soma exata: {formatBRL(preview.reduce((a, p) => a + p.cents, 0))})</p>
          <ul className="mt-1 grid gap-x-6 sm:grid-cols-2 lg:grid-cols-3">
            {preview.map((p) => <li key={p.n} className="tabular-nums">{p.n}/{n} · {formatDateBR(p.due)} · {formatBRL(p.cents)}</li>)}
          </ul>
        </div>
      ) : null}
      {refs.costCenters.length ? (
        <fieldset className="sm:col-span-2 lg:col-span-3 rounded-md border border-border p-3">
          <legend className="px-1 text-sm font-medium">Rateio por centro de custo (opcional)</legend>
          <p className="mb-2 text-xs text-muted">Informe pesos (ex.: 60 e 40). O sistema divide o valor exatamente, sem perder centavos.</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {refs.costCenters.map((c) => (
              <div key={c.value}><label htmlFor={`cc:${c.value}`} className="mb-1 block text-xs font-medium">{c.label}</label><Input id={`cc:${c.value}`} name={`cc:${c.value}`} type="number" min={0} placeholder="peso" /></div>
            ))}
          </div>
        </fieldset>
      ) : null}
      <div className="sm:col-span-2 lg:col-span-3"><Field label="Observações" name={`${p}notes`} errors={e.notes}><Textarea id={`${p}notes`} name="notes" maxLength={1000} defaultValue={state.values?.notes} /></Field></div>
      <div className="sm:col-span-2 lg:col-span-3 space-y-3"><FormMessage state={state} /><SubmitButton pendingText="Salvando…">{type === 'payable' ? 'Criar conta a pagar' : 'Criar conta a receber'}</SubmitButton></div>
    </form>
  );
}

export function EntryEditForm({ id, type, refs, values }: { id: string; type: EntryType; refs: Refs; values: { description: string; counterparty_id: string | null; category_id: string | null; expected_account_id: string | null; competence_date: string; notes: string | null } }) {
  const p = useId();
  const [state, action] = useFinAction(updateEntry, { reset: false });
  const e = state.fieldErrors ?? {};
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2" noValidate>
      <input type="hidden" name="id" value={id} />
      <div className="sm:col-span-2"><Field label="Descrição" name={`${p}description`} errors={e.description}><Input id={`${p}description`} name="description" required maxLength={200} defaultValue={values.description} /></Field></div>
      <Field label={type === 'payable' ? 'Fornecedor' : 'Cliente'} name={`${p}counterparty_id`}>{sel(p, 'counterparty_id', 'counterparty_id', refs.counterparties, values.counterparty_id ?? undefined, '— sem vínculo —')}</Field>
      <Field label="Categoria" name={`${p}category_id`}>{sel(p, 'category_id', 'category_id', refs.categories, values.category_id ?? undefined, '— sem categoria —')}</Field>
      <Field label="Conta prevista" name={`${p}expected_account_id`}>{sel(p, 'expected_account_id', 'expected_account_id', refs.accounts, values.expected_account_id ?? undefined, '— a definir na baixa —')}</Field>
      <Field label="Competência" name={`${p}competence_date`} errors={e.competence_date}><Input id={`${p}competence_date`} name="competence_date" type="date" required defaultValue={values.competence_date} /></Field>
      <div className="sm:col-span-2"><Field label="Observações" name={`${p}notes`}><Textarea id={`${p}notes`} name="notes" maxLength={1000} defaultValue={values.notes ?? ''} /></Field></div>
      <div className="sm:col-span-2 space-y-3"><FormMessage state={state} /><SubmitButton variant="secondary" pendingText="Salvando…">Salvar alterações</SubmitButton></div>
    </form>
  );
}

/** Baixa (pagamento/recebimento) de uma parcela. Valor já vem sugerido com o pendente; excesso é recusado pelo banco. */
export function SettleForm({ installmentId, pendingCents, accounts, defaultAccount, today, type }: { installmentId: string; pendingCents: number; accounts: Opt[]; defaultAccount?: string | null; today: string; type: EntryType }) {
  const [state, action, ref] = useFinAction(settleInstallment);
  const e = state.fieldErrors ?? {};
  const verb = type === 'payable' ? 'pagamento' : 'recebimento';
  return (
    <form ref={ref} action={action} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" noValidate>
      <input type="hidden" name="installment_id" value={installmentId} />
      <Field label="Conta" name={`account_id-${installmentId}`} errors={e.account_id}>
        <Select id={`account_id-${installmentId}`} name="account_id" required defaultValue={state.values?.account_id ?? defaultAccount ?? ''}><option value="" disabled>Selecione…</option>{accounts.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}</Select>
      </Field>
      <Field label="Valor (R$)" name={`amount-${installmentId}`} errors={e.amount} hint={`Pendente: ${formatBRL(pendingCents)}`}><Input id={`amount-${installmentId}`} name="amount" inputMode="decimal" required defaultValue={state.values?.amount ?? formatInput(pendingCents)} aria-invalid={Boolean(e.amount)} /></Field>
      <Field label="Data" name={`settled_on-${installmentId}`} errors={e.settled_on}><Input id={`settled_on-${installmentId}`} name="settled_on" type="date" required max={today} defaultValue={state.values?.settled_on ?? today} /></Field>
      <Field label="Forma" name={`method-${installmentId}`}><Select id={`method-${installmentId}`} name="method" defaultValue={state.values?.method ?? 'pix'}>{SETTLEMENT_METHODS.map((m) => <option key={m} value={m}>{METHOD_LABELS[m]}</option>)}</Select></Field>
      <Field label="Referência (opcional)" name={`reference-${installmentId}`}><Input id={`reference-${installmentId}`} name="reference" maxLength={120} defaultValue={state.values?.reference} /></Field>
      <div className="sm:col-span-2 lg:col-span-5 space-y-3"><FormMessage state={state} /><SubmitButton pendingText="Registrando…">{`Registrar ${verb}`}</SubmitButton></div>
    </form>
  );
}

export function ReasonForm({ action: serverAction, id, label, placeholder = 'Motivo', variant = 'danger', extra }: { action: typeof cancelEntry; id: string; label: string; placeholder?: string; variant?: 'danger' | 'secondary'; extra?: Record<string, string> }) {
  const [state, action, ref] = useFinAction(serverAction, { reset: true });
  const e = state.fieldErrors ?? {};
  return (
    <form ref={ref} action={action} className="space-y-2" noValidate>
      <input type="hidden" name="id" value={id} />
      {extra ? Object.entries(extra).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />) : null}
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-56 flex-1"><label htmlFor={`reason-${id}`} className="sr-only">{placeholder}</label><Input id={`reason-${id}`} name="reason" required minLength={5} maxLength={300} placeholder={`${placeholder} (mín. 5 caracteres)`} defaultValue={state.values?.reason} aria-invalid={Boolean(e.reason)} /></div>
        <SubmitButton variant={variant} pendingText="…">{label}</SubmitButton>
      </div>
      {e.reason ? <p role="alert" className="text-xs text-danger">{e.reason[0]}</p> : null}
      <FormMessage state={state} />
    </form>
  );
}

export function RescheduleForm({ installmentId, due }: { installmentId: string; due: string }) {
  const [state, action] = useFinAction(rescheduleInstallment, { reset: false });
  return (
    <form action={action} className="flex flex-wrap items-end gap-2" noValidate>
      <input type="hidden" name="installment_id" value={installmentId} />
      <div><label htmlFor={`due-${installmentId}`} className="sr-only">Novo vencimento</label><Input id={`due-${installmentId}`} name="due" type="date" required defaultValue={due} /></div>
      <SubmitButton variant="secondary" pendingText="…">Reagendar</SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}

export function ReplanForm({ id, amountCents, first }: { id: string; amountCents: number; first: string }) {
  const p = useId();
  const [state, action] = useFinAction(replanEntry, { reset: false });
  const e = state.fieldErrors ?? {};
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-4" noValidate>
      <input type="hidden" name="id" value={id} />
      <Field label="Valor total (R$)" name={`${p}amount`} errors={e.amount}><Input id={`${p}amount`} name="amount" inputMode="decimal" required defaultValue={formatInput(amountCents)} /></Field>
      <Field label="Parcelas" name={`${p}installments`} errors={e.installments}><Input id={`${p}installments`} name="installments" type="number" min={1} max={360} required defaultValue={1} /></Field>
      <Field label="1º vencimento" name={`${p}first_due`} errors={e.first_due}><Input id={`${p}first_due`} name="first_due" type="date" required defaultValue={first} /></Field>
      <Field label="Frequência" name={`${p}frequency`}><Select id={`${p}frequency`} name="frequency" defaultValue="monthly">{FREQUENCY_OPTIONS.map((f) => <option key={f} value={f}>{FREQUENCY_NAMES[f]}</option>)}</Select></Field>
      <div className="sm:col-span-4 space-y-3">
        <p className="text-xs text-muted">Só é possível refazer o plano de um título que nunca recebeu baixa (nem estornada). O rateio é reescalado para o novo valor.</p>
        <FormMessage state={state} /><SubmitButton variant="secondary" pendingText="Refazendo…">Refazer parcelas</SubmitButton>
      </div>
    </form>
  );
}

export function AllocationsForm({ id, centers, current }: { id: string; centers: Opt[]; current: Array<{ cost_center_id: string; amount_cents: number }> }) {
  const [state, action] = useFinAction(setAllocations, { reset: false });
  const byId = new Map(current.map((c) => [c.cost_center_id, c.amount_cents]));
  return (
    <form action={action} className="space-y-3" noValidate>
      <input type="hidden" name="id" value={id} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {centers.map((c) => (
          <div key={c.value}>
            <label htmlFor={`al:${c.value}`} className="mb-1 block text-xs font-medium">{c.label}{byId.has(c.value) ? ` — hoje ${formatBRL(byId.get(c.value)!)}` : ''}</label>
            <Input id={`al:${c.value}`} name={`cc:${c.value}`} type="number" min={0} placeholder="peso" defaultValue={byId.has(c.value) ? byId.get(c.value) : undefined} />
          </div>
        ))}
      </div>
      <p className="text-xs text-muted">Pesos proporcionais (ex.: 60 e 40). Deixe tudo vazio para remover o rateio. A soma sempre fecha exatamente com o valor do título.</p>
      <FormMessage state={state} /><SubmitButton variant="secondary" pendingText="Salvando…">Salvar rateio</SubmitButton>
    </form>
  );
}

export function ArchiveEntryButton({ id }: { id: string }) {
  const [state, action] = useFinAction(archiveEntry, { reset: false });
  return (
    <form action={action} className="space-y-2"><input type="hidden" name="id" value={id} /><SubmitButton variant="secondary" pendingText="…">Arquivar título</SubmitButton><FormMessage state={state} /></form>
  );
}
