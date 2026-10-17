import { expect, test, type Locator, type Page } from '@playwright/test';
import { addDays } from '../../lib/finance/dates';
import { apiSignUp, onboardAndEnrollMfa, uiLogin, uniqueEmail } from './helpers';
import { brl, expectNoServerError, norm, todayBR } from './fin-helpers';

// Operação financeira ponta a ponta numa organização NOVA (sem seed), com MFA do proprietário, contra o Supabase real.
test.describe.configure({ mode: 'serial' });

// Uma única sessão (login + MFA uma vez) para toda a suíte serial: evita estourar o limitador de login do app.
let page: Page;
test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({ baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3123', locale: 'pt-BR' });
  page = await context.newPage();
});
test.afterAll(async () => { await page.context().close(); });

const email = uniqueEmail('fin');
const today = todayBR();
let entryUrl = '';
let payUrl = '';
let accA = '';

const form = (page: Page, button: string | RegExp): Locator => page.locator('form', { has: page.getByRole('button', { name: button }) }).first();
const money = (cents: number) => norm(brl(cents));
/** O painel de conciliação já vem aberto quando há uma única sugestão sem ambiguidade; senão, abre pelo resumo. */
async function openReconcile(line: Locator) {
  if (!(await line.getByRole('radio').first().isVisible().catch(() => false))) await line.locator('summary', { hasText: /^Conciliar/ }).click();
}
async function text(page: Page) { return norm(await page.locator('main').innerText()); }
async function expectBalance(page: Page, name: string, cents: number) {
  // o aviso de sucesso de uma ação anterior pode ainda estar na tela: confere o banco com novas tentativas
  await expect(async () => {
    await page.goto('/contas');
    await expect(page.getByRole('row', { name: new RegExp(name) })).toContainText(money(cents), { timeout: 1500 });
  }).toPass({ timeout: 15_000 });
}

test('cria conta, organização e entra com verificação em duas etapas', async () => {
  await apiSignUp(email);
  await uiLogin(page, email);
  await onboardAndEnrollMfa(page, 'Empresa Fluxo E2E Ltda');
  await expect(page.getByText('Comece cadastrando uma conta financeira')).toBeVisible();
});

test('contas: saldo inicial, nome único e conta sem saldo negativo', async () => {
  await page.goto('/contas');
  const f = form(page, 'Criar conta');
  await f.getByLabel('Nome da conta').fill('Banco A');
  await f.getByLabel('Saldo inicial (R$)').fill('10.000,00');
  await f.getByRole('button', { name: 'Criar conta' }).click();
  await expect(page.getByText('Conta criada.').first()).toBeVisible();
  await expect(page.getByRole('row', { name: /Banco A/ })).toContainText(money(1_000_000));
  for (const [name, opening] of [['Banco B', '500,00'], ['Caixa', '0,00']] as const) {
    const g = form(page, 'Criar conta');
    await g.getByLabel('Nome da conta').fill(name);
    await g.getByLabel('Saldo inicial (R$)').fill(opening);
    if (name === 'Caixa') await g.getByLabel(/Permitir saldo negativo/).uncheck();
    await g.getByRole('button', { name: 'Criar conta' }).click();
    await expect(page.getByRole('row', { name })).toBeVisible();
  }
  // nome duplicado
  const dup = form(page, 'Criar conta');
  await dup.getByLabel('Nome da conta').fill('Banco A');
  await dup.getByLabel('Saldo inicial (R$)').fill('1,00');
  await dup.getByRole('button', { name: 'Criar conta' }).click();
  await expect(page.getByText('Já existe uma conta com este nome.')).toBeVisible();
  await expect(page.getByText('Saldo consolidado').first()).toBeVisible();
  accA = (await page.getByRole('link', { name: 'Banco A' }).first().getAttribute('href'))!.split('/').pop()!;
});

test('cliente + conta a receber de R$ 5.000,00: previsto NÃO é dinheiro', async () => {
  await page.goto('/clientes');
  const c = form(page, 'Cadastrar');
  await c.getByLabel('Nome', { exact: true }).fill('Cliente Alfa');
  await c.getByRole('button', { name: 'Cadastrar' }).click();
  await expect(page.getByText('Cadastro criado.').first()).toBeVisible();

  await page.goto('/receber/novo');
  const f = form(page, 'Criar conta a receber');
  await f.getByLabel('Descrição').fill('Projeto Alfa');
  await f.getByLabel('Cliente').selectOption({ label: 'Cliente Alfa' });
  await f.getByLabel('Categoria').selectOption({ label: 'Serviços' });
  await f.getByLabel('Valor total (R$)').fill('5.000,00');
  await f.getByLabel('1º vencimento').fill(addDays(today, 30));
  await f.getByRole('button', { name: 'Criar conta a receber' }).click();
  await page.waitForURL(/\/receber\/[0-9a-f-]{36}$/);
  entryUrl = page.url();
  const t = await text(page);
  expect(t).toContain(`Valor do título ${money(500_000)}`);
  await expect(page.getByRole('row', { name: /1\/1/ })).toContainText('Aberta');
  // o título previsto não mexeu em nenhum saldo
  await expectBalance(page, 'Banco A', 1_000_000);
  // painel: a receber 5.000,00 e saldo consolidado = 10.000 + 500 = 10.500
  await page.goto('/dashboard');
  const card = (label: string) => page.locator('section', { has: page.getByText(label, { exact: true }) }).first();
  await expect(card('Contas a receber')).toContainText(money(500_000));
  await expect(card('Saldo consolidado atual')).toContainText(money(1_050_000));
  await expect(card('Receitas realizadas')).toContainText(money(0));
});

test('baixa parcial, excesso recusado, duplo clique idempotente, quitação e estorno', async () => {
  await page.goto(entryUrl);
  await page.getByText(/^Receber parcela 1\/1/).click();
  const f = form(page, 'Registrar recebimento');
  await f.getByLabel('Conta').selectOption({ label: 'Banco A' });
  await f.getByLabel('Valor (R$)').fill('2.000,00');
  await f.getByRole('button', { name: 'Registrar recebimento' }).click();
  await expect(page.getByText('Baixa registrada.').first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole('row', { name: /1\/1/ })).toContainText('Parcialmente recebida');
  let t = await text(page);
  expect(t).toContain(money(200_000));
  expect(t).toContain(money(300_000));
  await expectBalance(page, 'Banco A', 1_200_000);

  // excesso sobre o pendente
  await page.goto(entryUrl);
  await page.getByText(/^Receber parcela 1\/1/).click();
  const g = form(page, 'Registrar recebimento');
  await g.getByLabel('Conta').selectOption({ label: 'Banco A' });
  await g.getByLabel('Valor (R$)').fill('3.000,01');
  await g.getByRole('button', { name: 'Registrar recebimento' }).click();
  await expect(page.getByText(/excede o pendente/)).toBeVisible();

  // duplo clique: uma única baixa de R$ 100,00 (a chave de idempotência é reaproveitada)
  await g.getByLabel('Valor (R$)').fill('100,00');
  await g.getByRole('button', { name: 'Registrar recebimento' }).dblclick();
  await expect(page.getByText('Baixa registrada.').first()).toBeVisible();
  await page.reload();
  t = await text(page);
  expect(t).toContain(money(290_000)); // pendente
  await expect(page.getByRole('row').filter({ hasText: 'Ativa' })).toHaveCount(2); // 2.000,00 e 100,00

  // quita o restante
  await page.getByText(/^Receber parcela 1\/1/).click();
  const h = form(page, 'Registrar recebimento');
  await h.getByLabel('Conta').selectOption({ label: 'Banco A' });
  await h.getByRole('button', { name: 'Registrar recebimento' }).click();
  // o aviso da baixa anterior ainda pode estar na tela: só o estado real da linha prova a quitação
  await expect(async () => {
    await page.reload();
    await expect(page.getByRole('row', { name: /1\/1/ })).toContainText('Recebida', { timeout: 2000 });
  }).toPass({ timeout: 20_000 });
  await expectBalance(page, 'Banco A', 1_500_000);

  // estorno da última baixa
  await page.goto(entryUrl);
  const rowAtiva = page.getByRole('row').filter({ hasText: money(290_000) }).filter({ hasText: 'Ativa' });
  await rowAtiva.getByText('Estornar', { exact: true }).click();
  const r = form(page, 'Estornar baixa');
  await r.getByPlaceholder(/Motivo do estorno/).fill('Recebimento lançado por engano');
  await r.getByRole('button', { name: 'Estornar baixa' }).click();
  await expect(page.getByText('Baixa estornada.').first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole('row', { name: /1\/1/ })).toContainText('Parcialmente recebida');
  await expect(page.getByText('Estornada', { exact: true })).toBeVisible();
  await expectBalance(page, 'Banco A', 1_210_000);
});

test('conta a pagar parcelada: 1.000,00 em 3x fecha em centavos exatos e baixa na parcela 1', async () => {
  await page.goto('/fornecedores');
  const c = form(page, 'Cadastrar');
  await c.getByLabel('Nome', { exact: true }).fill('=HYPERLINK("http://exemplo.invalido")');
  await c.getByRole('button', { name: 'Cadastrar' }).click();
  await expect(page.getByText('Cadastro criado.').first()).toBeVisible();

  await page.goto('/pagar/novo');
  const f = form(page, 'Criar conta a pagar');
  await f.getByLabel('Descrição').fill('Compra de insumos');
  await f.getByLabel('Fornecedor').selectOption({ index: 1 });
  await f.getByLabel('Valor total (R$)').fill('1.000,00');
  await f.getByLabel('1º vencimento').fill(today);
  await f.getByLabel('Parcelas').fill('3');
  const prev = page.getByText(/Prévia das parcelas/);
  await expect(prev).toBeVisible();
  await expect(prev).toContainText(money(100_000));
  const body = norm(await page.locator('main').innerText());
  expect(body).toContain(`1/3 · ${new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(new Date(`${today}T00:00:00Z`))} · ${money(33_334)}`);
  expect(body).toContain(money(33_333));
  await f.getByRole('button', { name: 'Criar conta a pagar' }).click();
  await page.waitForURL(/\/pagar\/[0-9a-f-]{36}$/);
  payUrl = page.url();
  const rows = page.getByRole('row').filter({ hasText: /^\s*\d\/3/ });
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText(money(33_334));
  await expect(rows.nth(1)).toContainText(money(33_333));
  await expect(rows.nth(2)).toContainText(money(33_333));

  await page.getByText(/^Pagar parcela 1\/3/).click();
  const s = form(page, 'Registrar pagamento');
  await s.getByLabel('Conta').selectOption({ label: 'Banco A' });
  await s.getByRole('button', { name: 'Registrar pagamento' }).click();
  await expect(page.getByText('Baixa registrada.').first()).toBeVisible();
  await expectBalance(page, 'Banco A', 1_210_000 - 33_334);
});

test('transferência: saída e entrada ligadas, consolidado intacto, conta sem negativo e estorno', async () => {
  await page.goto('/contas');
  const before = norm(await page.locator('main').innerText());
  await page.goto('/movimentacoes');
  const t = form(page, 'Transferir');
  await t.getByLabel('Conta de origem').selectOption({ label: 'Banco A' });
  await t.getByLabel('Conta de destino').selectOption({ label: 'Caixa' });
  await t.getByLabel('Valor (R$)').fill('1.000,00');
  await t.getByRole('button', { name: 'Transferir' }).click();
  await expect(page.getByText('Transferência registrada.').first()).toBeVisible();
  await expectBalance(page, 'Banco A', 1_210_000 - 33_334 - 100_000);
  await expectBalance(page, 'Caixa', 100_000);
  await page.goto('/contas');
  expect(norm(await page.locator('main').innerText()).match(/Saldo consolidado[^R]*R\$\s[\d.]+,\d\d/)?.[0]).toBe(before.match(/Saldo consolidado[^R]*R\$\s[\d.]+,\d\d/)?.[0]);

  // Caixa não aceita saldo negativo
  await page.goto('/movimentacoes');
  const back = form(page, 'Transferir');
  await back.getByLabel('Conta de origem').selectOption({ label: 'Caixa' });
  await back.getByLabel('Conta de destino').selectOption({ label: 'Banco A' });
  await back.getByLabel('Valor (R$)').fill('1.000,01');
  await back.getByRole('button', { name: 'Transferir' }).click();
  await expect(page.getByText(/saldo insuficiente/i)).toBeVisible();
  await expectBalance(page, 'Caixa', 100_000);

  // mesma conta nos dois lados
  await page.goto('/movimentacoes');
  const same = form(page, 'Transferir');
  await same.getByLabel('Conta de origem').selectOption({ label: 'Banco A' });
  await same.getByLabel('Conta de destino').selectOption({ label: 'Banco A' });
  await same.getByLabel('Valor (R$)').fill('1,00');
  await same.getByRole('button', { name: 'Transferir' }).click();
  await expect(page.getByText(/contas diferentes/i)).toBeVisible();

  // estorno
  await page.goto('/movimentacoes');
  const tbl = page.getByRole('table', { name: 'Transferências recentes' });
  await tbl.getByText('Estornar', { exact: true }).first().click();
  await tbl.getByPlaceholder('Motivo do estorno').first().fill('Transferência para a conta errada');
  await tbl.getByRole('button', { name: 'Estornar', exact: true }).first().click();
  await expect(page.getByText('Transferência estornada.').first()).toBeVisible();
  await expectBalance(page, 'Caixa', 0);
  await expectBalance(page, 'Banco A', 1_210_000 - 33_334);
});

test('ajuste de saldo exige motivo e fica fora de receita e despesa', async () => {
  await page.goto('/movimentacoes');
  await page.locator('summary', { hasText: 'Registrar ajuste' }).click();
  const f = form(page, 'Registrar ajuste');
  await f.getByLabel('Conta').selectOption({ label: 'Banco A' });
  await f.getByLabel('Valor (R$)').fill('-15,00');
  await f.getByLabel(/Motivo/).fill('Tarifa mensal do banco');
  await f.getByRole('button', { name: 'Registrar ajuste' }).click();
  await expect(page.getByText('Ajuste registrado.').first()).toBeVisible();
  await expectBalance(page, 'Banco A', 1_210_000 - 33_334 - 1_500);
  await page.goto('/dashboard');
  const card = (label: string) => page.locator('section', { has: page.getByText(label, { exact: true }) }).first();
  // receitas = 2.000 + 100 (a baixa de 2.900 foi estornada); despesas = 333,34
  await expect(card('Receitas realizadas')).toContainText(money(210_000));
  await expect(card('Despesas realizadas')).toContainText(money(33_334));
  await expect(card('Ticket médio de recebimentos')).toContainText(money(105_000));
});

test('recorrência gera só títulos previstos, sem duplicar, e pausa/encerra', async () => {
  await page.goto('/recorrencias');
  const f = form(page, 'Criar regra');
  await f.getByLabel('Descrição').fill('Aluguel E2E');
  await f.getByLabel('Valor (R$)').fill('2.500,00');
  await f.getByLabel(/Início/).fill(addDays(today, -70));
  await f.getByLabel(/Gerar com antecedência/).fill('0');
  await f.getByRole('button', { name: 'Criar regra' }).click();
  await expect(page.getByText(/Regra criada/)).toBeVisible();
  await page.goto('/recorrencias'); // a própria tela roda a rotina idempotente
  const rowsAfterFirst = await page.getByRole('link', { name: 'Título gerado' }).count();
  expect(rowsAfterFirst).toBeGreaterThanOrEqual(2);
  await page.getByRole('button', { name: 'Gerar títulos previstos agora' }).click();
  await expect(page.getByText('Nada novo para gerar agora.')).toBeVisible();
  expect(await page.getByRole('link', { name: 'Título gerado' }).count()).toBe(rowsAfterFirst);
  // nada foi pago sozinho
  await page.goto('/pagar?q=Aluguel+E2E');
  const rows = page.getByRole('row').filter({ hasText: 'Aluguel E2E' });
  expect(await rows.count()).toBe(rowsAfterFirst);
  for (let i = 0; i < rowsAfterFirst; i++) await expect(rows.nth(i)).toContainText('Aberta');
  await expectBalance(page, 'Banco A', 1_210_000 - 33_334 - 1_500);
  // pausar
  await page.goto('/recorrencias');
  await page.getByRole('row', { name: /Aluguel E2E/ }).getByRole('button', { name: 'Pausar' }).click();
  await expect(page.getByRole('row', { name: /Aluguel E2E/ })).toContainText('Pausada');
});

test('importação CSV: prévia, erros, repetida, confirmação e arquivo duplicado', async () => {
  const csv = [
    'Descrição;Valor;Vencimento;Fornecedor',
    `Papel A4;123,45;${today.split('-').reverse().join('/')};Papelaria Teste`,
    `Toner;1.500,00;${today.split('-').reverse().join('/')};Papelaria Teste`,
    `Valor ruim;abc;${today.split('-').reverse().join('/')};`,
    `Papel A4;123,45;${today.split('-').reverse().join('/')};Papelaria Teste`,
  ].join('\r\n');
  const file = { name: 'pagar.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') };
  await page.goto('/importacoes');
  await page.getByLabel(/Arquivo CSV/).setInputFiles(file);
  await expect(page.getByText(/Mapeamento das colunas/)).toBeVisible();
  await expect(page.getByText('3 linha(s) de dados', { exact: false }).or(page.getByText('4 linha(s) de dados'))).toBeVisible();
  await page.getByRole('button', { name: 'Gerar prévia da importação' }).click();
  await page.waitForURL(/\/importacoes\/[0-9a-f-]{36}$/);
  const imp = page.url();
  const kp = async (label: string) => norm(await page.locator('section', { has: page.getByText(label, { exact: true }) }).first().innerText());
  expect(await kp('Válidas')).toContain('2');
  expect(await kp('Com erro')).toContain('1');
  expect(await kp('Repetidas')).toContain('1');
  await expect(page.getByText(/não é um número válido/)).toBeVisible();
  // a prévia não criou nada
  await page.goto('/pagar?q=Toner');
  await expect(page.getByText('Nenhuma parcela encontrada')).toBeVisible();
  // relatório de erros
  const err = await page.request.get(`/api/imports/${imp.split('/').pop()}/erros`);
  expect(err.status()).toBe(200);
  expect((await err.text()).startsWith('﻿Linha do arquivo;')).toBe(true);
  // confirmar
  await page.goto(imp);
  await page.getByRole('button', { name: /Confirmar importação de 2 linha/ }).click();
  await expect(page.getByText(/2 linha\(s\) importada\(s\)/)).toBeVisible();
  await page.goto('/pagar?q=Toner');
  await expect(page.getByRole('row', { name: /Toner/ })).toContainText(money(150_000));
  // mesmo arquivo de novo
  await page.goto('/importacoes');
  await page.getByLabel(/Arquivo CSV/).setInputFiles(file);
  await page.getByRole('button', { name: 'Gerar prévia da importação' }).click();
  await expect(page.getByText(/já foi importado/)).toBeVisible();
});

test('extrato bancário + conciliação manual: sugestão, diferença com justificativa e resumo', async () => {
  const d = today.split('-').reverse().join('/');
  const csv = ['Data;Histórico;Valor;Documento', `${d};PAGTO INSUMOS;-333,34;DOC1`, `${d};TARIFA;-15,00;DOC2`, `${d};RENDIMENTO;10,00;DOC3`, `${d};AJUSTE BANCO;-2,00;DOC4`].join('\n');
  await page.goto('/importacoes');
  await page.getByLabel('O que importar').selectOption({ label: 'Extrato bancário' });
  await page.getByLabel('Conta', { exact: true }).selectOption({ label: 'Banco A' });
  await page.getByLabel(/Arquivo CSV/).setInputFiles({ name: 'extrato.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') });
  await expect(page.getByText(/Mapeamento das colunas/)).toBeVisible();
  await page.getByRole('button', { name: 'Gerar prévia da importação' }).click();
  await page.waitForURL(/\/importacoes\/[0-9a-f-]{36}$/);
  await page.getByRole('button', { name: /Confirmar importação de 4 linha/ }).click();
  await expect(page.getByText(/4 linha\(s\) importada\(s\)/)).toBeVisible();
  // o extrato NÃO baixou nada nem mexeu em saldo
  await expectBalance(page, 'Banco A', 1_210_000 - 33_334 - 1_500);

  await page.goto(`/conciliacao?account=${accA}&from=${addDays(today, -5)}&to=${today}`);
  await expect(page.getByText('PAGTO INSUMOS')).toBeVisible();
  const line = page.locator('li', { hasText: 'PAGTO INSUMOS' });
  await openReconcile(line);
  await line.locator('label').filter({ hasText: '333,34' }).filter({ hasNotText: 'diferença' }).getByRole('radio').check();
  await line.getByRole('button', { name: 'Conciliar selecionado' }).click();
  await expect(page.getByText('Conciliado.').first()).toBeVisible();
  await expect(line.getByRole('button', { name: 'Conciliar selecionado' })).toBeHidden();
  // tarifa de R$ 15,00 → o ajuste de -15,00; linha de -2,00 não tem par
  const tar = page.locator('li', { hasText: 'TARIFA' });
  await openReconcile(tar);
  await tar.locator('label').filter({ hasText: '15,00' }).filter({ hasNotText: 'diferença' }).getByRole('radio').check();
  await tar.getByRole('button', { name: 'Conciliar selecionado' }).click();
  await expect(page.getByText('Conciliado.').first()).toBeVisible();
  await expect(tar.getByRole('button', { name: 'Conciliar selecionado' })).toBeHidden();
  // diferença exige justificativa: -2,00 contra o movimento de -15,00 (mesmo sinal)
  await page.goto(`/conciliacao?account=${accA}&from=${addDays(today, -5)}&to=${today}`);
  const aj = page.locator('li', { hasText: 'AJUSTE BANCO' });
  await openReconcile(aj);
  const radios = aj.getByRole('radio');
  if ((await radios.count()) > 0) {
    await radios.first().check();
    await aj.getByRole('button', { name: 'Conciliar selecionado' }).click();
    await expect(page.getByText(/informe a justificativa/i)).toBeVisible();
  }
  // resumo
  await page.goto(`/conciliacao?account=${accA}&from=${addDays(today, -5)}&to=${today}&status=`);
  const t = await text(page);
  expect(t).toContain('Conciliadas: 2');
  expect(t).toContain('Pendentes: 2');
});

test('anexos: PDF real entra, arquivo disfarçado e PDF ativo são recusados, link é temporário', async () => {
  await page.goto(payUrl);
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
  const up = page.locator('main').getByLabel('Anexar PDF, PNG ou JPG').first();
  await up.setInputFiles({ name: 'nota.pdf', mimeType: 'application/pdf', buffer: pdf });
  await page.getByRole('button', { name: 'Enviar' }).first().click();
  await expect(page.getByText('Arquivo anexado.').first()).toBeVisible();
  await expect(page.getByText('nota.pdf')).toBeVisible();
  const href = await page.getByRole('link', { name: 'Abrir' }).first().getAttribute('href');
  const redirect = await page.request.get(href!, { maxRedirects: 0 });
  expect(redirect.status()).toBe(302);
  const loc = redirect.headers().location!;
  expect(loc).toContain('token=');
  const signed = await fetch(loc);
  expect(signed.status).toBe(200);
  expect((await signed.text()).startsWith('%PDF-')).toBe(true);

  // disfarçado: texto com extensão .pdf
  await page.reload();
  await page.locator('main').getByLabel('Anexar PDF, PNG ou JPG').first().setInputFiles({ name: 'falso.pdf', mimeType: 'application/pdf', buffer: Buffer.from('MZ\x90\x00 isto é um executável disfarçado') });
  await page.getByRole('button', { name: 'Enviar' }).first().click();
  await expect(page.getByText(/Formato não aceito/)).toBeVisible();
  // PDF com JavaScript embutido
  await page.locator('main').getByLabel('Anexar PDF, PNG ou JPG').first().setInputFiles({ name: 'ativo.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/OpenAction<</S/JavaScript/JS(app.alert(1))>>>>endobj\n%%EOF') });
  await page.getByRole('button', { name: 'Enviar' }).first().click();
  await expect(page.getByText(/conteúdo ativo/)).toBeVisible();
  // id inexistente / adivinhado → 404 uniforme
  expect((await page.request.get('/api/attachments/00000000-0000-4000-8000-000000000000')).status()).toBe(404);
  expect((await page.request.get('/api/attachments/nao-e-uuid')).status()).toBe(404);
});

test('exportações CSV: separador ;, BOM, neutralização de fórmula e auditoria', async () => {
  const res = await page.request.get('/api/export/contas-pagar?period=year');
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('text/csv');
  expect(res.headers()['content-disposition']).toContain('attachment');
  const csv = await res.text();
  expect(csv.startsWith('﻿Vencimento;Descrição;Parcela;Fornecedor')).toBe(true);
  expect(csv).toContain("'=HYPERLINK(");
  expect(csv).not.toMatch(/(^|;)=HYPERLINK/m);
  for (const r of ['fluxo-realizado', 'fluxo-projetado', 'extrato', 'movimentacoes', 'contas-receber', 'vencimentos', 'despesas-categoria', 'receitas-categoria', 'centros-custo', 'mensal', 'previsto-realizado', 'pendencias-conciliacao', 'fornecedores', 'clientes']) {
    const x = await page.request.get(`/api/export/${r}?period=year&account=${accA}`);
    expect(x.status(), r).toBe(200);
  }
  expect((await page.request.get('/api/export/inexistente')).status()).toBe(404);
  // a exportação ficou na trilha de auditoria (somente o relatório e o nº de linhas)
  await page.goto('/audit');
  await expect(page.getByText('export').first()).toBeVisible();
  await expectNoServerError(page, '/audit');
});

test('relatórios do período abrem com números e o painel fecha com o banco', async () => {
  await page.goto('/relatorios?r=fluxo-realizado&period=month');
  await expect(page.getByRole('table')).toContainText('Total');
  await page.goto('/relatorios?r=contas-pagar&period=year');
  await expect(page.getByRole('table')).toContainText('Compra de insumos');
  await page.goto('/relatorios?r=despesas-categoria&period=month&regime=accrual');
  await expect(page.getByText('Competência (data do fato gerador)')).toBeVisible();
  await page.goto('/fluxo-caixa?aba=projetado&days=60');
  await expect(page.getByText(/Saldo em 60 dias — Conservador/)).toBeVisible();
  await page.goto('/dashboard');
  await expect(page.getByText('Comparativo indisponível').first()).toBeVisible();
});
