'use server';

import { fail, succeed, type ActionState } from '@/lib/actions/result';
import { bustFinance, dbMessage, formObject, guarded, parse } from '../action-kit';
import { accountSchema, accountUpdateSchema, adjustmentSchema, openingSchema, reasonSchema, transferSchema, uuid } from '../schemas';
import { instantOnDate } from '../dates';
import { loadSettings } from '../data';
import { z } from 'zod';

export async function createAccount(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(accountSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('manager', 'createAccount', async (ctx, org) => {
    const v = p.data;
    const { error } = await ctx.supabase.rpc('fin_create_account', {
      p_org: org, p_name: v.name, p_type: v.account_type, p_institution: v.institution, p_opening_cents: v.opening, p_opening_date: v.opening_date, p_include: v.include, p_allow_negative: v.allow_negative,
    });
    if (error) return fail(dbMessage(error, 'Já existe uma conta com este nome.'), undefined, raw);
    bustFinance();
    return succeed('Conta criada.');
  });
}

export async function updateAccount(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(accountUpdateSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('manager', 'updateAccount', async (ctx) => {
    const v = p.data;
    const { error } = await ctx.supabase.rpc('fin_update_account', { p_id: v.id, p_name: v.name, p_institution: v.institution, p_include: v.include, p_allow_negative: v.allow_negative });
    if (error) return fail(dbMessage(error, 'Já existe uma conta com este nome.'), undefined, raw);
    bustFinance();
    return succeed('Conta atualizada.');
  });
}

export async function archiveAccount(_: ActionState, fd: FormData): Promise<ActionState> {
  const p = parse(z.object({ id: uuid }), formObject(fd));
  if (!p.ok) return p.state;
  return guarded('manager', 'archiveAccount', async (ctx) => {
    const { error } = await ctx.supabase.rpc('fin_archive_account', { p_id: p.data.id });
    if (error) return fail(dbMessage(error));
    bustFinance();
    return succeed('Conta arquivada.');
  });
}

export async function unarchiveAccount(_: ActionState, fd: FormData): Promise<ActionState> {
  const p = parse(z.object({ id: uuid }), formObject(fd));
  if (!p.ok) return p.state;
  return guarded('manager', 'unarchiveAccount', async (ctx) => {
    const { error } = await ctx.supabase.rpc('fin_unarchive_account', { p_id: p.data.id });
    if (error) return fail(dbMessage(error));
    bustFinance();
    return succeed('Conta reativada.');
  });
}

export async function setOpeningBalance(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(openingSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('admin', 'setOpeningBalance', async (ctx) => {
    const v = p.data;
    const { error } = await ctx.supabase.rpc('fin_set_opening_balance', { p_id: v.id, p_cents: v.opening, p_date: v.opening_date, p_reason: v.reason });
    if (error) return fail(dbMessage(error), undefined, raw);
    bustFinance();
    return succeed('Saldo inicial corrigido e registrado no histórico.');
  });
}

export async function createTransfer(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(transferSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('manager', 'createTransfer', async (ctx, org) => {
    const v = p.data;
    const tz = (await loadSettings(ctx)).timezone;
    const { error } = await ctx.supabase.rpc('fin_create_transfer', {
      p_org: org, p_source: v.source_id, p_destination: v.destination_id, p_amount: v.amount, p_at: instantOnDate(v.on, tz), p_description: v.description, p_key: v.idem,
    });
    if (error) return fail(dbMessage(error), undefined, raw);
    bustFinance();
    return succeed('Transferência registrada.');
  });
}

export async function reverseTransfer(_: ActionState, fd: FormData): Promise<ActionState> {
  const p = parse(reasonSchema, formObject(fd));
  if (!p.ok) return p.state;
  return guarded('manager', 'reverseTransfer', async (ctx) => {
    const { error } = await ctx.supabase.rpc('fin_reverse_transfer', { p_id: p.data.id, p_reason: p.data.reason });
    if (error) return fail(dbMessage(error));
    bustFinance();
    return succeed('Transferência estornada.');
  });
}

export async function createAdjustment(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(adjustmentSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('manager', 'createAdjustment', async (ctx, org) => {
    const v = p.data;
    const tz = (await loadSettings(ctx)).timezone;
    const { error } = await ctx.supabase.rpc('fin_create_adjustment', { p_org: org, p_account: v.account_id, p_amount: v.amount, p_kind: v.kind, p_reason: v.reason, p_at: instantOnDate(v.on, tz), p_key: v.idem });
    if (error) return fail(dbMessage(error), undefined, raw);
    bustFinance();
    return succeed('Ajuste registrado.');
  });
}
