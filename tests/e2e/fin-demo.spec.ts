import { expect, test } from '@playwright/test';
import { DEMO, api, apiJson, brl, demoLogin, demoToken, expectNoServerError, norm, todayBR } from './fin-helpers';
import { SUPABASE_URL } from './helpers';

// Dados de demonstração (supabase/seed.sql). Pré-requisito: `supabase db reset` recém-executado e o app em produção na porta do site_url.
test.describe.configure({ mode: 'serial' });

const PAGES = [
  ['/dashboard', 'Painel financeiro'], ['/contas', 'Contas financeiras'], ['/pagar', 'Contas a pagar'], ['/receber', 'Contas a receber'], ['/movimentacoes', 'Movimentações'],
  ['/fluxo-caixa', 'Fluxo de caixa'], ['/fluxo-caixa?aba=projetado', 'Fluxo de caixa'], ['/conciliacao', 'Conciliação manual'], ['/importacoes', 'Importações'], ['/recorrencias', 'Recorrências'],
  ['/clientes', 'Clientes'], ['/fornecedores', 'Fornecedores'], ['/categorias', 'Categorias'], ['/centros-custo', 'Centros de custo'], ['/relatorios', 'Central de relatórios'],
  ['/notificacoes', 'Notificações'], ['/pagar/novo', 'Nova conta a pagar'], ['/receber/novo', 'Nova conta a receber'],
] as const;

test('gestor financeiro: todas as telas abrem com dados reais e sem erro', async ({ page }) => {
  await demoLogin(page, DEMO.manager);
  for (const [path, heading] of PAGES) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(200);
    await expect(page.getByRole('heading', { name: heading, level: 1 }).first(), path).toBeVisible();
    await expectNoServerError(page, path);
  }
  // relatórios: todos os 15 abrem
  await page.goto('/relatorios');
  const links = await page.locator('a[href^="/relatorios?r="]').evaluateAll((els) => els.map((e) => (e as HTMLAnchorElement).getAttribute('href')!));
  expect(links).toHaveLength(15);
  for (const href of links) {
    const res = await page.goto(href);
    expect(res?.status(), href).toBe(200);
    await expectNoServerError(page, href);
    await expect(page.getByText(/Demonstrativo gerencial. Não substitui/), href).toBeVisible();
  }
});

test('painel = banco: saldo consolidado e KPIs do mês conferem com recálculo independente a partir dos fatos', async ({ page }) => {
  const token = await demoToken(DEMO.manager);
  // Recalcula só com os FATOS (contas, movimentos, baixas, parcelas, títulos), sem usar as funções de métricas.
  const accounts = await apiJson<Array<{ id: string; opening_balance_cents: number; include_in_consolidated: boolean }>>(token, 'financial_accounts?select=id,opening_balance_cents,include_in_consolidated');
  const movements = await apiJson<Array<{ account_id: string; amount_cents: number; movement_type: string; effective_at: string; settlement_id: string | null }>>(token, 'account_movements?select=account_id,amount_cents,movement_type,effective_at,settlement_id&limit=5000');
  const settlements = await apiJson<Array<{ id: string; installment_id: string }>>(token, 'settlements?select=id,installment_id&limit=5000');
  const installments = await apiJson<Array<{ id: string; entry_id: string }>>(token, 'financial_installments?select=id,entry_id&limit=5000');
  const entries = await apiJson<Array<{ id: string; entry_type: string }>>(token, 'financial_entries?select=id,entry_type&limit=5000');
  const typeOf = new Map(entries.map((e) => [e.id, e.entry_type]));
  const instEntry = new Map(installments.map((i) => [i.id, i.entry_id]));
  const setType = new Map(settlements.map((s) => [s.id, typeOf.get(instEntry.get(s.installment_id) ?? '') ?? '']));
  const included = new Set(accounts.filter((a) => a.include_in_consolidated).map((a) => a.id));
  const consolidated = accounts.filter((a) => a.include_in_consolidated).reduce((s, a) => s + a.opening_balance_cents, 0) + movements.filter((m) => included.has(m.account_id)).reduce((s, m) => s + m.amount_cents, 0);
  const today = todayBR();
  const monthStart = `${today.slice(0, 7)}-01`;
  const local = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(iso));
  const inMonth = movements.filter((m) => m.settlement_id && local(m.effective_at) >= monthStart && local(m.effective_at) <= today);
  const income = inMonth.filter((m) => setType.get(m.settlement_id!) === 'receivable').reduce((s, m) => s + m.amount_cents, 0);
  const expense = -inMonth.filter((m) => setType.get(m.settlement_id!) === 'payable').reduce((s, m) => s + m.amount_cents, 0);

  await demoLogin(page, DEMO.manager);
  const card = (label: string) => page.locator('section', { has: page.getByText(label, { exact: true }) }).first();
  await expect(card('Saldo consolidado atual')).toContainText(norm(brl(consolidated)));
  await expect(card('Receitas realizadas')).toContainText(norm(brl(income)));
  await expect(card('Despesas realizadas')).toContainText(norm(brl(expense)));
  await expect(card('Resultado líquido de caixa')).toContainText(norm(brl(income - expense)).replace('R$ ', 'R$ '));
  // soma do que as contas mostram = consolidado (transferência/ajuste incluídos)
  await page.goto('/contas');
  await expect(page.getByText(norm(brl(consolidated))).first()).toBeVisible();
});

test('a reserva fora do consolidado aparece em Contas mas não entra no saldo consolidado', async ({ page }) => {
  await demoLogin(page, DEMO.manager);
  await page.goto('/contas');
  await expect(page.getByRole('cell', { name: 'Reserva de emergência' }).first()).toBeVisible();
  await expect(page.getByText('Fora do consolidado')).toBeVisible();
});

test('consulta enxerga tudo mas não vê botões de escrita nem Configurações', async ({ page }) => {
  await demoLogin(page, DEMO.viewer);
  for (const p of ['/pagar', '/receber', '/contas', '/importacoes', '/conciliacao', '/categorias']) {
    await page.goto(p);
    await expect(page.getByRole('link', { name: /Nova conta a (pagar|receber)/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Criar|Cadastrar|Transferir|Conciliar|Gerar prévia/ })).toHaveCount(0);
    await expectNoServerError(page, p);
  }
  await expect(page.getByRole('link', { name: 'Exportar CSV' })).toHaveCount(0);
  const res = await page.goto('/configuracoes');
  expect(res?.status()).toBe(404);
  // exportação direta é negada ao papel de consulta
  const exp = await page.request.get('/api/export/contas-pagar');
  expect(exp.status()).toBe(403);
  // a API rejeita escrita mesmo com token válido
  const token = await demoToken(DEMO.viewer);
  const org = (await apiJson<Array<{ organization_id: string }>>(token, 'organization_members?select=organization_id&limit=1'))[0]!.organization_id;
  const r = await api(token, 'rpc/fin_create_account', { method: 'POST', body: JSON.stringify({ p_org: org, p_name: 'Invasão', p_type: 'cash', p_institution: null, p_opening_cents: 0, p_opening_date: todayBR() }) });
  expect(r.status).toBeGreaterThanOrEqual(400);
  const direct = await api(token, 'account_movements', { method: 'POST', body: JSON.stringify({ organization_id: org, account_id: org, movement_type: 'adjustment', amount_cents: 1, effective_at: new Date().toISOString(), adjustment_id: org }) });
  expect(direct.status).toBeGreaterThanOrEqual(400);
});

test('analista cria título mas não dá baixa, não exporta e não vê rotas de administração', async ({ page }) => {
  await demoLogin(page, DEMO.analyst);
  await page.goto('/pagar');
  await expect(page.getByRole('link', { name: 'Nova conta a pagar' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Exportar CSV' })).toHaveCount(0);
  const res = await page.goto('/configuracoes');
  expect(res?.status()).toBe(404);
  const token = await demoToken(DEMO.analyst);
  const inst = (await apiJson<Array<{ installment_id: string }>>(token, 'fin_installments_view?select=installment_id&pending_cents=gt.0&limit=1'))[0]!.installment_id;
  const acc = (await apiJson<Array<{ id: string }>>(token, 'financial_accounts?select=id&limit=1'))[0]!.id;
  const r = await api(token, 'rpc/fin_settle_installment', { method: 'POST', body: JSON.stringify({ p_installment: inst, p_account: acc, p_amount: 100, p_settled_at: new Date().toISOString(), p_method: 'pix', p_reference: null, p_key: 'e2e-analista-0001' }) });
  expect(r.status).toBe(403);
  expect((await r.json()).message).toMatch(/sem permissão/i);
  expect((await page.request.get('/api/export/clientes')).status()).toBe(403);
});

test('API anônima não lê nada e o Storage de anexos é privado', async () => {
  const anon = await fetch(`${SUPABASE_URL}/rest/v1/financial_accounts?select=id`, { headers: { apikey: (process.env.E2E_SUPABASE_ANON_KEY ?? '') } });
  expect([401, 403]).toContain(anon.status);
  const bucket = await fetch(`${SUPABASE_URL}/storage/v1/object/public/fin-attachments/qualquer.pdf`);
  expect(bucket.status).toBeGreaterThanOrEqual(400);
});
