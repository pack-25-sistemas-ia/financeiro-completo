import { NextResponse } from 'next/server';
import { resolveContext } from '@/lib/auth/session';
import { loadSettings } from '@/lib/finance/data';
import { one, resolveFilters, type SearchParams } from '@/lib/finance/filters';
import { buildReport, reportToCsv, REPORT_NAMES } from '@/lib/finance/reports';
import { GRANULARITIES, SCENARIOS, type Granularity, type Scenario } from '@/lib/finance/labels';
import { logEvent } from '@/lib/log';
import { rateLimit } from '@/lib/security/rate-limit';

export const runtime = 'nodejs';
const deny = (status: number, msg: string) => new NextResponse(msg, { status, headers: { 'Cache-Control': 'no-store' } });

/** Exportação CSV: só gestão/administração, sempre pela sessão (RLS), com registro na auditoria (relatório e nº de linhas, nunca valores). */
export async function GET(request: Request, { params }: { params: Promise<{ report: string }> }) {
  const { report } = await params;
  const r = await resolveContext(['owner', 'admin', 'manager']);
  if (r.kind === 'redirect') return deny(401, 'Sessão expirada.');
  if (r.kind !== 'ok') return deny(403, 'Você não tem permissão para exportar dados financeiros.');
  if (!REPORT_NAMES.includes(report)) return deny(404, 'Relatório inexistente.');
  const { ctx } = r;
  const rl = rateLimit(`exp:${ctx.user.id}`, { limit: 20, windowMs: 60_000 });
  if (!rl.allowed) return deny(429, 'Muitas exportações em pouco tempo.');

  const url = new URL(request.url);
  const sp: SearchParams = Object.fromEntries(url.searchParams.entries());
  const settings = await loadSettings(ctx);
  const f = resolveFilters(sp, settings.timezone);
  const gran = one(sp.gran) as Granularity | undefined;
  const scenario = one(sp.scenario) as Scenario | undefined;
  const regime = one(sp.regime) === 'accrual' ? 'accrual' : 'cash';
  const days = Number(one(sp.days));
  try {
    const rep = await buildReport(ctx, settings.timezone, report, f, {
      gran: gran && GRANULARITIES.includes(gran) ? gran : undefined, scenario: scenario && SCENARIOS.includes(scenario) ? scenario : undefined, regime,
      days: Number.isInteger(days) && days > 0 ? days : undefined, status: one(sp.status) ?? null, venc: one(sp.venc) ?? null,
    });
    if (!rep) return deny(404, 'Relatório inexistente.');
    await ctx.supabase.rpc('fin_log_export', { p_org: ctx.membership.organization_id, p_report: report.replaceAll('-', '_'), p_rows: rep.rows.length });
    const csv = reportToCsv(rep);
    return new NextResponse(csv, { status: 200, headers: {
      'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${report}-${f.from}_${f.to}.csv"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    } });
  } catch {
    logEvent('error', 'fin_export_failed', { report });
    return deny(500, 'Não foi possível gerar o arquivo agora.');
  }
}
