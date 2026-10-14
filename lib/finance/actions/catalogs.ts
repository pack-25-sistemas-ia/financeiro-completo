'use server';

import { z } from 'zod';
import { fail, succeed, type ActionState } from '@/lib/actions/result';
import { bustFinance, dbMessage, formObject, guarded, parse } from '../action-kit';
import { categoryEditSchema, categorySchema, costCenterEditSchema, costCenterSchema, counterpartyEditSchema, counterpartySchema, uuid } from '../schemas';

// Cadastros simples: escrita direta pelo cliente do usuário (RLS + privilégios por coluna + MFA no banco decidem de novo).

export async function createCategory(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(categorySchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('manager', 'createCategory', async (ctx, org) => {
    const v = p.data;
    const { error } = await ctx.supabase.from('financial_categories').insert({ organization_id: org, name: v.name, nature: v.nature, parent_id: v.parent_id });
    if (error) return fail(dbMessage(error, 'Já existe uma categoria com este nome neste nível.'), undefined, raw);
    bustFinance(); bustCatalogs();
    return succeed('Categoria criada.');
  });
}

export async function updateCategory(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(categoryEditSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('manager', 'updateCategory', async (ctx, org) => {
    const v = p.data;
    const { error } = await ctx.supabase.from('financial_categories').update({ name: v.name, active: v.active }).eq('organization_id', org).eq('id', v.id);
    if (error) return fail(dbMessage(error, 'Já existe uma categoria com este nome neste nível.'), undefined, raw);
    bustCatalogs();
    return succeed(v.active ? 'Categoria atualizada.' : 'Categoria desativada (os lançamentos antigos continuam intactos).');
  });
}

export async function createCostCenter(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(costCenterSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('manager', 'createCostCenter', async (ctx, org) => {
    const v = p.data;
    const { error } = await ctx.supabase.from('cost_centers').insert({ organization_id: org, name: v.name, code: v.code, description: v.description });
    if (error) return fail(dbMessage(error, 'Já existe um centro de custo com este nome ou código.'), undefined, raw);
    bustCatalogs();
    return succeed('Centro de custo criado.');
  });
}

export async function updateCostCenter(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(costCenterEditSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('manager', 'updateCostCenter', async (ctx, org) => {
    const v = p.data;
    const { error } = await ctx.supabase.from('cost_centers').update({ name: v.name, code: v.code, description: v.description, active: v.active }).eq('organization_id', org).eq('id', v.id);
    if (error) return fail(dbMessage(error, 'Já existe um centro de custo com este nome ou código.'), undefined, raw);
    bustCatalogs();
    return succeed('Centro de custo atualizado.');
  });
}

export async function createCounterparty(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(counterpartySchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('analyst', 'createCounterparty', async (ctx, org) => {
    const v = p.data;
    const { error } = await ctx.supabase.from('counterparties').insert({ organization_id: org, kind: v.kind, name: v.name, legal_name: v.legal_name, document_number: v.document_number, email: v.email, phone: v.phone, notes: v.notes });
    if (error) return fail(dbMessage(error, 'Já existe um cadastro com este CPF/CNPJ.'), undefined, raw);
    bustCatalogs();
    return succeed('Cadastro criado.');
  });
}

export async function updateCounterparty(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(counterpartyEditSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('analyst', 'updateCounterparty', async (ctx, org) => {
    const v = p.data;
    const { error } = await ctx.supabase.from('counterparties').update({ kind: v.kind, name: v.name, legal_name: v.legal_name, document_number: v.document_number, email: v.email, phone: v.phone, notes: v.notes }).eq('organization_id', org).eq('id', v.id);
    if (error) return fail(dbMessage(error, 'Já existe um cadastro com este CPF/CNPJ.'), undefined, raw);
    bustCatalogs();
    return succeed('Cadastro atualizado.');
  });
}

export async function setCounterpartyArchived(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(z.object({ id: uuid, archive: z.enum(['1', '0']) }), raw);
  if (!p.ok) return p.state;
  return guarded('analyst', 'setCounterpartyArchived', async (ctx, org) => {
    const { error } = await ctx.supabase.from('counterparties').update({ archived_at: p.data.archive === '1' ? new Date().toISOString() : null }).eq('organization_id', org).eq('id', p.data.id);
    if (error) return fail(dbMessage(error));
    bustCatalogs();
    return succeed(p.data.archive === '1' ? 'Cadastro arquivado (o histórico é preservado).' : 'Cadastro reativado.');
  });
}

import { revalidatePath } from 'next/cache';
function bustCatalogs() {
  ['/categorias', '/centros-custo', '/clientes', '/fornecedores', '/pagar', '/receber', '/recorrencias', '/importacoes'].forEach((p) => revalidatePath(p, 'layout'));
}
