'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button } from '@/components/ui/primitives';
import { formatDateBR } from '@/lib/finance/dates';

type Item = { id: string; original_file_name: string; mime_type: string; size_bytes: number; created_at: string };
const kb = (n: number) => (n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Lista os anexos (abertura por link temporário) e, para quem pode, envia novos por /api/attachments. O servidor confere o tipo real. */
export function AttachmentPanel({ entityType, entityId, items, canUpload }: { entityType: 'entry' | 'settlement'; entityId: string; items: Item[]; canUpload: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const file = input.current?.files?.[0];
    if (!file) { setMsg({ ok: false, text: 'Selecione um arquivo.' }); return; }
    if (file.size > 10 * 1024 * 1024) { setMsg({ ok: false, text: 'O arquivo passa de 10 MB.' }); return; }
    setBusy(true); setMsg(null);
    const fd = new FormData();
    fd.set('entity_type', entityType); fd.set('entity_id', entityId); fd.set('file', file);
    try {
      const res = await fetch('/api/attachments', { method: 'POST', body: fd });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; message?: string } | null;
      setMsg({ ok: Boolean(body?.ok), text: body?.message ?? (res.ok ? 'Arquivo anexado.' : 'Não foi possível enviar.') });
      if (body?.ok) { if (input.current) input.current.value = ''; router.refresh(); }
    } catch {
      setMsg({ ok: false, text: 'Falha de conexão. Tente de novo.' });
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-3">
      {items.length ? (
        <ul className="divide-y divide-border rounded-lg border border-border bg-card text-sm">
          {items.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <span className="min-w-0 truncate">{a.original_file_name} <span className="text-xs text-muted">· {kb(a.size_bytes)} · {formatDateBR(a.created_at.slice(0, 10))}</span></span>
              <a className="underline underline-offset-2" href={`/api/attachments/${a.id}`} target="_blank" rel="noopener noreferrer">Abrir</a>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-muted">Nenhum anexo.</p>}
      {canUpload ? (
        <form onSubmit={send} className="flex flex-wrap items-end gap-2" noValidate>
          <div className="min-w-56 flex-1"><label htmlFor={`file-${entityId}`} className="mb-1 block text-xs font-medium text-muted">Anexar PDF, PNG ou JPG</label><input ref={input} id={`file-${entityId}`} type="file" accept="application/pdf,image/png,image/jpeg" className="min-h-10 w-full rounded-md border border-border bg-card px-3 py-1.5 text-sm" /></div>
          <Button type="submit" variant="secondary" disabled={busy}>{busy ? 'Enviando…' : 'Enviar'}</Button>
        </form>
      ) : null}
      {msg ? <Alert tone={msg.ok ? 'success' : 'error'}>{msg.text}</Alert> : null}
    </div>
  );
}
