'use client';

import { useState } from 'react';
import { Button, Input, Select } from '@/components/ui/primitives';
import { PERIODS, PERIOD_LABELS, type Filters, type Period } from '@/lib/finance/filters';
import type { Opt } from './forms-accounts';

/** Filtros do painel e dos relatórios. GET: a URL é compartilhável e funciona sem JavaScript. */
export function FilterBar({ action, filters, accounts, categories, costCenters, counterparties, extra }: {
  action: string; filters: Filters; accounts?: Opt[]; categories?: Opt[]; costCenters?: Opt[]; counterparties?: Opt[]; extra?: Record<string, string>;
}) {
  const [period, setPeriod] = useState<Period>(filters.period);
  const sel = (id: string, label: string, value: string | null, options: Opt[], all: string, width = 'w-44') => (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-muted">{label}</label>
      <Select id={id} name={id} defaultValue={value ?? ''} className={width}><option value="">{all}</option>{options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
    </div>
  );
  return (
    <form action={action} method="get" className="mb-6 flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-3" aria-label="Filtros">
      {extra ? Object.entries(extra).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />) : null}
      <div>
        <label htmlFor="period" className="mb-1 block text-xs font-medium text-muted">Período</label>
        <Select id="period" name="period" value={period} onChange={(e) => setPeriod(e.target.value as Period)} className="w-48">{PERIODS.map((p) => <option key={p} value={p}>{PERIOD_LABELS[p]}</option>)}</Select>
      </div>
      {period === 'custom' ? (
        <>
          <div><label htmlFor="from" className="mb-1 block text-xs font-medium text-muted">De</label><Input id="from" name="from" type="date" defaultValue={filters.from} required /></div>
          <div><label htmlFor="to" className="mb-1 block text-xs font-medium text-muted">Até</label><Input id="to" name="to" type="date" defaultValue={filters.to} required /></div>
        </>
      ) : null}
      {accounts ? sel('account', 'Conta', filters.account, accounts, 'Todas (consolidado)') : null}
      {categories ? sel('category', 'Categoria', filters.category, categories, 'Todas', 'w-48') : null}
      {costCenters ? sel('cc', 'Centro de custo', filters.costCenter, costCenters, 'Todos') : null}
      {counterparties ? sel('party', 'Cliente/Fornecedor', filters.counterparty, counterparties, 'Todos', 'w-48') : null}
      <Button type="submit">Aplicar</Button>
    </form>
  );
}

/** Filtros simples de listagem (busca + selects) por GET. */
export function ListFilters({ action, fields, values, hidden }: { action: string; hidden?: Record<string, string>; fields: Array<{ name: string; label: string; options?: Opt[]; type?: 'text' | 'date'; all?: string; width?: string }>; values: Record<string, string | null | undefined> }) {
  return (
    <form action={action} method="get" className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-3" aria-label="Filtros da lista">
      {hidden ? Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />) : null}
      {fields.map((f) => (
        <div key={f.name}>
          <label htmlFor={f.name} className="mb-1 block text-xs font-medium text-muted">{f.label}</label>
          {f.options ? (
            <Select id={f.name} name={f.name} defaultValue={values[f.name] ?? ''} className={f.width ?? 'w-44'}><option value="">{f.all ?? 'Todos'}</option>{f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
          ) : (
            <Input id={f.name} name={f.name} type={f.type ?? 'text'} defaultValue={values[f.name] ?? ''} className={f.width ?? 'w-48'} />
          )}
        </div>
      ))}
      <Button type="submit">Filtrar</Button>
      <a href={action} className="inline-flex min-h-10 items-center px-2 text-sm text-muted underline underline-offset-2">Limpar</a>
    </form>
  );
}
