import { NextResponse } from 'next/server';
import { resolveContext } from '@/lib/auth/session';
import { detectFile, hasActivePdfContent, MAX_ATTACHMENT_BYTES, safeFileName } from '@/lib/finance/files';
import { logEvent } from '@/lib/log';
import { rateLimit } from '@/lib/security/rate-limit';

export const runtime = 'nodejs';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

/** Envio de comprovante: sessão + MFA + papel (analista+) → tipo real pelos bytes → Storage privado → metadados no banco (que confere vínculo e organização). */
export async function POST(request: Request) {
  const r = await resolveContext(['owner', 'admin', 'manager', 'member']);
  if (r.kind !== 'ok') return json({ ok: false, message: r.kind === 'forbidden' ? 'Você não tem permissão para anexar arquivos.' : 'Sessão expirada. Entre novamente.' }, r.kind === 'forbidden' ? 403 : 401);
  const { ctx } = r;
  const org = ctx.membership.organization_id;
  const rl = rateLimit(`att:${ctx.user.id}`, { limit: 30, windowMs: 60_000 });
  if (!rl.allowed) return json({ ok: false, message: `Muitos envios em pouco tempo. Aguarde ${rl.retryAfterSeconds}s.` }, 429);

  let form: FormData;
  try { form = await request.formData(); } catch { return json({ ok: false, message: 'Envio inválido.' }, 400); }
  const entityType = form.get('entity_type');
  const entityId = form.get('entity_id');
  const file = form.get('file');
  if ((entityType !== 'entry' && entityType !== 'settlement') || typeof entityId !== 'string' || !UUID.test(entityId)) return json({ ok: false, message: 'Registro de destino inválido.' }, 400);
  if (!(file instanceof File) || file.size === 0) return json({ ok: false, message: 'Selecione um arquivo.' }, 400);
  if (file.size > MAX_ATTACHMENT_BYTES) return json({ ok: false, message: 'O arquivo passa de 10 MB.' }, 413);

  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = detectFile(bytes);
  if (!kind) return json({ ok: false, message: 'Formato não aceito. Envie PDF, PNG ou JPG (o tipo é conferido pelo conteúdo do arquivo).' }, 415);
  if (kind.mime === 'application/pdf' && hasActivePdfContent(bytes)) return json({ ok: false, message: 'O PDF contém conteúdo ativo (script ou arquivo embutido) e foi recusado por segurança.' }, 422);

  // caminho gerado AQUI (nunca vem do cliente): <organização>/<uuid>.<ext>
  const path = `${org}/${crypto.randomUUID()}.${kind.ext}`;
  const up = await ctx.supabase.storage.from('fin-attachments').upload(path, bytes, { contentType: kind.mime, upsert: false, cacheControl: '0' });
  if (up.error) { logEvent('error', 'fin_attachment_upload_failed', { code: up.error.name }); return json({ ok: false, message: 'Não foi possível guardar o arquivo agora.' }, 502); }
  const { error } = await ctx.supabase.rpc('fin_register_attachment', { p_org: org, p_entity_type: entityType, p_entity_id: entityId, p_name: safeFileName(file.name), p_path: path, p_mime: kind.mime, p_size: bytes.length });
  if (error) {
    logEvent('warn', 'fin_attachment_register_failed', { code: error.code });
    return json({ ok: false, message: error.code === '42501' ? 'Você não tem permissão para anexar neste registro.' : (error.message && error.message.length < 200 ? error.message : 'Não foi possível registrar o anexo.') }, error.code === '42501' ? 403 : 422);
  }
  return json({ ok: true, message: 'Arquivo anexado.' });
}
