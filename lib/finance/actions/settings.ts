'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { fail, succeed, type ActionState } from '@/lib/actions/result';
import { bustFinance, dbMessage, formObject, guarded, parse } from '../action-kit';
import { goalSchema, prefSchema, settingsSchema, uuid } from '../schemas';

export async function updateFinSettings(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(settingsSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('admin', 'updateFinSettings', async (ctx, org) => {
    const v = p.data;
    const { error } = await ctx.supabase.from('fin_settings').update({
      timezone: v.timezone, alert_days_before: v.alert_days_before, proj_cons_delay_days: v.cons_delay, proj_cons_cut_bps: v.cons_cut, proj_opt_advance_days: v.opt_advance, proj_opt_gain_bps: v.opt_gain,
    }).eq('organization_id', org);
    if (error) return fail(dbMessage(error), undefined, raw);
    bustFinance(); revalidatePath('/configuracoes');
    return succeed('Configurações financeiras salvas. O histórico de lançamentos não é alterado.');
  });
}

export async function createGoal(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(goalSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('manager', 'createGoal', async (ctx, org) => {
    const v = p.data;
    const { error } = await ctx.supabase.from('financial_goals').insert({ organization_id: org, name: v.name, metric_type: v.metric_type, target_amount_cents: v.target, period_start: v.period_start, period_end: v.period_end, created_by: ctx.user.id });
    if (error) return fail(dbMessage(error), undefined, raw);
    bustFinance(); revalidatePath('/configuracoes');
    return succeed('Meta criada.');
  });
}

export async function deleteGoal(_: ActionState, fd: FormData): Promise<ActionState> {
  const p = parse(z.object({ id: uuid }), formObject(fd));
  if (!p.ok) return p.state;
  return guarded('manager', 'deleteGoal', async (ctx, org) => {
    const { error } = await ctx.supabase.from('financial_goals').delete().eq('organization_id', org).eq('id', p.data.id);
    if (error) return fail(dbMessage(error));
    bustFinance(); revalidatePath('/configuracoes');
    return succeed('Meta removida.');
  });
}

export async function setNotificationPref(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(prefSchema, raw);
  if (!p.ok) return p.state;
  return guarded('read', 'setNotificationPref', async (ctx, org) => {
    const { error } = await ctx.supabase.rpc('fin_set_notification_pref', { p_org: org, p_type: p.data.type, p_enabled: p.data.enabled });
    if (error) return fail(dbMessage(error));
    revalidatePath('/notificacoes'); revalidatePath('/configuracoes');
    return succeed('Preferência salva.');
  });
}

export async function markNotificationsRead(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const ids = raw.id ? [raw.id] : null;
  if (ids && !uuid.safeParse(ids[0]).success) return fail('Notificação inválida.');
  return guarded('read', 'markNotificationsRead', async (ctx, org) => {
    const { error } = await ctx.supabase.rpc('fin_mark_notifications_read', { p_org: org, p_ids: ids });
    if (error) return fail(dbMessage(error));
    revalidatePath('/notificacoes', 'layout'); revalidatePath('/dashboard');
    return succeed('Marcada como lida.');
  });
}
