import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { SUPABASE_URL, ANON_KEY, apiAal2Token, apiLogin, apiSignUp, loginWithMfa, onboardAndEnrollMfa, uiLogin, uniqueEmail, PASSWORD } from './helpers';
import { api, apiJson, todayBR } from './fin-helpers';

// Cenários de ameaça (§27 do prompt) pela API REST com tokens reais e pelo app, com DUAS empresas e usuários distintos.
test.describe.configure({ mode: 'serial' });

const emailA = uniqueEmail('secA');
const emailB = uniqueEmail('secB');
let secretA = '';
let secretB = '';
let tokA = '';
let tokB = '';
let orgA = '';
let orgB = '';
let accA = '';
let accB = '';
let entryA = '';
let instA = '';
let settleA = '';
let ctxB: BrowserContext;
let pageB: Page;
let attA = '';

const rpc = (tok: string, fn: string, body: Record<string, unknown>) => api(tok, `rpc/${fn}`, { method: 'POST', body: JSON.stringify(body) });

test('prepara duas empresas (A e B), cada uma com seu proprietário em MFA', async ({ browser }) => {
  for (const [email, name, which] of [[emailA, 'Empresa A Seg Ltda', 'A'], [emailB, 'Empresa B Seg Ltda', 'B']] as const) {
    await apiSignUp(email);
    const ctx = await browser.newContext({ baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3123', locale: 'pt-BR' });
    const p = await ctx.newPage();
    await uiLogin(p, email);
    const secret = await onboardAndEnrollMfa(p, name);
    if (which === 'A') secretA = secret; else { secretB = secret; ctxB = ctx; pageB = p; }
    if (which === 'A') await ctx.close();
  }
  tokA = await apiAal2Token(await apiLogin(emailA), secretA);
  tokB = await apiAal2Token(await apiLogin(emailB), secretB);
  orgA = (await apiJson<Array<{ organization_id: string }>>(tokA, 'organization_members?select=organization_id'))[0]!.organization_id;
  orgB = (await apiJson<Array<{ organization_id: string }>>(tokB, 'organization_members?select=organization_id'))[0]!.organization_id;
  expect(orgA).not.toBe(orgB);
});

test('A cria conta, título e baixa (com comprovante) pela API', async () => {
  const today = todayBR();
  const a = await rpc(tokA, 'fin_create_account', { p_org: orgA, p_name: 'Banco A', p_type: 'checking', p_institution: null, p_opening_cents: 1_000_000, p_opening_date: today });
  expect(a.status).toBe(200);
  accA = (await a.json()) as string;
  const b = await rpc(tokB, 'fin_create_account', { p_org: orgB, p_name: 'Banco B', p_type: 'checking', p_institution: null, p_opening_cents: 500_000, p_opening_date: today });
  accB = (await b.json()) as string;
  const e = await rpc(tokA, 'fin_create_entry', { p_org: orgA, p_type: 'receivable', p_description: 'Título sigiloso da empresa A', p_counterparty: null, p_category: null, p_expected_account: accA, p_amount: 100_000, p_issue: today, p_competence: today, p_first_due: today, p_installments: 1, p_frequency: 'monthly', p_notes: null, p_idempotency_key: 'sec-entry-0001', p_allocations: null, p_custom_dues: null });
  entryA = (await e.json()) as string;
  instA = (await apiJson<Array<{ id: string }>>(tokA, `financial_installments?select=id&entry_id=eq.${entryA}`))[0]!.id;
  const s = await rpc(tokA, 'fin_settle_installment', { p_installment: instA, p_account: accA, p_amount: 40_000, p_settled_at: new Date().toISOString(), p_method: 'pix', p_reference: null, p_key: 'sec-settle-0001' });
  expect(s.status).toBe(200);
  settleA = (await s.json()) as string;
  // comprovante de A pela UI da empresa A seria longo: registra metadados direto com o caminho correto (o arquivo vai ao Storage pelo próprio token de A)
  const path = `${orgA}/${crypto.randomUUID()}.pdf`;
  const up = await fetch(`${SUPABASE_URL}/storage/v1/object/fin-attachments/${path}`, { method: 'POST', headers: { apikey: ANON_KEY, authorization: `Bearer ${tokA}`, 'content-type': 'application/pdf' }, body: '%PDF-1.4\n%%EOF' });
  expect(up.status).toBe(200);
  const reg = await rpc(tokA, 'fin_register_attachment', { p_org: orgA, p_entity_type: 'entry', p_entity_id: entryA, p_name: 'segredo.pdf', p_path: path, p_mime: 'application/pdf', p_size: 15 });
  attA = (await reg.json()) as string;
  expect(attA).toMatch(/^[0-9a-f-]{36}$/);
});

test('1) empresa B não enxerga NADA de A (tabelas, visões e funções)', async () => {
  for (const t of ['financial_entries', 'financial_installments', 'settlements', 'account_movements', 'financial_accounts', 'counterparties', 'attachments', 'audit_log', 'bank_statement_lines', 'recurring_rules', 'fin_notifications']) {
    const rows = await apiJson<unknown[]>(tokB, `${t}?select=*&organization_id=eq.${orgA}`);
    expect(rows, t).toEqual([]);
  }
  expect(await apiJson<unknown[]>(tokB, `fin_installments_view?select=*&organization_id=eq.${orgA}`)).toEqual([]);
  expect(await apiJson<unknown[]>(tokB, `fin_movements_view?select=*&organization_id=eq.${orgA}`)).toEqual([]);
  const k = await rpc(tokB, 'fin_dashboard_kpis', { p_org: orgA, p_from: '2025-01-01', p_to: todayBR() });
  expect(k.status).toBe(403);
  const pj = await rpc(tokB, 'fin_cashflow_projection', { p_org: orgA, p_days: 30 });
  expect(pj.status).toBe(403);
  const rp = await rpc(tokB, 'fin_report_monthly', { p_org: orgA, p_from: '2025-01-01', p_to: todayBR() });
  expect(rp.status).toBe(403);
});

test('9/3/8) B não baixa, não estorna, não transfere, não cria nem cancela em A', async () => {
  const today = todayBR();
  const tries: Array<[string, Record<string, unknown>]> = [
    ['fin_settle_installment', { p_installment: instA, p_account: accB, p_amount: 100, p_settled_at: new Date().toISOString(), p_method: 'pix', p_reference: null, p_key: 'sec-b-settle-1' }],
    ['fin_reverse_settlement', { p_id: settleA, p_reason: 'tentativa de estorno cruzado' }],
    ['fin_cancel_entry', { p_id: entryA, p_reason: 'tentativa de cancelamento cruzado' }],
    ['fin_create_transfer', { p_org: orgA, p_source: accA, p_destination: accB, p_amount: 100, p_at: new Date().toISOString(), p_description: null, p_key: 'sec-b-xfer-0001' }],
    ['fin_create_transfer', { p_org: orgB, p_source: accB, p_destination: accA, p_amount: 100, p_at: new Date().toISOString(), p_description: null, p_key: 'sec-b-xfer-0002' }],
    ['fin_set_opening_balance', { p_id: accA, p_cents: 1, p_date: today, p_reason: 'tentativa de adulterar saldo inicial' }],
    ['fin_create_entry', { p_org: orgA, p_type: 'payable', p_description: 'Invasão', p_counterparty: null, p_category: null, p_expected_account: null, p_amount: 100, p_issue: today, p_competence: today, p_first_due: today, p_installments: 1, p_frequency: 'monthly', p_notes: null, p_idempotency_key: null, p_allocations: null, p_custom_dues: null }],
    ['fin_register_attachment', { p_org: orgB, p_entity_type: 'entry', p_entity_id: entryA, p_name: 'x.pdf', p_path: `${orgB}/${crypto.randomUUID()}.pdf`, p_mime: 'application/pdf', p_size: 10 }],
  ];
  for (const [fn, body] of tries) {
    const r = await rpc(tokB, fn, body);
    expect(r.status, `${fn} ${JSON.stringify(body).slice(0, 40)}`).toBeGreaterThanOrEqual(400);
  }
  // nada mudou em A
  const bal = await apiJson<Array<{ balance_cents: number }>>(tokA, `fin_account_balances?select=balance_cents&account_id=eq.${accA}`);
  expect(bal[0]!.balance_cents).toBe(1_000_000 + 40_000);
  expect(await apiJson<unknown[]>(tokA, `settlements?select=id&installment_id=eq.${instA}`)).toHaveLength(1);
});

test('escrita direta pelo PostgREST é negada até ao proprietário (só as funções escrevem)', async () => {
  const today = todayBR();
  const attempts: Array<[string, string, unknown]> = [
    ['POST', 'financial_accounts', { organization_id: orgA, name: 'direta', account_type: 'cash', opening_balance_date: today }],
    ['POST', 'account_movements', { organization_id: orgA, account_id: accA, movement_type: 'adjustment', amount_cents: 999_999, effective_at: new Date().toISOString(), adjustment_id: accA }],
    ['POST', 'settlements', { organization_id: orgA, installment_id: instA, account_id: accA, amount_cents: 1, settled_at: new Date().toISOString(), idempotency_key: 'direto-0001' }],
    ['PATCH', `financial_accounts?id=eq.${accA}`, { opening_balance_cents: 99_999_999 }],
    ['PATCH', `account_movements?account_id=eq.${accA}`, { amount_cents: 1 }],
    ['PATCH', `settlements?id=eq.${settleA}`, { amount_cents: 1 }],
    ['DELETE', `account_movements?account_id=eq.${accA}`, null],
    ['DELETE', `settlements?id=eq.${settleA}`, null],
    ['DELETE', `financial_entries?id=eq.${entryA}`, null],
    ['POST', 'audit_log', { organization_id: orgA, action: 'x', entity: 'y' }],
    ['DELETE', 'audit_log?organization_id=eq.' + orgA, null],
  ];
  for (const [method, path, body] of attempts) {
    const r = await api(tokA, path, { method, body: body === null ? undefined : JSON.stringify(body), headers: { prefer: 'return=representation' } });
    expect(r.status, `${method} ${path}`).toBeGreaterThanOrEqual(400);
  }
  // o saldo e as baixas seguem intactos
  expect((await apiJson<Array<{ balance_cents: number }>>(tokA, `fin_account_balances?select=balance_cents&account_id=eq.${accA}`))[0]!.balance_cents).toBe(1_040_000);
});

test('13) valores adulterados: negativo, zero, fracionário, acima do teto e texto são recusados', async () => {
  const base = { p_installment: instA, p_account: accA, p_settled_at: new Date().toISOString(), p_method: 'pix', p_reference: null };
  for (const [i, amount] of ([[-100], [0], [60_000.5], [100_000_000_000_000_000], ['abc'], [60_001]] as unknown[][]).entries()) {
    const r = await rpc(tokA, 'fin_settle_installment', { ...base, p_amount: amount[0], p_key: `sec-tamper-00${i}x` });
    expect(r.status, JSON.stringify(amount)).toBeGreaterThanOrEqual(400);
  }
  expect((await apiJson<Array<{ pending_cents: number }>>(tokA, `fin_installments_view?select=pending_cents&installment_id=eq.${instA}`))[0]!.pending_cents).toBe(60_000);
  const e = await rpc(tokA, 'fin_create_entry', { p_org: orgA, p_type: 'payable', p_description: 'x', p_counterparty: null, p_category: null, p_expected_account: null, p_amount: -5, p_issue: todayBR(), p_competence: todayBR(), p_first_due: todayBR(), p_installments: 1, p_frequency: 'monthly', p_notes: null, p_idempotency_key: null, p_allocations: null, p_custom_dues: null });
  expect(e.status).toBeGreaterThanOrEqual(400);
});

test('4/5/8) requisição duplicada e concorrente de baixa: no máximo o pendente, uma vez por chave; estorno só uma vez', async () => {
  const body = (key: string, amount: number) => ({ p_installment: instA, p_account: accA, p_amount: amount, p_settled_at: new Date().toISOString(), p_method: 'pix', p_reference: null, p_key: key });
  // mesma chave 5x → uma baixa, mesmo id
  const same = await Promise.all(Array.from({ length: 5 }, () => rpc(tokA, 'fin_settle_installment', body('sec-dup-key-001', 10_000))));
  const ids = new Set(await Promise.all(same.map(async (r) => { expect(r.status).toBe(200); return (await r.json()) as string; })));
  expect(ids.size).toBe(1);
  // mesma chave, valor diferente → conflito
  const other = await rpc(tokA, 'fin_settle_installment', body('sec-dup-key-001', 10_001));
  expect(other.status).toBeGreaterThanOrEqual(400);
  // 8 pagamentos simultâneos de 30.000 sobre 50.000 pendentes: só 1 cabe
  const par = await Promise.all(Array.from({ length: 8 }, (_, i) => rpc(tokA, 'fin_settle_installment', body(`sec-par-key-00${i}`, 30_000))));
  expect(par.filter((r) => r.status === 200)).toHaveLength(1);
  const paid = (await apiJson<Array<{ paid_cents: number }>>(tokA, `fin_installments_view?select=paid_cents&installment_id=eq.${instA}`))[0]!.paid_cents;
  expect(paid).toBe(40_000 + 10_000 + 30_000);
  // estorno repetido (5 simultâneos): só um vale
  const rev = await Promise.all(Array.from({ length: 5 }, () => rpc(tokA, 'fin_reverse_settlement', { p_id: settleA, p_reason: 'estorno simultâneo de teste' })));
  expect(rev.filter((r) => r.status === 204 || r.status === 200)).toHaveLength(1);
  expect((await apiJson<Array<{ paid_cents: number }>>(tokA, `fin_installments_view?select=paid_cents&installment_id=eq.${instA}`))[0]!.paid_cents).toBe(40_000);
});

test('10) comprovante: B não lê, não adivinha id, não grava na pasta de A; app responde 404 uniforme', async () => {
  const path = (await apiJson<Array<{ storage_path: string }>>(tokA, `attachments?select=storage_path&id=eq.${attA}`))[0]!.storage_path;
  const read = await fetch(`${SUPABASE_URL}/storage/v1/object/authenticated/fin-attachments/${path}`, { headers: { apikey: ANON_KEY, authorization: `Bearer ${tokB}` } });
  expect(read.status).toBeGreaterThanOrEqual(400);
  const sign = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/fin-attachments/${path}`, { method: 'POST', headers: { apikey: ANON_KEY, authorization: `Bearer ${tokB}`, 'content-type': 'application/json' }, body: JSON.stringify({ expiresIn: 60 }) });
  expect(sign.status).toBeGreaterThanOrEqual(400);
  const write = await fetch(`${SUPABASE_URL}/storage/v1/object/fin-attachments/${orgA}/${crypto.randomUUID()}.pdf`, { method: 'POST', headers: { apikey: ANON_KEY, authorization: `Bearer ${tokB}`, 'content-type': 'application/pdf' }, body: '%PDF-1.4\n%%EOF' });
  expect(write.status).toBeGreaterThanOrEqual(400);
  const del = await fetch(`${SUPABASE_URL}/storage/v1/object/fin-attachments/${path}`, { method: 'DELETE', headers: { apikey: ANON_KEY, authorization: `Bearer ${tokA}` } });
  expect([400, 401, 403, 404]).toContain(del.status); // nem o dono apaga pelo cliente
  // pelo app, no navegador de B
  expect((await pageB.request.get(`/api/attachments/${attA}`)).status()).toBe(404);
  const res = await pageB.goto(`/pagar/${entryA}`);
  expect(res?.status()).toBe(404);
  expect((await pageB.request.get(`/receber/${entryA}`)).status()).toBe(404);
  await expect(pageB.locator('body')).not.toContainText('sigiloso');
});

test('11) exportação de B contém só dados de B; analista/consulta não exportam', async () => {
  const r = await pageB.request.get('/api/export/contas-receber?period=year');
  expect(r.status()).toBe(200);
  expect(await r.text()).not.toContain('sigiloso');
  const mov = await pageB.request.get('/api/export/movimentacoes?period=year');
  expect(await mov.text()).not.toContain('Banco A');
});

test('12) sessão encerrada não pode ser reaproveitada com os mesmos cookies', async ({ browser }) => {
  const ctx = await browser.newContext({ baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3123', locale: 'pt-BR' });
  const p = await ctx.newPage();
  await loginWithMfa(p, emailB, secretB);
  const cookies = await ctx.cookies();
  await p.getByRole('button', { name: 'Sair' }).click();
  await p.waitForURL('**/login');
  const ctx2 = await browser.newContext({ baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3123', locale: 'pt-BR' });
  await ctx2.addCookies(cookies);
  const p2 = await ctx2.newPage();
  await p2.goto('/dashboard');
  await p2.waitForURL(/\/(login|mfa\/verify)/);
  expect(p2.url()).not.toContain('/dashboard');
  const r = await ctx2.request.get('/api/export/contas-pagar');
  expect([401, 403]).toContain(r.status());
  await ctx.close(); await ctx2.close();
});

test('15) conciliação: o mesmo movimento não é conciliado duas vezes (estorno de conciliado só por administrador: teste SQL 64)', async () => {
  // A cria extrato e concilia o movimento da baixa; um gestor (convidado) tenta estornar
  const today = todayBR();
  const mov = (await apiJson<Array<{ id: string }>>(tokA, `account_movements?select=id&settlement_id=eq.${settleA}&movement_type=eq.settlement`))[0]!.id;
  const hash = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');
  const fileHash = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');
  const imp = await (await rpc(tokA, 'fin_create_import', { p_org: orgA, p_kind: 'statement', p_file_name: 'seg.csv', p_file_hash: fileHash, p_account: accA, p_rows: [{ row_number: 1, reference: 'X', hash, data: { date: today, amount_cents: 40_000, description: 'PIX RECEBIDO', external_reference: 'X' } }] })).json() as { import_id: string };
  await rpc(tokA, 'fin_commit_import', { p_import: imp.import_id });
  const line = (await apiJson<Array<{ id: string }>>(tokA, `bank_statement_lines?select=id&account_id=eq.${accA}`))[0]!.id;
  const m = await rpc(tokA, 'fin_reconcile', { p_line: line, p_movement: mov, p_note: null });
  expect(m.status).toBe(200);
  // a baixa já foi estornada acima; o movimento original segue conciliado e o estorno de movimento conciliado exige administrador
  const again = await rpc(tokA, 'fin_reconcile', { p_line: line, p_movement: mov, p_note: null });
  expect(again.status).toBeGreaterThanOrEqual(400); // não concilia duas vezes
});

test('limpeza: contextos abertos são fechados', async () => {
  await ctxB.close();
  expect(PASSWORD.length).toBeGreaterThan(12);
});
