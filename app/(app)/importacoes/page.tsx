import type { Metadata } from 'next';
import Link from 'next/link';
import { Alert, Badge, Card, PageHeader } from '@/components/ui/primitives';
import { DateBR, Section, TD, TH, TableShell } from '@/components/finance/bits';
import { ImportWizard } from '@/components/finance/import-wizard';
import { loadImports } from '@/lib/finance/data';
import { IMPORT_LABELS, IMPORT_STATUS_LABELS, type ImportKind } from '@/lib/finance/labels';
import { accountOpts, loadRefs, pageCtx } from '@/lib/finance/page';

export const metadata: Metadata = { title: 'Importações' };

export default async function ImportacoesPage() {
  const p = await pageCtx();
  const [refs, imports] = await Promise.all([loadRefs(p.ctx), loadImports(p.ctx)]);
  return (
    <>
      <PageHeader title="Importações (CSV)" description="Traga planilhas e extratos com segurança: leitura no servidor, prévia com erros e repetições, confirmação explícita e nenhuma baixa automática." />
      {p.perms.analyst ? (
        <Card title="Nova importação" description="Escolha o tipo e o arquivo. Aceita separador ; , tabulação ou |, valores com vírgula decimal (1.234,56) e datas DD/MM/AAAA.">
          <ImportWizard accounts={accountOpts(refs.accounts)} canHistory={p.perms.manager} />
        </Card>
      ) : <Alert tone="info">Seu perfil é de consulta: você vê o histórico de importações, mas não pode importar.</Alert>}
      <Section title="Histórico de importações">
        <TableShell caption="Importações realizadas" empty={imports.length === 0} emptyText="Nenhuma importação ainda.">
          <thead><tr className="border-b border-border"><th className={TH}>Data</th><th className={TH}>Tipo</th><th className={TH}>Arquivo</th><th className={TH}>Linhas</th><th className={TH}>Importadas</th><th className={TH}>Rejeitadas</th><th className={TH}>Situação</th></tr></thead>
          <tbody>
            {imports.map((i) => (
              <tr key={i.id} className="border-b border-border last:border-0">
                <td className={TD}><DateBR value={i.created_at} /></td><td className={TD}>{IMPORT_LABELS[i.kind as ImportKind] ?? i.kind}</td>
                <td className={TD}><Link className="underline underline-offset-2" href={`/importacoes/${i.id}`}>{i.file_name}</Link></td>
                <td className={`${TD} tabular-nums`}>{i.total_rows}</td><td className={`${TD} tabular-nums`}>{i.status === 'completed' ? i.accepted_rows : '—'}</td><td className={`${TD} tabular-nums`}>{i.status === 'completed' ? i.rejected_rows : '—'}</td>
                <td className={TD}><Badge tone={i.status === 'completed' ? 'success' : i.status === 'previewed' ? 'warning' : 'neutral'}>{IMPORT_STATUS_LABELS[i.status] ?? i.status}</Badge></td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      </Section>
    </>
  );
}
