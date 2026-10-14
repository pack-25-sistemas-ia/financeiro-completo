'use server';

import { fail, succeed, type ActionState } from '@/lib/actions/result';
import { z } from 'zod';
import { bustFinance, dbMessage, formObject, guarded, parse, type SaveResult } from '../action-kit';
import { instantOnDate } from '../dates';
import { loadSettings } from '../data';
import { allocationRow, entryEditSchema, entrySchema, reasonSchema, replanSchema, rescheduleSchema, settleSchema, uuid } from '../schemas';

/** Rateio vem do formulário como campos «cc:<uuid>» = peso. Só pesos positivos entram. */
function allocationsFrom(raw: Record<string, string>) {
  const rows: Array<{ cost_center_id: string; weight: number }> = [];
  for (const [k, v] of Object.entries(raw)) {
    if (!k.startsWith('cc:') || v.trim() === '') continue;
    const r = allocationRow.safeParse({ cost_center_id: k.slice(3), weight: v });
    if (r.success) rows.push(r.data);
  }
  return rows;
}

export async function createEntry(_: ActionState, fd: FormData): Promise<SaveResult> {
  const raw = formObject(fd);
  const p = parse(entrySchema, raw, raw);
  if (!p.ok) return p.state;
  const rows = allocationsFrom(raw);
  return guarded('analyst', 'createEntry', async (ctx, org) => {
    const v = p.data;
    const { data, error } = await ctx.supabase.rpc('fin_create_entry', {
      p_org: org, p_type: v.entry_type, p_description: v.description, p_counterparty: v.counterparty_id, p_category: v.category_id, p_expected_account: v.expected_account_id, p_amount: v.amount,
      p_issue: v.issue_date, p_competence: v.competence_date, p_first_due: v.first_due, p_installments: v.installments, p_frequency: v.frequency, p_notes: v.notes, p_idempotency_key: v.idem,
      p_allocations: rows.length ? rows : null, p_custom_dues: null,
    });
    if (error) return fail(dbMessage(error), undefined, raw);
    bustFinance();
    const id = data as string;
    return { ...succeed('Título criado.'), id, redirectTo: `/${v.entry_type === 'payable' ? 'pagar' : 'receber'}/${id}` };
  });
}

export async function updateEntry(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(entryEditSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('analyst', 'updateEntry', async (ctx) => {
    const v = p.data;
    const { error } = await ctx.supabase.rpc('fin_update_entry', {
      p_id: v.id, p_description: v.description, p_counterparty: v.counterparty_id, p_category: v.category_id, p_expected_account: v.expected_account_id, p_competence: v.competence_date, p_notes: v.notes,
    });
    if (error) return fail(dbMessage(error), undefined, raw);
    bustFinance();
    return succeed('Título atualizado.');
  });
}

export async function setAllocations(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(z.object({ id: uuid }), raw);
  if (!p.ok) return p.state;
  const rows = allocationsFrom(raw);
  return guarded('analyst', 'setAllocations', async (ctx) => {
    const { error } = await ctx.supabase.rpc('fin_set_allocations', { p_entry: p.data.id, p_allocations: rows.length ? rows : null });
    if (error) return fail(dbMessage(error), undefined, raw);
    bustFinance();
    return succeed(rows.length ? 'Rateio salvo: os valores fecham exatamente com o título.' : 'Rateio removido.');
  });
}

export async function rescheduleInstallment(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(rescheduleSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('analyst', 'rescheduleInstallment', async (ctx) => {
    const { error } = await ctx.supabase.rpc('fin_reschedule_installment', { p_installment: p.data.installment_id, p_due: p.data.due });
    if (error) return fail(dbMessage(error), undefined, raw);
    bustFinance();
    return succeed('Vencimento alterado.');
  });
}

export async function replanEntry(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(replanSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('manager', 'replanEntry', async (ctx) => {
    const v = p.data;
    const { error } = await ctx.supabase.rpc('fin_replan_entry', { p_id: v.id, p_amount: v.amount, p_installments: v.installments, p_first_due: v.first_due, p_frequency: v.frequency, p_custom_dues: null });
    if (error) return fail(dbMessage(error), undefined, raw);
    bustFinance();
    return succeed('Plano de parcelas refeito.');
  });
}

export async function cancelEntry(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(reasonSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('manager', 'cancelEntry', async (ctx) => {
    const { error } = await ctx.supabase.rpc('fin_cancel_entry', { p_id: p.data.id, p_reason: p.data.reason });
    if (error) return fail(dbMessage(error), undefined, raw);
    bustFinance();
    return succeed('Título cancelado.');
  });
}

export async function archiveEntry(_: ActionState, fd: FormData): Promise<ActionState> {
  const p = parse(z.object({ id: uuid }), formObject(fd));
  if (!p.ok) return p.state;
  return guarded('manager', 'archiveEntry', async (ctx) => {
    const { error } = await ctx.supabase.rpc('fin_archive_entry', { p_id: p.data.id });
    if (error) return fail(dbMessage(error));
    bustFinance();
    return succeed('Título arquivado.');
  });
}

export async function settleInstallment(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(settleSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('manager', 'settleInstallment', async (ctx) => {
    const v = p.data;
    const tz = (await loadSettings(ctx)).timezone;
    const { error } = await ctx.supabase.rpc('fin_settle_installment', {
      p_installment: v.installment_id, p_account: v.account_id, p_amount: v.amount, p_settled_at: instantOnDate(v.settled_on, tz), p_method: v.method, p_reference: v.reference, p_key: v.idem,
    });
    if (error) return fail(dbMessage(error), undefined, raw);
    bustFinance();
    return succeed('Baixa registrada.');
  });
}

export async function reverseSettlement(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(reasonSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('manager', 'reverseSettlement', async (ctx) => {
    const { error } = await ctx.supabase.rpc('fin_reverse_settlement', { p_id: p.data.id, p_reason: p.data.reason });
    if (error) return fail(dbMessage(error), undefined, raw);
    bustFinance();
    return succeed('Baixa estornada.');
  });
}
