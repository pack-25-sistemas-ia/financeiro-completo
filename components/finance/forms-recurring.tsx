'use client';

import { FormMessage, SubmitButton } from '@/components/ui/client';
import { Field, Input, Select, Textarea } from '@/components/ui/primitives';
import { createRule, generateNow, ruleOperation, updateRule } from '@/lib/finance/actions/recurring';
import { ENTRY_TYPES, ENTRY_TYPE_LABELS, FREQUENCY_NAMES, FREQUENCY_OPTIONS } from '@/lib/finance/labels';
import { formatInput } from '@/lib/finance/money';
import { useActionState, useId } from 'react';
import { useRouter } from 'next/navigation';
import type { ActionState } from '@/lib/actions/result';
import type { Opt } from './forms-accounts';
import { useFinAction } from './use-fin-action';

type Refs = { counterparties: Opt[]; categories: Opt[]; accounts: Opt[] };
const pick = (p: string, id: string, name: string, opts: Opt[], value: string | undefined, blank: string) => (
  <Select id={`${p}${id}`} name={name} defaultValue={value ?? ''}><option value="">{blank}</option>{opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
);

export function RuleForm({ refs, today }: { refs: Refs; today: string }) {
  const p = useId();
  const [state, action, ref] = useFinAction(createRule);
  const e = state.fieldErrors ?? {};
  return (
    <form ref={ref} action={action} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" noValidate>
      <Field label="Tipo" name={`${p}entry_type`} errors={e.entry_type}><Select id={`${p}entry_type`} name="entry_type" defaultValue={state.values?.entry_type ?? 'payable'}>{ENTRY_TYPES.map((t) => <option key={t} value={t}>{ENTRY_TYPE_LABELS[t]}</option>)}</Select></Field>
      <div className="sm:col-span-2"><Field label="Descrição" name={`${p}description`} errors={e.description}><Input id={`${p}description`} name="description" required maxLength={200} placeholder="Ex.: Aluguel da sede" defaultValue={state.values?.description} /></Field></div>
      <Field label="Cliente/Fornecedor" name={`${p}counterparty_id`}>{pick(p, 'counterparty_id', 'counterparty_id', refs.counterparties, state.values?.counterparty_id, '— sem vínculo —')}</Field>
      <Field label="Categoria" name={`${p}category_id`} errors={e.category_id}>{pick(p, 'category_id', 'category_id', refs.categories, state.values?.category_id, '— sem categoria —')}</Field>
      <Field label="Conta prevista" name={`${p}expected_account_id`}>{pick(p, 'expected_account_id', 'expected_account_id', refs.accounts, state.values?.expected_account_id, '— a definir na baixa —')}</Field>
      <Field label="Valor (R$)" name={`${p}amount`} errors={e.amount}><Input id={`${p}amount`} name="amount" inputMode="decimal" required defaultValue={state.values?.amount} /></Field>
      <Field label="Frequência" name={`${p}frequency`}><Select id={`${p}frequency`} name="frequency" defaultValue={state.values?.frequency ?? 'monthly'}>{FREQUENCY_OPTIONS.map((f) => <option key={f} value={f}>{FREQUENCY_NAMES[f]}</option>)}</Select></Field>
      <Field label="A cada (unidades)" name={`${p}interval`} errors={e.interval} hint="2 + mensal = a cada 2 meses."><Input id={`${p}interval`} name="interval" type="number" min={1} max={12} required defaultValue={state.values?.interval ?? 1} /></Field>
      <Field label="Início (1º vencimento)" name={`${p}starts_on`} errors={e.starts_on}><Input id={`${p}starts_on`} name="starts_on" type="date" required defaultValue={state.values?.starts_on ?? today} /></Field>
      <Field label="Término (opcional)" name={`${p}ends_on`} errors={e.ends_on}><Input id={`${p}ends_on`} name="ends_on" type="date" defaultValue={state.values?.ends_on} /></Field>
      <Field label="Gerar com antecedência de (dias)" name={`${p}lead_days`} errors={e.lead_days} hint="Quantos dias antes do vencimento o título previsto aparece."><Input id={`${p}lead_days`} name="lead_days" type="number" min={0} max={365} required defaultValue={state.values?.lead_days ?? 30} /></Field>
      <div className="sm:col-span-2 lg:col-span-3"><Field label="Observações" name={`${p}notes`}><Textarea id={`${p}notes`} name="notes" maxLength={500} defaultValue={state.values?.notes} /></Field></div>
      <div className="sm:col-span-2 lg:col-span-3 space-y-3">
        <p className="text-xs text-muted">A regra gera títulos PREVISTOS (nunca pagamento nem movimento bancário). Cada vencimento é calculado a partir da data inicial; em meses curtos o dia é ajustado (31/jan → 28 ou 29/fev).</p>
        <FormMessage state={state} /><SubmitButton pendingText="Criando…">Criar regra</SubmitButton>
      </div>
    </form>
  );
}

export function RuleEditForm({ rule, refs }: { rule: { id: string; description: string; counterparty_id: string | null; category_id: string | null; expected_account_id: string | null; amount_cents: number; ends_on: string | null; lead_days: number; notes: string | null }; refs: Refs }) {
  const p = useId();
  const [state, action] = useFinAction(updateRule, { reset: false });
  const e = state.fieldErrors ?? {};
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" noValidate>
      <input type="hidden" name="id" value={rule.id} />
      <div className="sm:col-span-2"><Field label="Descrição" name={`${p}description`} errors={e.description}><Input id={`${p}description`} name="description" required maxLength={200} defaultValue={rule.description} /></Field></div>
      <Field label="Valor (R$)" name={`${p}amount`} errors={e.amount}><Input id={`${p}amount`} name="amount" inputMode="decimal" required defaultValue={formatInput(rule.amount_cents)} /></Field>
      <Field label="Cliente/Fornecedor" name={`${p}counterparty_id`}>{pick(p, 'counterparty_id', 'counterparty_id', refs.counterparties, rule.counterparty_id ?? undefined, '— sem vínculo —')}</Field>
      <Field label="Categoria" name={`${p}category_id`}>{pick(p, 'category_id', 'category_id', refs.categories, rule.category_id ?? undefined, '— sem categoria —')}</Field>
      <Field label="Conta prevista" name={`${p}expected_account_id`}>{pick(p, 'expected_account_id', 'expected_account_id', refs.accounts, rule.expected_account_id ?? undefined, '— a definir na baixa —')}</Field>
      <Field label="Término" name={`${p}ends_on`} errors={e.ends_on}><Input id={`${p}ends_on`} name="ends_on" type="date" defaultValue={rule.ends_on ?? ''} /></Field>
      <Field label="Antecedência (dias)" name={`${p}lead_days`} errors={e.lead_days}><Input id={`${p}lead_days`} name="lead_days" type="number" min={0} max={365} required defaultValue={rule.lead_days} /></Field>
      <div className="sm:col-span-2 lg:col-span-3"><Field label="Observações" name={`${p}notes`}><Textarea id={`${p}notes`} name="notes" maxLength={500} defaultValue={rule.notes ?? ''} /></Field></div>
      <div className="sm:col-span-2 lg:col-span-3 space-y-3">
        <p className="text-xs text-muted">A alteração vale para as próximas ocorrências. Títulos já gerados não mudam.</p>
        <FormMessage state={state} /><SubmitButton variant="secondary" pendingText="Salvando…">Salvar regra</SubmitButton>
      </div>
    </form>
  );
}

export function RuleOps({ id, active, ended }: { id: string; active: boolean; ended: boolean }) {
  const [state, action] = useFinAction(ruleOperation, { reset: false });
  if (ended) return <span className="text-sm text-muted">Encerrada</span>;
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={id} />
      {active ? <button name="op" value="pause" className="min-h-9 rounded-md border border-border px-3 text-sm hover:bg-black/5 dark:hover:bg-white/5">Pausar</button>
        : <button name="op" value="resume" className="min-h-9 rounded-md border border-border px-3 text-sm hover:bg-black/5 dark:hover:bg-white/5">Reativar</button>}
      <button name="op" value="end" className="min-h-9 rounded-md border border-danger px-3 text-sm text-danger hover:bg-black/5 dark:hover:bg-white/5">Encerrar</button>
      <FormMessage state={state} />
    </form>
  );
}

export function GenerateButton() {
  const router = useRouter();
  const [state, action, pending] = useActionState(async (): Promise<ActionState> => { const r = await generateNow(); if (r.ok) router.refresh(); return r; }, {} as ActionState);
  return (
    <form action={action} className="space-y-2">
      <button type="submit" disabled={pending} className="min-h-10 rounded-md border border-border px-4 text-sm font-medium hover:bg-black/5 disabled:opacity-60 dark:hover:bg-white/5">{pending ? 'Gerando…' : 'Gerar títulos previstos agora'}</button>
      <FormMessage state={state} />
    </form>
  );
}
