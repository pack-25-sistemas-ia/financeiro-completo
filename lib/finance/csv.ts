// CSV: leitura (RFC 4180 + padrões brasileiros) e escrita segura. Módulo puro — roda no navegador (prévia do mapeamento) e no servidor (valor final).
import { isIsoDate } from './dates';
import { MAX_CENTS, parseBRL } from './money';
import type { ImportKind } from './labels';

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_ROWS = 5000;
const MAX_COLS = 60;
const MAX_FIELD = 2000;

/** Decodifica bytes: UTF-8 estrito; se falhar (arquivos do Excel/bancos), Windows-1252. */
export function decodeText(bytes: Uint8Array): { text: string; encoding: 'utf-8' | 'windows-1252' } {
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, ''), encoding: 'utf-8' };
  } catch {
    return { text: new TextDecoder('windows-1252').decode(bytes), encoding: 'windows-1252' };
  }
}

export function detectDelimiter(text: string): string {
  const sample = text.split(/\r\n|\n|\r/).slice(0, 5).filter((l) => l.trim() !== '');
  let best = ',';
  let bestScore = -1;
  for (const d of [';', ',', '\t', '|']) {
    const counts = sample.map((line) => { let n = 0; let q = false; for (const ch of line) { if (ch === '"') q = !q; else if (ch === d && !q) n++; } return n; });
    if (!counts.length || counts[0] === 0) continue;
    const consistent = counts.every((c) => c === counts[0]);
    const score = counts[0]! * (consistent ? 1000 : 1);
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}

export class CsvError extends Error {}

/** Lê o CSV em matriz de células. Aspas duplas, aspas escapadas («""»), quebras de linha dentro de campo, CRLF/LF/CR. */
export function parseCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const pushField = () => {
    if (field.length > MAX_FIELD) throw new CsvError('Há uma célula com mais de 2.000 caracteres.');
    row.push(field); field = '';
    if (row.length > MAX_COLS) throw new CsvError('O arquivo tem colunas demais (máximo de 60).');
  };
  const pushRow = () => {
    pushField();
    if (!(row.length === 1 && row[0]!.trim() === '')) rows.push(row);
    row = [];
    if (rows.length > MAX_ROWS + 1) throw new CsvError(`O arquivo tem mais de ${MAX_ROWS.toLocaleString('pt-BR')} linhas.`);
  };
  while (i < text.length) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"' && field === '') { inQuotes = true; i++; continue; }
    if (ch === delimiter) { pushField(); i++; continue; }
    if (ch === '\r') { pushRow(); i += text[i + 1] === '\n' ? 2 : 1; continue; }
    if (ch === '\n') { pushRow(); i++; continue; }
    field += ch; i++;
  }
  if (inQuotes) throw new CsvError('Aspas não fechadas: o arquivo parece truncado ou malformado.');
  if (field !== '' || row.length) pushRow();
  return rows;
}

export const normalizeHeader = (h: string) => h.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// ---------------------------------------------------------------------------- campos por tipo de importação
export type FieldSpec = { key: string; label: string; required: boolean; aliases: string[]; hint?: string };
const REF: FieldSpec = { key: 'reference', label: 'Documento/referência', required: false, aliases: ['documento', 'referencia', 'numero', 'nf', 'nota', 'ref', 'id'], hint: 'Entra na identificação da linha: diferencia títulos parecidos.' };
const ENTRY: FieldSpec[] = [
  { key: 'description', label: 'Descrição', required: true, aliases: ['descricao', 'historico', 'titulo', 'descr', 'description'] },
  { key: 'amount', label: 'Valor', required: true, aliases: ['valor', 'montante', 'total', 'amount', 'vlr'] },
  { key: 'due_date', label: 'Vencimento', required: true, aliases: ['vencimento', 'venc', 'data vencimento', 'due date', 'dt vencimento'] },
  { key: 'issue_date', label: 'Emissão', required: false, aliases: ['emissao', 'data emissao', 'issue date', 'dt emissao'], hint: 'Se faltar, usa o vencimento.' },
  { key: 'competence_date', label: 'Competência', required: false, aliases: ['competencia', 'data competencia', 'mes competencia'], hint: 'Se faltar, usa o vencimento.' },
  { key: 'counterparty_name', label: 'Cliente/Fornecedor', required: false, aliases: ['cliente', 'fornecedor', 'contraparte', 'favorecido', 'nome', 'pagador'], hint: 'Criado automaticamente se não existir.' },
  { key: 'category_name', label: 'Categoria', required: false, aliases: ['categoria', 'category', 'classificacao'], hint: 'Precisa existir (natureza compatível).' },
  { key: 'notes', label: 'Observações', required: false, aliases: ['observacao', 'observacoes', 'obs', 'notes'] },
  REF,
];
const PEOPLE: FieldSpec[] = [
  { key: 'name', label: 'Nome', required: true, aliases: ['nome', 'name', 'razao social', 'cliente', 'fornecedor'] },
  { key: 'legal_name', label: 'Razão social', required: false, aliases: ['razao social', 'razao', 'legal name'] },
  { key: 'document_number', label: 'CPF/CNPJ', required: false, aliases: ['cpf', 'cnpj', 'cpf cnpj', 'documento', 'document'] },
  { key: 'email', label: 'E-mail', required: false, aliases: ['email', 'e mail'] },
  { key: 'phone', label: 'Telefone', required: false, aliases: ['telefone', 'celular', 'fone', 'phone'] },
  { key: 'notes', label: 'Observações', required: false, aliases: ['observacao', 'observacoes', 'obs'] },
];
export const FIELDS: Record<ImportKind, FieldSpec[]> = {
  payables: ENTRY,
  receivables: ENTRY,
  customers: PEOPLE,
  suppliers: PEOPLE,
  statement: [
    { key: 'date', label: 'Data', required: true, aliases: ['data', 'date', 'dt', 'data lancamento', 'data movimento'] },
    { key: 'amount', label: 'Valor (+ entrada / − saída)', required: false, aliases: ['valor', 'amount', 'montante'], hint: 'Ou use as colunas Crédito e Débito.' },
    { key: 'credit', label: 'Crédito (entrada)', required: false, aliases: ['credito', 'entrada', 'credit'] },
    { key: 'debit', label: 'Débito (saída)', required: false, aliases: ['debito', 'saida', 'debit'] },
    { key: 'description', label: 'Descrição', required: true, aliases: ['descricao', 'historico', 'lancamento', 'description', 'memo'] },
    { key: 'external_reference', label: 'Identificador externo', required: false, aliases: ['id', 'identificador', 'documento', 'nsu', 'fitid', 'referencia', 'ref'], hint: 'Ajuda a evitar duplicidade e a conciliar.' },
  ],
  history: [
    { key: 'date', label: 'Data', required: true, aliases: ['data', 'date', 'dt'] },
    { key: 'amount', label: 'Valor (+ recebido / − pago)', required: true, aliases: ['valor', 'amount', 'montante'] },
    { key: 'description', label: 'Descrição', required: true, aliases: ['descricao', 'historico', 'description'] },
    { key: 'category_name', label: 'Categoria', required: false, aliases: ['categoria', 'category'] },
    { key: 'counterparty_name', label: 'Cliente/Fornecedor', required: false, aliases: ['cliente', 'fornecedor', 'contraparte', 'favorecido'] },
    { key: 'external_reference', label: 'Identificador externo', required: false, aliases: ['id', 'documento', 'referencia', 'ref'] },
  ],
};

/** Sugere o mapeamento campo → índice de coluna pelos nomes do cabeçalho (nunca repete coluna). */
export function suggestMapping(kind: ImportKind, headers: string[]): Record<string, number | null> {
  const norm = headers.map(normalizeHeader);
  const used = new Set<number>();
  const out: Record<string, number | null> = {};
  for (const f of FIELDS[kind]) {
    let found: number | null = null;
    for (const alias of f.aliases) {
      const idx = norm.findIndex((h, i) => !used.has(i) && h === alias);
      if (idx >= 0) { found = idx; break; }
    }
    if (found === null) {
      for (const alias of f.aliases) {
        const idx = norm.findIndex((h, i) => !used.has(i) && h.includes(alias));
        if (idx >= 0) { found = idx; break; }
      }
    }
    if (found !== null) used.add(found);
    out[f.key] = found;
  }
  return out;
}

// ---------------------------------------------------------------------------- células
/** Data em AAAA-MM-DD, DD/MM/AAAA ou DD-MM-AAAA → ISO (ou null). Ano de 2 dígitos não é aceito (ambíguo). */
export function parseDateCell(input: string): string | null {
  const s = input.trim();
  if (isIsoDate(s)) return s;
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (!m) return null;
  const iso = `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
  return isIsoDate(iso) ? iso : null;
}

/** Valor em reais (vírgula decimal, milhar com ponto, «R$», negativo por «-» ou parênteses) → centavos; null se inválido. */
export function parseAmountCell(input: string): number | null {
  let s = input.trim();
  if (s === '') return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  const trailing = /\s*([CD])$/i.exec(s);
  if (trailing) { if (trailing[1]!.toUpperCase() === 'D') neg = !neg; s = s.slice(0, trailing.index); }
  const c = parseBRL(s, { allowNegative: true });
  if (c === null) return null;
  const v = neg ? -Math.abs(c) : c;
  return Math.abs(v) > MAX_CENTS ? null : v;
}

// ---------------------------------------------------------------------------- linhas normalizadas (o banco valida de novo)
export type PreparedRow = { row_number: number; reference: string | null; hash: string; data: Record<string, unknown>; parse_error: string | null };

export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

const cell = (row: string[], idx: number | null | undefined) => (idx === null || idx === undefined ? '' : (row[idx] ?? '').trim());
const clean = (s: string) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

/** Converte as linhas do arquivo (sem o cabeçalho) em linhas preparadas conforme o mapeamento. Erro de leitura vira `parse_error` por linha. */
export type NormalizedRow = { row_number: number; reference: string | null; data: Record<string, unknown>; parse_error: string | null };

/** Leitura síncrona das linhas (sem hash): serve à prévia do mapeamento no navegador e é a base de `prepareRows`. */
export function normalizeRows(kind: ImportKind, rows: string[][], mapping: Record<string, number | null>, firstRowNumber = 2): NormalizedRow[] {
  const out: NormalizedRow[] = [];
  for (let n = 0; n < rows.length; n++) {
    const row = rows[n]!;
    const rowNumber = firstRowNumber + n;
    const g = (k: string) => clean(cell(row, mapping[k]));
    const data: Record<string, unknown> = {};
    let err: string | null = null;
    const setText = (k: string, max: number) => { const v = g(k); if (v) data[k] = v.slice(0, max); };

    if (kind === 'payables' || kind === 'receivables') {
      setText('description', 200);
      const amt = parseAmountCell(g('amount'));
      if (amt === null) err = `valor «${g('amount')}» não é um número válido (use 1.234,56)`;
      else if (amt <= 0) err = 'valor deve ser maior que zero';
      else data.amount_cents = amt;
      const due = parseDateCell(g('due_date'));
      if (!err && due === null) err = `vencimento «${g('due_date')}» não é uma data válida (use DD/MM/AAAA)`;
      else if (due) data.due_date = due;
      for (const [k, dk] of [['issue_date', 'issue_date'], ['competence_date', 'competence_date']] as const) {
        const raw = g(k);
        if (raw) { const d = parseDateCell(raw); if (!err && d === null) err = `${k === 'issue_date' ? 'emissão' : 'competência'} «${raw}» não é uma data válida`; else if (d) data[dk] = d; }
      }
      if (!data.issue_date && data.due_date) data.issue_date = data.due_date;
      setText('counterparty_name', 120); setText('category_name', 80);
      const ref = g('reference');
      const notes = g('notes');
      if (notes || ref) data.notes = [ref ? `Ref. ${ref}` : '', notes].filter(Boolean).join(' · ').slice(0, 1000);
    } else if (kind === 'customers' || kind === 'suppliers') {
      setText('name', 120); setText('legal_name', 160); setText('phone', 30); setText('notes', 500);
      const doc = g('document_number').replace(/\D/g, '');
      if (doc) data.document_number = doc;
      const em = g('email').toLowerCase();
      if (em) data.email = em;
    } else {
      const d = parseDateCell(g('date'));
      if (d === null) err = `data «${g('date')}» não é válida (use DD/MM/AAAA)`; else data.date = d;
      setText('description', 300); setText('external_reference', 120);
      let amt: number | null = null;
      if (kind === 'statement' && mapping.amount === null && (mapping.credit !== null || mapping.debit !== null)) {
        const cr = g('credit') ? parseAmountCell(g('credit')) : 0;
        const db = g('debit') ? parseAmountCell(g('debit')) : 0;
        if (cr === null || db === null) err ??= 'crédito/débito não é um número válido';
        else amt = Math.abs(cr) - Math.abs(db);
      } else {
        amt = parseAmountCell(g('amount'));
        if (amt === null) err ??= `valor «${g('amount')}» não é um número válido (use 1.234,56 ou -1.234,56)`;
      }
      if (amt !== null) data.amount_cents = amt;
      if (kind === 'history') { setText('category_name', 80); setText('counterparty_name', 120); }
    }

    out.push({ row_number: rowNumber, reference: (data.external_reference as string | undefined) ?? (g('reference') || null), data, parse_error: err });
  }
  return out;
}

/** Linhas prontas para enviar ao banco: leitura + identificação (hash) para deduplicação. Linhas idênticas de extrato/histórico ganham ordinal. */
export async function prepareRows(kind: ImportKind, rows: string[][], mapping: Record<string, number | null>, firstRowNumber = 2): Promise<PreparedRow[]> {
  const out: PreparedRow[] = [];
  const seen = new Map<string, number>();
  for (const n of normalizeRows(kind, rows, mapping, firstRowNumber)) {
    const data = n.data;
    const identity = JSON.stringify(Object.keys(data).sort().map((k) => [k, typeof data[k] === 'string' ? (data[k] as string).toLowerCase() : data[k]]));
    const base = await sha256Hex(`${kind}|${identity}`);
    let hash = base;
    if (kind === 'statement' || kind === 'history') {
      const k = (seen.get(base) ?? 0) + 1;
      seen.set(base, k);
      if (k > 1) hash = await sha256Hex(`${base}|#${k}`);
    }
    out.push({ row_number: n.row_number, reference: n.reference, hash, data, parse_error: n.parse_error });
  }
  return out;
}

// ---------------------------------------------------------------------------- escrita segura
export type NumCell = { num: string };
export type CsvValue = string | number | null | undefined | NumCell;

/** Neutraliza injeção de fórmula (=, +, -, @, TAB, CR no início de TEXTO). Números formais passam como {num}. */
export function safeCell(v: CsvValue): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  const raw = typeof v === 'string' ? v : v.num;
  const text = typeof v === 'string' && /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[";\n\r,]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** CSV com ponto-e-vírgula e BOM (abre direto no Excel brasileiro). */
export function toCsv(header: string[], rows: CsvValue[][]): string {
  const lines = [header.map(safeCell).join(';'), ...rows.map((r) => r.map(safeCell).join(';'))];
  return `﻿${lines.join('\r\n')}\r\n`;
}
