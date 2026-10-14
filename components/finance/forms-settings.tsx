'use client';

import { useId } from 'react';
import { FormMessage, SubmitButton } from '@/components/ui/client';
import { Field, Input, Select } from '@/components/ui/primitives';
import { createGoal, deleteGoal, markNotificationsRead, setNotificationPref, updateFinSettings } from '@/lib/finance/actions/settings';
import { GOAL_LABELS, GOAL_METRICS } from '@/lib/finance/labels';
import type { FinSettings } from '@/lib/finance/data';
import { useFinAction } from './use-fin-action';

const pct = (bps: number) => (bps / 100).toFixed(2).replace('.', ',');

export function FinSettingsForm({ s }: { s: FinSettings }) {
  const p = useId();
  const [state, action] = useFinAction(updateFinSettings, { reset: false });
  const e = state.fieldErrors ?? {};
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" noValidate>
      <Field label="Fuso horário" name={`${p}timezone`} errors={e.timezone} hint="Define o «hoje» dos vencimentos e alertas."><Input id={`${p}timezone`} name="timezone" required defaultValue={s.timezone} /></Field>
      <Field label="Antecedência dos alertas (dias)" name={`${p}alert_days_before`} errors={e.alert_days_before}><Input id={`${p}alert_days_before`} name="alert_days_before" type="number" min={0} max={60} required defaultValue={s.alert_days_before} /></Field>
      <div className="hidden lg:block" />
      <fieldset className="sm:col-span-2 lg:col-span-3 rounded-md border border-border p-3">
        <legend className="px-1 text-sm font-medium">Cenários da projeção (hipóteses, não previsão estatística)</legend>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Conservador: atraso dos recebimentos (dias)" name={`${p}cons_delay`} errors={e.cons_delay}><Input id={`${p}cons_delay`} name="cons_delay" type="number" min={0} max={120} required defaultValue={s.proj_cons_delay_days} /></Field>
          <Field label="Conservador: redução dos recebimentos (%)" name={`${p}cons_cut`} errors={e.cons_cut}><Input id={`${p}cons_cut`} name="cons_cut" inputMode="decimal" required defaultValue={pct(s.proj_cons_cut_bps)} /></Field>
          <Field label="Otimista: antecipação dos recebimentos (dias)" name={`${p}opt_advance`} errors={e.opt_advance}><Input id={`${p}opt_advance`} name="opt_advance" type="number" min={0} max={120} required defaultValue={s.proj_opt_advance_days} /></Field>
          <Field label="Otimista: aumento dos recebimentos (%)" name={`${p}opt_gain`} errors={e.opt_gain}><Input id={`${p}opt_gain`} name="opt_gain" inputMode="decimal" required defaultValue={pct(s.proj_opt_gain_bps)} /></Field>
        </div>
      </fieldset>
      <div className="sm:col-span-2 lg:col-span-3 space-y-3"><FormMessage state={state} /><SubmitButton pendingText="Salvando…">Salvar configurações financeiras</SubmitButton></div>
    </form>
  );
}

export function GoalForm({ today }: { today: string }) {
  const p = useId();
  const [state, action, ref] = useFinAction(createGoal);
  const e = state.fieldErrors ?? {};
  return (
    <form ref={ref} action={action} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5" noValidate>
      <Field label="Nome" name={`${p}name`} errors={e.name}><Input id={`${p}name`} name="name" required maxLength={80} defaultValue={state.values?.name} /></Field>
      <Field label="Indicador" name={`${p}metric_type`}><Select id={`${p}metric_type`} name="metric_type" defaultValue={state.values?.metric_type ?? 'income'}>{GOAL_METRICS.map((m) => <option key={m} value={m}>{GOAL_LABELS[m]}</option>)}</Select></Field>
      <Field label="Meta (R$)" name={`${p}target`} errors={e.target}><Input id={`${p}target`} name="target" inputMode="decimal" required defaultValue={state.values?.target} /></Field>
      <Field label="Início" name={`${p}period_start`} errors={e.period_start}><Input id={`${p}period_start`} name="period_start" type="date" required defaultValue={state.values?.period_start ?? today} /></Field>
      <Field label="Fim" name={`${p}period_end`} errors={e.period_end}><Input id={`${p}period_end`} name="period_end" type="date" required defaultValue={state.values?.period_end ?? today} /></Field>
      <div className="sm:col-span-2 lg:col-span-5 space-y-3"><FormMessage state={state} /><SubmitButton pendingText="Criando…">Criar meta</SubmitButton></div>
    </form>
  );
}

export function DeleteGoalButton({ id }: { id: string }) {
  const [state, action] = useFinAction(deleteGoal, { reset: false });
  return (<form action={action} className="space-y-1"><input type="hidden" name="id" value={id} /><SubmitButton variant="secondary" pendingText="…">Remover</SubmitButton><FormMessage state={state} /></form>);
}

export function PrefToggle({ type, label, enabled }: { type: string; label: string; enabled: boolean }) {
  const [state, action] = useFinAction(setNotificationPref, { reset: false });
  return (
    <form action={action} className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
      <input type="hidden" name="type" value={type} />
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="enabled" defaultChecked={enabled} /> {label}</label>
      <SubmitButton variant="secondary" pendingText="…">Salvar</SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}

export function MarkReadButton({ id, label }: { id?: string; label: string }) {
  const [state, action] = useFinAction(markNotificationsRead, { reset: false });
  return (
    <form action={action} className="inline-flex flex-col gap-1">
      {id ? <input type="hidden" name="id" value={id} /> : null}
      <SubmitButton variant="secondary" pendingText="…">{label}</SubmitButton>
      {state.ok === false ? <FormMessage state={state} /> : null}
    </form>
  );
}
