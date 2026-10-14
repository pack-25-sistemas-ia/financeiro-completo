import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Alert, Badge, Card, PageHeader } from '@/components/ui/primitives';
import { DateBR, Money, Section } from '@/components/finance/bits';
import { DeleteGoalButton, FinSettingsForm, GoalForm } from '@/components/finance/forms-settings';
import { loadGoals } from '@/lib/finance/data';
import { GOAL_LABELS } from '@/lib/finance/labels';
import { pageCtx } from '@/lib/finance/page';

export const metadata: Metadata = { title: 'Configurações financeiras' };

export default async function ConfiguracoesPage() {
  const p = await pageCtx();
  if (!p.perms.admin) notFound();
  const goals = await loadGoals(p.ctx);
  return (
    <>
      <PageHeader title="Configurações financeiras" description="Parâmetros do negócio. Alterá-los não reescreve o histórico: lançamentos, baixas e movimentos permanecem como estão." />
      <Card title="Fuso, alertas e projeção"><FinSettingsForm s={p.settings} /></Card>
      <Section title="Metas gerenciais" description="Acompanhadas no painel com os valores reais do período (caixa).">
        {goals.length ? (
          <ul className="mb-4 space-y-2">
            {goals.map((g) => (
              <li key={g.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card p-3 text-sm">
                <span><strong>{g.name}</strong> <Badge>{GOAL_LABELS[g.metric_type as keyof typeof GOAL_LABELS] ?? g.metric_type}</Badge> · <Money cents={g.target_amount_cents} /> · <DateBR value={g.period_start} /> a <DateBR value={g.period_end} /></span>
                <DeleteGoalButton id={g.id} />
              </li>
            ))}
          </ul>
        ) : <p className="mb-4 text-sm text-muted">Nenhuma meta cadastrada.</p>}
        <Card title="Nova meta"><GoalForm today={p.today} /></Card>
      </Section>
      <Section title="Identidade, equipe e privacidade">
        <Alert tone="info">Nome e cor da organização: <Link className="underline" href="/settings">Configurações da organização</Link>. Convidar ou alterar papéis: <Link className="underline" href="/members">Equipe</Link>. Solicitações de titulares (LGPD): <Link className="underline" href="/privacy">Privacidade</Link>. Categorias, centros de custo e contas têm tela própria no menu.</Alert>
      </Section>
    </>
  );
}
