'use client';

import { useId } from 'react';
import { FormMessage, SubmitButton } from '@/components/ui/client';
import { Field, Input, Select, Textarea } from '@/components/ui/primitives';
import { createCategory, createCostCenter, createCounterparty, setCounterpartyArchived, updateCategory, updateCostCenter, updateCounterparty } from '@/lib/finance/actions/catalogs';
import { COUNTERPARTY_KINDS, COUNTERPARTY_LABELS, NATURES, NATURE_LABELS } from '@/lib/finance/labels';
import type { CounterpartyRow } from '@/lib/finance/data';
import type { Opt } from './forms-accounts';
import { useFinAction } from './use-fin-action';

export function CategoryForm({ parents }: { parents: Array<Opt & { nature: string }> }) {
  const p = useId();
  const [state, action, ref] = useFinAction(createCategory);
  const e = state.fieldErrors ?? {};
  return (
    <form ref={ref} action={action} className="grid gap-4 sm:grid-cols-4" noValidate>
      <Field label="Nome" name={`${p}name`} errors={e.name}><Input id={`${p}name`} name="name" required maxLength={80} defaultValue={state.values?.name} /></Field>
      <Field label="Natureza" name={`${p}nature`} errors={e.nature}><Select id={`${p}nature`} name="nature" defaultValue={state.values?.nature ?? 'expense'}>{NATURES.map((n) => <option key={n} value={n}>{NATURE_LABELS[n]}</option>)}</Select></Field>
      <div className="sm:col-span-2"><Field label="Categoria-pai (opcional)" name={`${p}parent_id`} errors={e.parent_id} hint="Subcategoria precisa ter a mesma natureza do pai (até 3 níveis).">
        <Select id={`${p}parent_id`} name="parent_id" defaultValue={state.values?.parent_id ?? ''}><option value="">— categoria principal —</option>{parents.map((p) => <option key={p.value} value={p.value}>{p.label} ({NATURE_LABELS[p.nature as 'income' | 'expense']})</option>)}</Select>
      </Field></div>
      <div className="sm:col-span-4 space-y-3"><FormMessage state={state} /><SubmitButton pendingText="Criando…">Criar categoria</SubmitButton></div>
    </form>
  );
}

export function CategoryRowForm({ id, name, active }: { id: string; name: string; active: boolean }) {
  const [state, action] = useFinAction(updateCategory, { reset: false });
  return (
    <form action={action} className="flex flex-wrap items-center gap-2" noValidate>
      <input type="hidden" name="id" value={id} />
      <label htmlFor={`cn-${id}`} className="sr-only">Nome</label>
      <Input id={`cn-${id}`} name="name" defaultValue={name} required maxLength={80} className="w-56" />
      <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" name="active" defaultChecked={active} /> Ativa</label>
      <SubmitButton variant="secondary" pendingText="…">Salvar</SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}

export function CostCenterForm() {
  const p = useId();
  const [state, action, ref] = useFinAction(createCostCenter);
  const e = state.fieldErrors ?? {};
  return (
    <form ref={ref} action={action} className="grid gap-4 sm:grid-cols-4" noValidate>
      <Field label="Nome" name={`${p}name`} errors={e.name}><Input id={`${p}name`} name="name" required maxLength={80} defaultValue={state.values?.name} /></Field>
      <Field label="Código" name={`${p}code`} errors={e.code} hint="Ex.: COM, OPS, TI."><Input id={`${p}code`} name="code" required maxLength={20} defaultValue={state.values?.code} /></Field>
      <div className="sm:col-span-2"><Field label="Descrição (opcional)" name={`${p}description`} errors={e.description}><Input id={`${p}description`} name="description" maxLength={300} defaultValue={state.values?.description} /></Field></div>
      <div className="sm:col-span-4 space-y-3"><FormMessage state={state} /><SubmitButton pendingText="Criando…">Criar centro de custo</SubmitButton></div>
    </form>
  );
}

export function CostCenterRowForm({ id, name, code, description, active }: { id: string; name: string; code: string; description: string | null; active: boolean }) {
  const [state, action] = useFinAction(updateCostCenter, { reset: false });
  return (
    <form action={action} className="flex flex-wrap items-end gap-2" noValidate>
      <input type="hidden" name="id" value={id} />
      <div><label htmlFor={`ccn-${id}`} className="sr-only">Nome</label><Input id={`ccn-${id}`} name="name" defaultValue={name} required maxLength={80} className="w-44" /></div>
      <div><label htmlFor={`ccc-${id}`} className="sr-only">Código</label><Input id={`ccc-${id}`} name="code" defaultValue={code} required maxLength={20} className="w-24" /></div>
      <div><label htmlFor={`ccd-${id}`} className="sr-only">Descrição</label><Input id={`ccd-${id}`} name="description" defaultValue={description ?? ''} maxLength={300} className="w-56" /></div>
      <label className="flex items-center gap-1.5 pb-2 text-sm"><input type="checkbox" name="active" defaultChecked={active} /> Ativo</label>
      <SubmitButton variant="secondary" pendingText="…">Salvar</SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}

export function CounterpartyForm({ defaultKind }: { defaultKind: 'customer' | 'supplier' }) {
  const p = useId();
  const [state, action, ref] = useFinAction(createCounterparty);
  const e = state.fieldErrors ?? {};
  return (
    <form ref={ref} action={action} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" noValidate>
      <Field label="Tipo" name={`${p}kind`} errors={e.kind}><Select id={`${p}kind`} name="kind" defaultValue={state.values?.kind ?? defaultKind}>{COUNTERPARTY_KINDS.map((k) => <option key={k} value={k}>{COUNTERPARTY_LABELS[k]}</option>)}</Select></Field>
      <Field label="Nome" name={`${p}name`} errors={e.name}><Input id={`${p}name`} name="name" required maxLength={120} defaultValue={state.values?.name} /></Field>
      <Field label="Razão social" name={`${p}legal_name`} errors={e.legal_name}><Input id={`${p}legal_name`} name="legal_name" maxLength={160} defaultValue={state.values?.legal_name} /></Field>
      <Field label="CPF/CNPJ" name={`${p}document_number`} errors={e.document_number} hint="Dado pessoal: usado só para identificar o cadastro."><Input id={`${p}document_number`} name="document_number" inputMode="numeric" maxLength={18} defaultValue={state.values?.document_number} /></Field>
      <Field label="E-mail" name={`${p}email`} errors={e.email}><Input id={`${p}email`} name="email" type="email" maxLength={254} defaultValue={state.values?.email} /></Field>
      <Field label="Telefone" name={`${p}phone`} errors={e.phone}><Input id={`${p}phone`} name="phone" maxLength={30} defaultValue={state.values?.phone} /></Field>
      <div className="sm:col-span-2 lg:col-span-3"><Field label="Observações" name={`${p}notes`} errors={e.notes}><Textarea id={`${p}notes`} name="notes" maxLength={500} defaultValue={state.values?.notes} /></Field></div>
      <div className="sm:col-span-2 lg:col-span-3 space-y-3"><FormMessage state={state} /><SubmitButton pendingText="Salvando…">Cadastrar</SubmitButton></div>
    </form>
  );
}

export function CounterpartyEditForm({ c }: { c: CounterpartyRow }) {
  const p = useId();
  const [state, action] = useFinAction(updateCounterparty, { reset: false });
  const e = state.fieldErrors ?? {};
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" noValidate>
      <input type="hidden" name="id" value={c.id} />
      <Field label="Tipo" name={`${p}kind`}><Select id={`${p}kind`} name="kind" defaultValue={c.kind}>{COUNTERPARTY_KINDS.map((k) => <option key={k} value={k}>{COUNTERPARTY_LABELS[k]}</option>)}</Select></Field>
      <Field label="Nome" name={`${p}name`} errors={e.name}><Input id={`${p}name`} name="name" required maxLength={120} defaultValue={c.name} /></Field>
      <Field label="Razão social" name={`${p}legal_name`}><Input id={`${p}legal_name`} name="legal_name" maxLength={160} defaultValue={c.legal_name ?? ''} /></Field>
      <Field label="CPF/CNPJ" name={`${p}document_number`} errors={e.document_number}><Input id={`${p}document_number`} name="document_number" inputMode="numeric" maxLength={18} defaultValue={c.document_number ?? ''} /></Field>
      <Field label="E-mail" name={`${p}email`} errors={e.email}><Input id={`${p}email`} name="email" type="email" maxLength={254} defaultValue={c.email ?? ''} /></Field>
      <Field label="Telefone" name={`${p}phone`}><Input id={`${p}phone`} name="phone" maxLength={30} defaultValue={c.phone ?? ''} /></Field>
      <div className="sm:col-span-2 lg:col-span-3"><Field label="Observações" name={`${p}notes`}><Textarea id={`${p}notes`} name="notes" maxLength={500} defaultValue={c.notes ?? ''} /></Field></div>
      <div className="sm:col-span-2 lg:col-span-3 space-y-3"><FormMessage state={state} /><SubmitButton variant="secondary" pendingText="Salvando…">Salvar alterações</SubmitButton></div>
    </form>
  );
}

export function ArchiveCounterpartyButton({ id, archived }: { id: string; archived: boolean }) {
  const [state, action] = useFinAction(setCounterpartyArchived, { reset: false });
  return (
    <form action={action} className="space-y-1">
      <input type="hidden" name="id" value={id} /><input type="hidden" name="archive" value={archived ? '0' : '1'} />
      <SubmitButton variant="secondary" pendingText="…">{archived ? 'Reativar' : 'Arquivar'}</SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}
