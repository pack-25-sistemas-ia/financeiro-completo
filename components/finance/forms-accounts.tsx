'use client';

import { useId } from 'react';
import { FormMessage, SubmitButton } from '@/components/ui/client';
import { Field, Input, Select, Textarea } from '@/components/ui/primitives';
import { archiveAccount, createAccount, createAdjustment, createTransfer, reverseTransfer, setOpeningBalance, unarchiveAccount, updateAccount } from '@/lib/finance/actions/accounts';
import { ACCOUNT_TYPES, ACCOUNT_TYPE_LABELS, ADJUSTMENT_KINDS, ADJUSTMENT_LABELS } from '@/lib/finance/labels';
import { formatInput } from '@/lib/finance/money';
import { useFinAction } from './use-fin-action';

export type Opt = { value: string; label: string };

export function AccountCreateForm({ today }: { today: string }) {
  const p = useId();
  const [state, action, ref] = useFinAction(createAccount);
  const e = state.fieldErrors ?? {};
  return (
    <form ref={ref} action={action} className="grid gap-4 sm:grid-cols-2" noValidate>
      <Field label="Nome da conta" name={`${p}name`} errors={e.name}><Input id={`${p}name`} name="name" required maxLength={80} defaultValue={state.values?.name} aria-invalid={Boolean(e.name)} /></Field>
      <Field label="Tipo" name={`${p}account_type`} errors={e.account_type}>
        <Select id={`${p}account_type`} name="account_type" defaultValue={state.values?.account_type ?? 'checking'}>{ACCOUNT_TYPES.map((t) => <option key={t} value={t}>{ACCOUNT_TYPE_LABELS[t]}</option>)}</Select>
      </Field>
      <Field label="Instituição" name={`${p}institution`} errors={e.institution}><Input id={`${p}institution`} name="institution" maxLength={80} defaultValue={state.values?.institution} /></Field>
      <Field label="Saldo inicial (R$)" name={`${p}opening`} errors={e.opening} hint="Pode ser negativo. Limite de crédito não entra aqui."><Input id={`${p}opening`} name="opening" inputMode="decimal" required defaultValue={state.values?.opening ?? '0,00'} aria-invalid={Boolean(e.opening)} /></Field>
      <Field label="Data do saldo inicial" name={`${p}opening_date`} errors={e.opening_date} hint="Movimentos anteriores a esta data não contam."><Input id={`${p}opening_date`} name="opening_date" type="date" required max={today} defaultValue={state.values?.opening_date ?? today} /></Field>
      <div className="flex flex-col justify-end gap-2 pb-1 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" name="include" defaultChecked /> Incluir no saldo consolidado</label>
        <label className="flex items-center gap-2"><input type="checkbox" name="allow_negative" defaultChecked /> Permitir saldo negativo (cheque especial/descoberto)</label>
      </div>
      <div className="sm:col-span-2 space-y-3"><FormMessage state={state} /><SubmitButton pendingText="Criando…">Criar conta</SubmitButton></div>
    </form>
  );
}

export function AccountEditForm({ id, name, institution, include, allowNegative }: { id: string; name: string; institution: string | null; include: boolean; allowNegative: boolean }) {
  const p = useId();
  const [state, action] = useFinAction(updateAccount, { reset: false });
  const e = state.fieldErrors ?? {};
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2" noValidate>
      <input type="hidden" name="id" value={id} />
      <Field label="Nome" name={`${p}name`} errors={e.name}><Input id={`${p}name`} name="name" required maxLength={80} defaultValue={name} /></Field>
      <Field label="Instituição" name={`${p}institution`}><Input id={`${p}institution`} name="institution" maxLength={80} defaultValue={institution ?? ''} /></Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="include" defaultChecked={include} /> Incluir no saldo consolidado</label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="allow_negative" defaultChecked={allowNegative} /> Permitir saldo negativo</label>
      <div className="sm:col-span-2 space-y-3"><FormMessage state={state} /><SubmitButton variant="secondary" pendingText="Salvando…">Salvar alterações</SubmitButton></div>
    </form>
  );
}

export function OpeningForm({ id, cents, date, today }: { id: string; cents: number; date: string; today: string }) {
  const p = useId();
  const [state, action, ref] = useFinAction(setOpeningBalance, { reset: false });
  const e = state.fieldErrors ?? {};
  return (
    <form ref={ref} action={action} className="grid gap-4 sm:grid-cols-3" noValidate>
      <input type="hidden" name="id" value={id} />
      <Field label="Novo saldo inicial (R$)" name={`${p}opening`} errors={e.opening}><Input id={`${p}opening`} name="opening" inputMode="decimal" required defaultValue={formatInput(cents)} /></Field>
      <Field label="Data do saldo" name={`${p}opening_date`} errors={e.opening_date}><Input id={`${p}opening_date`} name="opening_date" type="date" required max={today} defaultValue={date} /></Field>
      <div className="sm:col-span-3"><Field label="Motivo da correção (fica registrado)" name={`${p}reason`} errors={e.reason}><Textarea id={`${p}reason`} name="reason" required minLength={5} maxLength={300} defaultValue={state.values?.reason} /></Field></div>
      <div className="sm:col-span-3 space-y-3"><FormMessage state={state} /><SubmitButton variant="danger" pendingText="Corrigindo…">Corrigir saldo inicial</SubmitButton></div>
    </form>
  );
}

export function ArchiveAccountButton({ id, archived }: { id: string; archived: boolean }) {
  const [state, action] = useFinAction(archived ? unarchiveAccount : archiveAccount, { reset: false });
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="id" value={id} />
      <SubmitButton variant={archived ? 'secondary' : 'danger'} pendingText="…">{archived ? 'Reativar conta' : 'Arquivar conta'}</SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}

export function TransferForm({ accounts, today }: { accounts: Opt[]; today: string }) {
  const p = useId();
  const [state, action, ref] = useFinAction(createTransfer);
  const e = state.fieldErrors ?? {};
  return (
    <form ref={ref} action={action} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" noValidate>
      <Field label="Conta de origem" name={`${p}source_id`} errors={e.source_id}><Select id={`${p}source_id`} name="source_id" required defaultValue={state.values?.source_id ?? ''}><option value="" disabled>Selecione…</option>{accounts.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}</Select></Field>
      <Field label="Conta de destino" name={`${p}destination_id`} errors={e.destination_id}><Select id={`${p}destination_id`} name="destination_id" required defaultValue={state.values?.destination_id ?? ''}><option value="" disabled>Selecione…</option>{accounts.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}</Select></Field>
      <Field label="Valor (R$)" name={`${p}amount`} errors={e.amount}><Input id={`${p}amount`} name="amount" inputMode="decimal" required placeholder="0,00" defaultValue={state.values?.amount} /></Field>
      <Field label="Data" name={`${p}on`} errors={e.on}><Input id={`${p}on`} name="on" type="date" required max={today} defaultValue={state.values?.on ?? today} /></Field>
      <div className="sm:col-span-2 lg:col-span-4"><Field label="Descrição (opcional)" name={`${p}description`} errors={e.description}><Input id={`${p}description`} name="description" maxLength={200} defaultValue={state.values?.description} /></Field></div>
      <div className="sm:col-span-2 lg:col-span-4 space-y-3"><FormMessage state={state} /><SubmitButton pendingText="Transferindo…">Transferir</SubmitButton></div>
    </form>
  );
}

export function AdjustmentForm({ accounts, today }: { accounts: Opt[]; today: string }) {
  const p = useId();
  const [state, action, ref] = useFinAction(createAdjustment);
  const e = state.fieldErrors ?? {};
  return (
    <form ref={ref} action={action} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" noValidate>
      <Field label="Conta" name={`${p}account_id`} errors={e.account_id}><Select id={`${p}account_id`} name="account_id" required defaultValue={state.values?.account_id ?? ''}><option value="" disabled>Selecione…</option>{accounts.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}</Select></Field>
      <Field label="Tipo" name={`${p}kind`} errors={e.kind}><Select id={`${p}kind`} name="kind" defaultValue={state.values?.kind ?? 'fee'}>{ADJUSTMENT_KINDS.map((k) => <option key={k} value={k}>{ADJUSTMENT_LABELS[k]}</option>)}</Select></Field>
      <Field label="Valor (R$)" name={`${p}amount`} errors={e.amount} hint="Negativo reduz o saldo (ex.: -15,00 de tarifa)."><Input id={`${p}amount`} name="amount" inputMode="decimal" required defaultValue={state.values?.amount} /></Field>
      <Field label="Data" name={`${p}on`} errors={e.on}><Input id={`${p}on`} name="on" type="date" required max={today} defaultValue={state.values?.on ?? today} /></Field>
      <div className="sm:col-span-2 lg:col-span-4"><Field label="Motivo (obrigatório)" name={`${p}reason`} errors={e.reason}><Input id={`${p}reason`} name="reason" required minLength={5} maxLength={300} defaultValue={state.values?.reason} /></Field></div>
      <div className="sm:col-span-2 lg:col-span-4 space-y-3">
        <p className="text-xs text-muted">Ajustes ficam fora de receita e despesa operacionais. Para um custo do negócio, lance uma conta a pagar e dê baixa nela.</p>
        <FormMessage state={state} /><SubmitButton variant="secondary" pendingText="Registrando…">Registrar ajuste</SubmitButton>
      </div>
    </form>
  );
}

export function ReverseTransferForm({ id }: { id: string }) {
  const [state, action, ref] = useFinAction(reverseTransfer);
  const e = state.fieldErrors ?? {};
  return (
    <form ref={ref} action={action} className="flex flex-wrap items-end gap-2" noValidate>
      <input type="hidden" name="id" value={id} />
      <div className="min-w-48 flex-1"><label htmlFor={`rt-${id}`} className="sr-only">Motivo do estorno</label><Input id={`rt-${id}`} name="reason" required minLength={5} maxLength={300} placeholder="Motivo do estorno" aria-invalid={Boolean(e.reason)} /></div>
      <SubmitButton variant="danger" pendingText="…">Estornar</SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}
