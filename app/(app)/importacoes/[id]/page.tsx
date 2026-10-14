import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Alert, Badge, PageHeader } from '@/components/ui/primitives';
import { DateBR, Kpi, Pagination, Section, TD, TH, TableShell } from '@/components/finance/bits';
import { CancelImportForm, CommitImportForm } from '@/components/finance/import-wizard';
import { loadImport } from '@/lib/finance/data';
import { formatDateBR } from '@/lib/finance/dates';
import { one, pageFrom, uuidOrNull, type SearchParams } from '@/lib/finance/filters';
import { IMPORT_LABELS, IMPORT_ROW_LABELS, IMPORT_STATUS_LABELS, type ImportKind } from '@/lib/finance/labels';
import { formatBRL } from '@/lib/finance/money';
import { pageCtx } from '@/lib/finance/page';

export const metadata: Metadata = { title: 'Importação' };

const TONE: Record<string, 'neutral' | 'success' | 'warning' | 'danger'> = { valid: 'success', imported: 'success', duplicate: 'warning', error: 'danger', rejected: 'danger' };
const SUMMARY_KEYS = ['description', 'name', 'amount_cents', 'due_date', 'date', 'counterparty_name', 'category_name', 'document_number'] as const;

function summarize(d: Record<string, unknown>): string {
  return SUMMARY_KEYS.filter((k) => d[k] !== undefined && d[k] !== null).map((k) => {
    const v = d[k];
    if (k === 'amount_cents' && typeof v === 'number') return formatBRL(v);
    if ((k === 'due_date' || k === 'date') && typeof v === 'string') return formatDateBR(v);
    if (k === 'document_number') return 'doc. •••' + String(v).slice(-4); // minimização: não exibe o documento completo na prévia
    return String(v);
  }).join(' · ');
}

export default async function ImportacaoPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const { id } = await params;
  if (!uuidOrNull(id)) notFound();
  const sp = await searchParams;
  const p = await pageCtx();
  const page = pageFrom(one(sp.page));
  const onlyProblems = one(sp.problemas) === '1';
  const d = await loadImport(p.ctx, id, page, onlyProblems, 50);
  if (!d) notFound();
  const { imp, rows, total } = d;
  const kind = imp.kind as ImportKind;
  const canAct = kind === 'history' ? p.perms.manager : p.perms.analyst;
  const done = imp.status === 'completed';
  return (
    <>
      <PageHeader title={imp.file_name} description={`${IMPORT_LABELS[kind]} · ${IMPORT_STATUS_LABELS[imp.status] ?? imp.status}`}>
        <Link className="text-sm underline underline-offset-2" href="/importacoes">← Importações</Link>
      </PageHeader>
      {imp.status === 'previewed' ? <div className="mb-4"><Alert tone="warning"><strong>Prévia:</strong> nada foi criado ainda. {kind === 'history' ? 'Estas linhas criarão títulos já quitados E movimentos nas contas, alterando saldos. ' : kind === 'statement' ? 'O extrato não baixa títulos nem altera saldos. ' : ''}Revise os erros e confirme para importar apenas as linhas válidas.</Alert></div> : null}
      {imp.status === 'cancelled' ? <div className="mb-4"><Alert tone="info">Prévia cancelada. Nada foi importado.</Alert></div> : null}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Kpi label="Linhas lidas" value={<span>{imp.total_rows}</span>} definition="Total de linhas de dados do arquivo." />
        <Kpi label="Válidas" tone="success" value={<span>{imp.valid_rows}</span>} definition="Passaram em todas as validações." />
        <Kpi label="Repetidas" tone={imp.duplicate_rows ? 'warning' : 'neutral'} value={<span>{imp.duplicate_rows}</span>} definition="Já importadas antes ou repetidas no arquivo: não serão criadas de novo." />
        <Kpi label="Com erro" tone={imp.error_rows ? 'danger' : 'neutral'} value={<span>{imp.error_rows}</span>} definition="Valor, data ou campo inválido. Corrija a planilha e envie de novo." />
        <Kpi label={done ? 'Importadas' : 'Serão importadas'} tone="success" value={<span>{done ? imp.accepted_rows : imp.valid_rows}</span>} definition={done ? `Rejeitadas: ${imp.rejected_rows}.` : 'Apenas as linhas válidas.'} />
      </div>
      {imp.status === 'previewed' && canAct ? (
        <div className="mb-6 flex flex-wrap items-start gap-4">
          {imp.valid_rows > 0 ? <CommitImportForm id={imp.id} kind={kind} validRows={imp.valid_rows} /> : <Alert tone="error">Nenhuma linha válida para importar. Corrija o arquivo e gere uma nova prévia.</Alert>}
          <CancelImportForm id={imp.id} />
        </div>
      ) : null}
      <Section title="Linhas" actions={<span className="flex gap-3 text-sm">
        <Link className="underline underline-offset-2" href={`/importacoes/${id}${onlyProblems ? '' : '?problemas=1'}`}>{onlyProblems ? 'Mostrar todas' : 'Só problemas'}</Link>
        {imp.error_rows + imp.duplicate_rows + imp.rejected_rows > 0 ? <a className="underline underline-offset-2" href={`/api/imports/${id}/erros`}>Baixar relatório de erros (CSV)</a> : null}
      </span>}>
        <TableShell caption="Linhas da importação" empty={rows.length === 0} emptyText="Nenhuma linha neste filtro.">
          <thead><tr className="border-b border-border"><th className={TH}>Linha</th><th className={TH}>Situação</th><th className={TH}>Conteúdo lido</th><th className={TH}>Motivo</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.row_number} className="border-b border-border align-top last:border-0">
                <td className={`${TD} tabular-nums`}>{r.row_number}</td><td className={TD}><Badge tone={TONE[r.status] ?? 'neutral'}>{IMPORT_ROW_LABELS[r.status] ?? r.status}</Badge></td>
                <td className={`${TD} max-w-md break-words`}>{summarize(r.parsed_data) || '—'}</td><td className={`${TD} text-danger`}>{r.error_message ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </TableShell>
        <Pagination base={`/importacoes/${id}`} sp={sp} page={page} total={total} size={50} />
      </Section>
      <p className="text-xs text-muted">Criada em <DateBR value={imp.created_at} />{imp.completed_at ? <> · concluída em <DateBR value={imp.completed_at} /></> : null}.</p>
    </>
  );
}
