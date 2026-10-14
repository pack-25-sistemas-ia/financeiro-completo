'use server';

import { z } from 'zod';
import { fail, succeed, type ActionState } from '@/lib/actions/result';
import { bustFinance, dbMessage, formObject, guarded, parse } from '../action-kit';
import { reasonSchema, reconcileSchema, uuid } from '../schemas';

export async function reconcileLine(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(reconcileSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('analyst', 'reconcileLine', async (ctx) => {
    const { error } = await ctx.supabase.rpc('fin_reconcile', { p_line: p.data.line_id, p_movement: p.data.movement_id, p_note: p.data.note });
    if (error) return fail(dbMessage(error), undefined, raw);
    bustFinance();
    return succeed('Conciliado.');
  });
}

export async function undoReconciliation(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(reasonSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('manager', 'undoReconciliation', async (ctx) => {
    const { error } = await ctx.supabase.rpc('fin_undo_reconciliation', { p_match: p.data.id, p_reason: p.data.reason });
    if (error) return fail(dbMessage(error), undefined, raw);
    bustFinance();
    return succeed('Conciliação desfeita e registrada no histórico.');
  });
}

export async function ignoreLine(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(reasonSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('analyst', 'ignoreLine', async (ctx) => {
    const { error } = await ctx.supabase.rpc('fin_ignore_statement_line', { p_line: p.data.id, p_reason: p.data.reason });
    if (error) return fail(dbMessage(error), undefined, raw);
    bustFinance();
    return succeed('Linha ignorada com justificativa.');
  });
}

export async function unignoreLine(_: ActionState, fd: FormData): Promise<ActionState> {
  const p = parse(z.object({ id: uuid }), formObject(fd));
  if (!p.ok) return p.state;
  return guarded('manager', 'unignoreLine', async (ctx) => {
    const { error } = await ctx.supabase.rpc('fin_unignore_statement_line', { p_line: p.data.id });
    if (error) return fail(dbMessage(error));
    bustFinance();
    return succeed('Linha reaberta.');
  });
}
