import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui/primitives';
import { DateBR, Section } from '@/components/finance/bits';
import { MarkReadButton, PrefToggle } from '@/components/finance/forms-settings';
import { loadNotifications, loadPrefs } from '@/lib/finance/data';
import { NOTIFICATION_LABELS, NOTIFICATION_TYPES } from '@/lib/finance/labels';
import { pageCtx } from '@/lib/finance/page';

export const metadata: Metadata = { title: 'Notificações' };

export default async function NotificacoesPage() {
  const p = await pageCtx();
  const [items, prefs] = await Promise.all([loadNotifications(p.ctx, { limit: 100 }), loadPrefs(p.ctx)]);
  const unread = items.filter((i) => !i.read_at).length;
  return (
    <>
      <PageHeader title="Notificações" description="Avisos internos gerados pelo sistema (vencimentos, atrasos, projeção, importações e estornos). Não dependem de e-mail e nunca trazem valores financeiros.">
        {unread > 0 ? <MarkReadButton label={`Marcar ${unread} como lida(s)`} /> : null}
      </PageHeader>
      {items.length === 0 ? <EmptyState title="Nenhuma notificação" description="Quando houver contas vencendo, atrasos ou eventos importantes, eles aparecem aqui." /> : (
        <ul className="space-y-2">
          {items.map((n) => (
            <li key={n.id} className={`rounded-lg border bg-card p-4 ${n.read_at ? 'border-border' : 'border-primary'}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium">{n.title} {n.read_at ? null : <Badge tone="warning">Nova</Badge>}</p>
                  <p className="mt-0.5 text-sm text-muted">{n.body}</p>
                  <p className="mt-1 text-xs text-muted"><DateBR value={n.created_at} /> · {NOTIFICATION_LABELS[n.type as keyof typeof NOTIFICATION_LABELS] ?? n.type}</p>
                </div>
                <div className="flex items-center gap-2">
                  {n.link ? <Link className="text-sm underline underline-offset-2" href={n.link}>Abrir</Link> : null}
                  {n.read_at ? null : <MarkReadButton id={n.id} label="Marcar como lida" />}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Section title="Preferências" description="Escolha quais avisos você quer receber. Avisos de estorno e saldo projetado só são enviados a gestão e administração.">
        <Card><div className="grid gap-2 sm:grid-cols-2">{NOTIFICATION_TYPES.map((t) => <PrefToggle key={t} type={t} label={NOTIFICATION_LABELS[t]} enabled={prefs.get(t) ?? true} />)}</div></Card>
      </Section>
    </>
  );
}
