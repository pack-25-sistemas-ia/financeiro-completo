import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { DEMO, demoLogin } from './fin-helpers';

// Acessibilidade estrutural, responsividade (celular), teclado e tema escuro nas telas com dados de demonstração.
test.describe.configure({ mode: 'serial' });

const PAGES = ['/dashboard', '/contas', '/pagar', '/receber', '/pagar/novo', '/movimentacoes', '/fluxo-caixa', '/fluxo-caixa?aba=projetado', '/conciliacao', '/importacoes', '/recorrencias', '/clientes', '/fornecedores', '/categorias', '/centros-custo', '/relatorios', '/relatorios?r=fluxo-realizado', '/notificacoes'];

/** Verificações estruturais (WCAG 2.2 AA em parte): uma página sem ids repetidos, com landmark, h1 único e nomes acessíveis em todos os controles. */
async function structural(page: Page) {
  return page.evaluate(() => {
    const out: string[] = [];
    const ids = new Map<string, number>();
    document.querySelectorAll('[id]').forEach((e) => ids.set(e.id, (ids.get(e.id) ?? 0) + 1));
    for (const [id, n] of ids) if (n > 1) out.push(`id repetido «${id}» (${n}x)`);
    if (document.querySelectorAll('main').length !== 1) out.push('deve haver exatamente um <main>');
    if (document.querySelectorAll('h1').length !== 1) out.push(`h1: ${document.querySelectorAll('h1').length}`);
    if (!document.documentElement.lang) out.push('<html> sem lang');
    document.querySelectorAll('input, select, textarea').forEach((el) => {
      const i = el as HTMLInputElement;
      if (i.type === 'hidden' || i.type === 'submit') return;
      const named = (i.labels && i.labels.length > 0) || i.getAttribute('aria-label') || i.getAttribute('aria-labelledby') || i.title;
      if (!named) out.push(`controle sem nome acessível: <${el.tagName.toLowerCase()} name="${i.name}">`);
    });
    document.querySelectorAll('button, a[href]').forEach((el) => {
      const t = (el.textContent ?? '').trim();
      if (!t && !el.getAttribute('aria-label') && !el.getAttribute('title') && !el.querySelector('img[alt]')) out.push(`${el.tagName.toLowerCase()} sem texto/nome: ${(el.getAttribute('href') ?? '').slice(0, 40)}`);
    });
    document.querySelectorAll('img').forEach((el) => { if (!el.hasAttribute('alt')) out.push('img sem alt'); });
    document.querySelectorAll('table').forEach((el) => { if (!el.querySelector('caption')) out.push('tabela sem caption'); });
    document.querySelectorAll('details > summary').forEach((el) => { if (!(el.textContent ?? '').trim()) out.push('summary vazio'); });
    return out;
  });
}

test('acessibilidade estrutural: todas as telas principais', async ({ page }) => {
  await demoLogin(page, DEMO.manager);
  for (const path of PAGES) {
    await page.goto(path);
    const problems = await structural(page);
    expect(problems, `${path}: ${problems.join(' | ')}`).toEqual([]);
  }
});

test('teclado: link «Ir para o conteúdo» é o primeiro foco e leva ao conteúdo', async ({ page }) => {
  await demoLogin(page, DEMO.manager);
  await page.goto('/contas');
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Ir para o conteúdo' });
  await expect(skip).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#conteudo$/);
  // foco visível em campo de formulário (anel de foco do navegador/CSS)
  await page.goto('/pagar/novo');
  await page.getByLabel('Descrição').focus();
  const outline = await page.getByLabel('Descrição').evaluate((e) => { const s = getComputedStyle(e); return `${s.outlineStyle}|${s.outlineWidth}|${s.boxShadow}`; });
  expect(outline).not.toBe('none|0px|none');
});

test.describe('celular (390×844)', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('sem rolagem horizontal da página e menu acessível', async ({ page }) => {
    await demoLogin(page, DEMO.manager);
    for (const path of PAGES) {
      await page.goto(path);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `${path}: a página rolou ${overflow}px na horizontal`).toBeLessThanOrEqual(1);
    }
    await page.goto('/dashboard');
    await page.getByText('Menu', { exact: true }).click();
    await page.getByRole('link', { name: 'A pagar' }).first().click();
    await expect(page).toHaveURL(/\/pagar/);
    await expect(page.getByRole('heading', { name: 'Contas a pagar', level: 1 })).toBeVisible();
  });

  test('operação no celular: abrir título e ver o formulário de baixa', async ({ page }) => {
    await demoLogin(page, DEMO.manager);
    await page.goto('/pagar?status=open');
    await page.getByRole('link', { name: 'Abrir' }).first().click();
    await page.getByText(/^Pagar parcela/).first().click();
    await expect(page.getByRole('button', { name: 'Registrar pagamento' }).first()).toBeVisible();
    // os botões de ação têm área de toque de pelo menos 40 px de altura
    const h = await page.getByRole('button', { name: 'Registrar pagamento' }).first().evaluate((e) => e.getBoundingClientRect().height);
    expect(h).toBeGreaterThanOrEqual(40);
  });
});

test.describe('tema escuro', () => {
  test.use({ colorScheme: 'dark' });
  test('o painel respeita o tema escuro e o texto continua legível', async ({ page }) => {
    await demoLogin(page, DEMO.manager);
    await page.goto('/dashboard');
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const fg = await page.evaluate(() => getComputedStyle(document.body).color);
    expect(bg).not.toBe(fg);
    const lum = (rgb: string) => { const m = rgb.match(/\d+/g)!.map(Number); return (0.2126 * m[0]! + 0.7152 * m[1]! + 0.0722 * m[2]!) / 255; };
    expect(Math.abs(lum(bg) - lum(fg))).toBeGreaterThan(0.5); // contraste mínimo grosseiro entre fundo e texto
  });
});

test('capturas de tela para a documentação (opcional: E2E_SHOTS=1)', async ({ page }) => {
  test.skip(!process.env.E2E_SHOTS, 'defina E2E_SHOTS=1 para gerar docs/screenshots');
  mkdirSync('docs/screenshots', { recursive: true });
  await demoLogin(page, DEMO.manager);
  await page.setViewportSize({ width: 1366, height: 900 });
  for (const [name, path] of [['painel', '/dashboard'], ['pagar', '/pagar'], ['fluxo-projetado', '/fluxo-caixa?aba=projetado'], ['conciliacao', '/conciliacao'], ['relatorios', '/relatorios?r=mensal']] as const) {
    await page.goto(path);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `docs/screenshots/${name}.png`, fullPage: false });
  }
});
