'use server';

import { z } from 'zod';
import { fail, succeed, type ActionState } from '@/lib/actions/result';
import { bustFinance, dbMessage, formObject, guarded, parse } from '../action-kit';
import { ruleEditSchema, ruleSchema, uuid } from '../schemas';

export async function createRule(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(ruleSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('analyst', 'createRule', async (ctx, org) => {
    const v = p.data;
    const { error } = await ctx.supabase.rpc('fin_create_recurring_rule', {
      p_org: org, p_type: v.entry_type, p_description: v.description, p_counterparty: v.counterparty_id, p_category: v.category_id, p_expected_account: v.expected_account_id, p_amount: v.amount,
      p_frequency: v.frequency, p_interval: v.interval, p_starts_on: v.starts_on, p_ends_on: v.ends_on, p_lead_days: v.lead_days, p_notes: v.notes,
    });
    if (error) return fail(dbMessage(error), undefined, raw);
    bustFinance();
    return succeed('Regra criada. Os títulos previstos são gerados conforme a antecedência definida.');
  });
}

export async function updateRule(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(ruleEditSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('analyst', 'updateRule', async (ctx) => {
    const v = p.data;
    const { error } = await ctx.supabase.rpc('fin_update_recurring_rule', {
      p_id: v.id, p_description: v.description, p_counterparty: v.counterparty_id, p_category: v.category_id, p_expected_account: v.expected_account_id, p_amount: v.amount, p_ends_on: v.ends_on, p_lead_days: v.lead_days, p_notes: v.notes,
    });
    if (error) return fail(dbMessage(error), undefined, raw);
    bustFinance();
    return succeed('Regra atualizada. A mudança vale para as próximas ocorrências.');
  });
}

const op = z.object({ id: uuid, op: z.enum(['pause', 'resume', 'end']) });
export async function ruleOperation(_: ActionState, fd: FormData): Promise<ActionState> {
  const p = parse(op, formObject(fd));
  if (!p.ok) return p.state;
  return guarded('analyst', 'ruleOperation', async (ctx) => {
    const fn = p.data.op === 'pause' ? 'fin_pause_recurring_rule' : p.data.op === 'resume' ? 'fin_resume_recurring_rule' : 'fin_end_recurring_rule';
    const { data, error } = await ctx.supabase.rpc(fn, { p_id: p.data.id });
    if (error) return fail(dbMessage(error));
    bustFinance();
    if (p.data.op === 'resume' && typeof data === 'number' && data > 0) return succeed(`Regra reativada. ${data} ocorrência(s) vencida(s) durante a pausa foram registradas como puladas.`);
    return succeed(p.data.op === 'pause' ? 'Regra pausada.' : p.data.op === 'resume' ? 'Regra reativada.' : 'Regra encerrada.');
  });
}

export async function generateNow(): Promise<ActionState> {
  return guarded('analyst', 'generateNow', async (ctx, org) => {
    const { data, error } = await ctx.supabase.rpc('fin_run_routines', { p_org: org });
    if (error) return fail(dbMessage(error));
    bustFinance();
    const n = (data as { recurring_generated?: number } | null)?.recurring_generated ?? 0;
    return succeed(n > 0 ? `${n} título(s) previsto(s) gerado(s).` : 'Nada novo para gerar agora.');
  });
}
