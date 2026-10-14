'use client';

import { FormMessage, SubmitButton } from '@/components/ui/client';
import { Input } from '@/components/ui/primitives';
import { ignoreLine, reconcileLine, unignoreLine } from '@/lib/finance/actions/recon';
import { formatBRL } from '@/lib/finance/money';
import { formatDateBR } from '@/lib/finance/dates';
import { useFinAction } from './use-fin-action';

export type Candidate = { movementId: string; label: string; cents: number; date: string; score?: number; ambiguous?: boolean; reasons?: string[] };

/** Conciliar uma linha do extrato com um movimento. Sugestões ambíguas exigem escolha explícita; diferença de valor exige justificativa. */
export function ReconcileForm({ lineId, lineCents, candidates }: { lineId: string; lineCents: number; candidates: Candidate[] }) {
  const [state, action, ref] = useFinAction(reconcileLine);
  if (!candidates.length) return <p className="text-xs text-muted">Nenhum movimento candidato no período. Registre o movimento (baixa, transferência ou ajuste) ou ignore a linha.</p>;
  const anyDiff = candidates.some((c) => c.cents !== lineCents);
  return (
    <form ref={ref} action={action} className="space-y-2" noValidate>
      <input type="hidden" name="line_id" value={lineId} />
      <fieldset className="space-y-1">
        <legend className="sr-only">Movimento a conciliar</legend>
        {candidates.map((c) => (
          <label key={c.movementId} className="flex cursor-pointer items-start gap-2 rounded-md border border-border p-2 text-sm hover:bg-black/5 dark:hover:bg-white/5">
            <input type="radio" name="movement_id" value={c.movementId} required className="mt-1" />
            <span className="min-w-0">
              <span className="block truncate font-medium">{c.label}</span>
              <span className="block text-xs text-muted">{formatDateBR(c.date)} · {formatBRL(c.cents)}{c.cents !== lineCents ? ` (diferença ${formatBRL(lineCents - c.cents)})` : ''}{c.ambiguous ? ' · ⚠ ambígua: confira antes' : ''}{c.reasons?.length ? ` · ${c.reasons.join(', ')}` : ''}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {anyDiff ? <div><label htmlFor={`note-${lineId}`} className="mb-1 block text-xs font-medium">Justificativa (obrigatória se o valor for diferente)</label><Input id={`note-${lineId}`} name="note" maxLength={300} /></div> : null}
      <FormMessage state={state} />
      <SubmitButton pendingText="Conciliando…">Conciliar selecionado</SubmitButton>
    </form>
  );
}

export function ReasonInline({ action: serverAction, id, label, placeholder, variant = 'secondary' }: { action: typeof ignoreLine; id: string; label: string; placeholder: string; variant?: 'danger' | 'secondary' }) {
  const [state, action, ref] = useFinAction(serverAction);
  return (
    <form ref={ref} action={action} className="space-y-2" noValidate>
      <input type="hidden" name="id" value={id} />
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-52 flex-1"><label htmlFor={`ri-${id}`} className="sr-only">{placeholder}</label><Input id={`ri-${id}`} name="reason" required minLength={5} maxLength={300} placeholder={placeholder} defaultValue={state.values?.reason} /></div>
        <SubmitButton variant={variant} pendingText="…">{label}</SubmitButton>
      </div>
      <FormMessage state={state} />
    </form>
  );
}

export function UnignoreForm({ id }: { id: string }) {
  const [state, action] = useFinAction(unignoreLine, { reset: false });
  return (<form action={action} className="space-y-1"><input type="hidden" name="id" value={id} /><SubmitButton variant="secondary" pendingText="…">Reabrir linha</SubmitButton><FormMessage state={state} /></form>);
}
