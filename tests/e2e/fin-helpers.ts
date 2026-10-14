import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { ANON_KEY, SUPABASE_URL, apiLogin } from './helpers';

export const DEMO_PASSWORD = 'DemoLocal#2026';
export const DEMO = { owner: 'dono@demo.exemplo', manager: 'gestor@demo.exemplo', analyst: 'analista@demo.exemplo', viewer: 'consulta@demo.exemplo' };

/** BRL como o app mostra (Intl pt-BR usa espaço não separável após «R$»). */
export const brl = (cents: number) => {
  const abs = Math.abs(cents);
  const reais = Math.trunc(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${cents < 0 ? '-' : ''}R$ ${reais},${String(abs % 100).padStart(2, '0')}`;
};
export const norm = (s: string) => s.replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

/** Login por e-mail/senha pela interface (usuários sem MFA obrigatório: gestor, analista e consulta). */
export async function demoLogin(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL('**/dashboard');
}

export async function demoToken(email: string): Promise<string> {
  return apiLogin(email, DEMO_PASSWORD);
}

/** PostgREST/RPC como o usuário (RLS aplicada). */
export async function api(token: string, path: string, init: RequestInit = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { apikey: ANON_KEY, authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers as Record<string, string>) } });
}
export async function apiJson<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await api(token, path, init);
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return (await res.json()) as T;
}

export async function expectNoServerError(page: Page, label: string) {
  await expect(page.locator('body'), `${label}: sem tela de erro`).not.toContainText(/Algo deu errado|Application error|Internal Server Error/);
}

/** Dia local (Brasília) como YYYY-MM-DD. */
export function todayBR(now = Date.now()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
}
