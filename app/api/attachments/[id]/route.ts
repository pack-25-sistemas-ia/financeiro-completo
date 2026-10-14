import { NextResponse } from 'next/server';
import { resolveContext } from '@/lib/auth/session';
import { rateLimit } from '@/lib/security/rate-limit';

export const runtime = 'nodejs';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const notFound = () => new NextResponse('Não encontrado', { status: 404, headers: { 'Cache-Control': 'no-store' } });

/** Abre o comprovante por URL assinada de 60 s. A leitura passa pela RLS: outra organização (ou id adivinhado) recebe 404 uniforme. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await resolveContext();
  if (r.kind === 'redirect') return new NextResponse('Sessão expirada', { status: 401, headers: { 'Cache-Control': 'no-store' } });
  if (r.kind !== 'ok' || !UUID.test(id)) return notFound();
  const { ctx } = r;
  const rl = rateLimit(`attget:${ctx.user.id}`, { limit: 120, windowMs: 60_000 });
  if (!rl.allowed) return new NextResponse('Muitas requisições', { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } });
  const { data } = await ctx.supabase.from('attachments').select('storage_path, original_file_name, archived_at').eq('organization_id', ctx.membership.organization_id).eq('id', id).maybeSingle();
  if (!data || data.archived_at) return notFound();
  const { data: signed, error } = await ctx.supabase.storage.from('fin-attachments').createSignedUrl(data.storage_path as string, 60);
  if (error || !signed?.signedUrl) return notFound();
  return NextResponse.redirect(signed.signedUrl, { status: 302, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
}
