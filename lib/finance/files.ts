// Tipo REAL do arquivo pelos primeiros bytes (a extensão e o Content-Type do cliente não valem). Módulo puro e testável.
export type DetectedFile = { mime: 'application/pdf' | 'image/png' | 'image/jpeg'; ext: 'pdf' | 'png' | 'jpg' };
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export function detectFile(b: Uint8Array): DetectedFile | null {
  if (b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d) return { mime: 'application/pdf', ext: 'pdf' };
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return { mime: 'image/png', ext: 'png' };
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  return null;
}

/**
 * Heurística básica contra PDF ativo (JavaScript, lançamento de programas, arquivos embutidos). NÃO substitui antivírus:
 * é uma barreira mínima; para uso em produção com arquivos de terceiros, recomenda-se varredura antivírus no envio.
 */
export function hasActivePdfContent(b: Uint8Array): boolean {
  const text = new TextDecoder('latin1').decode(b);
  return /\/(JavaScript|JS|Launch|EmbeddedFile|RichMedia|SubmitForm|ImportData)\b/.test(text);
}

/** Nome seguro para exibição/download: sem caminho, sem caracteres de controle, comprimento limitado. */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'arquivo';
  return base.replace(/[\u0000-\u001f\u007f"<>|?*:]/g, '').trim().slice(0, 120) || 'arquivo';
}
