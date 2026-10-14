'use client';

import Link from 'next/link';
import { useState } from 'react';
import { flexRender, getCoreRowModel, getSortedRowModel, useReactTable, type ColumnDef, type SortingState, type VisibilityState } from '@tanstack/react-table';
import { Badge } from '@/components/ui/primitives';
import type { InstallmentRow, MovementRow } from '@/lib/finance/data';
import { MOVEMENT_LABELS, type EntryType } from '@/lib/finance/labels';
import { cn } from '@/lib/utils';
import { DateBR, Money, StatusBadge } from './bits';

function DataTable<T>({ data, columns, caption, empty, initialSort = [], hideable = true }: { data: T[]; columns: ColumnDef<T>[]; caption: string; empty: string; initialSort?: SortingState; hideable?: boolean }) {
  const [sorting, setSorting] = useState<SortingState>(initialSort);
  const [visibility, setVisibility] = useState<VisibilityState>({});
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Table é a biblioteca de tabelas do projeto; o React Compiler apenas deixa de memoizar este componente
  const table = useReactTable({ data, columns, state: { sorting, columnVisibility: visibility }, onSortingChange: setSorting, onColumnVisibilityChange: setVisibility, getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel() });
  if (data.length === 0) return <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted">{empty}</p>;
  return (
    <div>
      {hideable ? (
        <details className="mb-2 text-sm">
          <summary className="cursor-pointer text-muted">Colunas</summary>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 rounded-md border border-border p-2">
            {table.getAllLeafColumns().filter((c) => c.getCanHide()).map((c) => (
              <label key={c.id} className="flex items-center gap-1.5"><input type="checkbox" checked={c.getIsVisible()} onChange={c.getToggleVisibilityHandler()} /> {typeof c.columnDef.header === 'string' ? c.columnDef.header : c.id}</label>
            ))}
          </div>
        </details>
      ) : null}
      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="border-b border-border">
                {hg.headers.map((h) => {
                  const sorted = h.column.getIsSorted();
                  return (
                    <th key={h.id} scope="col" aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : 'none'} className="whitespace-nowrap px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted">
                      {h.column.getCanSort() ? (
                        <button type="button" onClick={h.column.getToggleSortingHandler()} className="inline-flex items-center gap-1 hover:text-foreground">
                          {flexRender(h.column.columnDef.header, h.getContext())}<span aria-hidden>{sorted === 'asc' ? '▲' : sorted === 'desc' ? '▼' : ''}</span>
                        </button>
                      ) : flexRender(h.column.columnDef.header, h.getContext())}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((r) => (
              <tr key={r.id} className="border-b border-border last:border-0 hover:bg-black/[0.03] dark:hover:bg-white/[0.03]">
                {r.getVisibleCells().map((c) => <td key={c.id} className="px-3 py-2 align-top">{flexRender(c.column.columnDef.cell, c.getContext())}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-xs text-muted">A ordenação por coluna vale para esta página; use os filtros para refinar todo o conjunto.</p>
    </div>
  );
}

export function InstallmentsTable({ rows, type }: { rows: InstallmentRow[]; type: EntryType }) {
  const base = type === 'payable' ? '/pagar' : '/receber';
  const columns: ColumnDef<InstallmentRow>[] = [
    { id: 'due', header: 'Vencimento', accessorKey: 'due_date', cell: ({ row }) => <span className={cn(row.original.is_overdue && 'font-medium text-danger')}><DateBR value={row.original.due_date} /></span> },
    { id: 'desc', header: 'Descrição', accessorKey: 'description', cell: ({ row }) => (
      <Link href={`${base}/${row.original.entry_id}`} className="font-medium underline-offset-2 hover:underline">{row.original.description}</Link>
    ) },
    { id: 'part', header: 'Parcela', accessorFn: (r) => r.installment_number, cell: ({ row }) => <span className="tabular-nums">{row.original.installment_number}/{row.original.total_installments}</span> },
    { id: 'party', header: type === 'payable' ? 'Fornecedor' : 'Cliente', accessorFn: (r) => r.counterparty_name ?? '', cell: ({ row }) => row.original.counterparty_name ?? <span className="text-muted">—</span> },
    { id: 'cat', header: 'Categoria', accessorFn: (r) => r.category_name ?? '', cell: ({ row }) => row.original.category_name ?? <span className="text-muted">—</span> },
    { id: 'amount', header: 'Valor', accessorKey: 'amount_cents', cell: ({ row }) => <Money cents={row.original.amount_cents} /> },
    { id: 'pending', header: 'Pendente', accessorKey: 'pending_cents', cell: ({ row }) => <Money cents={row.original.pending_cents} /> },
    { id: 'status', header: 'Situação', accessorKey: 'status', cell: ({ row }) => <StatusBadge type={type} status={row.original.status} overdue={row.original.is_overdue} /> },
    { id: 'open', header: 'Ação', enableSorting: false, enableHiding: false, cell: ({ row }) => <Link href={`${base}/${row.original.entry_id}`} className="text-sm underline underline-offset-2">Abrir</Link> },
  ];
  return <DataTable data={rows} columns={columns} caption={type === 'payable' ? 'Contas a pagar' : 'Contas a receber'} empty="Nenhuma parcela encontrada com estes filtros." initialSort={[]} />;
}

export function MovementsTable({ rows }: { rows: MovementRow[] }) {
  const columns: ColumnDef<MovementRow>[] = [
    { id: 'date', header: 'Data', accessorKey: 'effective_at', cell: ({ row }) => <DateBR value={row.original.effective_at} /> },
    { id: 'account', header: 'Conta', accessorKey: 'account_name' },
    { id: 'type', header: 'Tipo', accessorFn: (r) => MOVEMENT_LABELS[r.movement_type] ?? r.movement_type, cell: ({ row }) => (
      <span className="inline-flex flex-wrap items-center gap-1">{MOVEMENT_LABELS[row.original.movement_type] ?? row.original.movement_type}{row.original.is_reversed ? <Badge tone="warning">Estornado</Badge> : null}</span>
    ) },
    { id: 'desc', header: 'Descrição', accessorFn: (r) => r.entry_description ?? r.description ?? '', cell: ({ row }) => {
      const r = row.original;
      const text = r.entry_description ?? r.description ?? '—';
      return r.entry_id ? <Link className="underline-offset-2 hover:underline" href={`/${r.entry_type === 'payable' ? 'pagar' : 'receber'}/${r.entry_id}`}>{text}{r.total_installments && r.total_installments > 1 ? ` (${r.installment_number}/${r.total_installments})` : ''}</Link> : <>{text}</>;
    } },
    { id: 'party', header: 'Contraparte', accessorFn: (r) => r.counterparty_name ?? '', cell: ({ row }) => row.original.counterparty_name ?? <span className="text-muted">—</span> },
    { id: 'cat', header: 'Categoria', accessorFn: (r) => r.category_name ?? '', cell: ({ row }) => row.original.category_name ?? <span className="text-muted">—</span> },
    { id: 'amount', header: 'Valor', accessorKey: 'amount_cents', cell: ({ row }) => <Money cents={row.original.amount_cents} signed /> },
    { id: 'recon', header: 'Conciliação', accessorFn: (r) => (r.reconciliation_match_id ? 1 : 0), cell: ({ row }) => (row.original.reconciliation_match_id ? <Badge tone="success">Conciliado</Badge> : <span className="text-muted">Pendente</span>) },
  ];
  return <DataTable data={rows} columns={columns} caption="Movimentações das contas" empty="Nenhuma movimentação encontrada com estes filtros." />;
}
