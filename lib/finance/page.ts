import 'server-only';
import { requireContext } from '@/lib/auth/session';
import { loadAccounts, loadCategories, loadCostCenters, loadCounterparties, loadSettings, type AccountRow, type CategoryRow, type CostCenterRow, type CounterpartyRow } from './data';
import { todayIn } from './dates';
import { can } from './labels';

/** Contexto comum das páginas: sessão (já com MFA/papel), fuso da organização, «hoje» e permissões para mostrar/ocultar botões (o banco decide de verdade). */
export async function pageCtx() {
  const ctx = await requireContext();
  const settings = await loadSettings(ctx);
  return { ctx, settings, tz: settings.timezone, today: todayIn(settings.timezone), perms: can(ctx.membership.role), org: ctx.membership.organization_id, role: ctx.membership.role };
}
export type PageCtx = Awaited<ReturnType<typeof pageCtx>>;

export type Refs = {
  accounts: AccountRow[]; categories: CategoryRow[]; costCenters: CostCenterRow[]; counterparties: CounterpartyRow[];
};

export async function loadRefs(ctx: PageCtx['ctx'], opts: { allAccounts?: boolean } = {}): Promise<Refs> {
  const [accounts, categories, costCenters, cps] = await Promise.all([
    loadAccounts(ctx, { includeArchived: opts.allAccounts }), loadCategories(ctx), loadCostCenters(ctx), loadCounterparties(ctx, { limit: 1000 }),
  ]);
  return { accounts, categories, costCenters, counterparties: cps.rows };
}

/** «Pai › Filho» para listas de seleção. */
export function categoryLabel(cats: CategoryRow[], c: CategoryRow): string {
  const byId = new Map(cats.map((x) => [x.id, x]));
  const parts = [c.name];
  let cur = c.parent_id ? byId.get(c.parent_id) : undefined;
  let guard = 0;
  while (cur && guard++ < 4) { parts.unshift(cur.name); cur = cur.parent_id ? byId.get(cur.parent_id) : undefined; }
  return parts.join(' › ');
}

export const accountOpts = (accounts: AccountRow[]) => accounts.filter((a) => a.active).map((a) => ({ value: a.account_id, label: a.name }));
export const categoryOpts = (cats: CategoryRow[], nature?: 'income' | 'expense') =>
  cats.filter((c) => c.active && (!nature || c.nature === nature)).map((c) => ({ value: c.id, label: categoryLabel(cats, c) })).sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
export const counterpartyOpts = (cps: CounterpartyRow[], kind?: 'customer' | 'supplier') =>
  cps.filter((c) => !c.archived_at && (!kind || c.kind === kind || c.kind === 'both')).map((c) => ({ value: c.id, label: c.name }));
export const costCenterOpts = (ccs: CostCenterRow[]) => ccs.filter((c) => c.active).map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` }));
