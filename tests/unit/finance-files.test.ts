import { describe, expect, it } from 'vitest';
import { detectFile, hasActivePdfContent, safeFileName } from '@/lib/finance/files';

const bytes = (...n: number[]) => new Uint8Array(n);
const text = (s: string) => new TextEncoder().encode(s);

describe('tipo real do arquivo pelos bytes', () => {
  it('reconhece PDF, PNG e JPEG', () => {
    expect(detectFile(text('%PDF-1.7\n'))).toEqual({ mime: 'application/pdf', ext: 'pdf' });
    expect(detectFile(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toEqual({ mime: 'image/png', ext: 'png' });
    expect(detectFile(bytes(0xff, 0xd8, 0xff, 0xe0))).toEqual({ mime: 'image/jpeg', ext: 'jpg' });
  });
  it('recusa executável, HTML, ZIP, SVG e arquivos vazios ou curtos', () => {
    expect(detectFile(text('MZ\x90\x00'))).toBeNull();
    expect(detectFile(text('<html><script>alert(1)</script>'))).toBeNull();
    expect(detectFile(text('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(detectFile(bytes(0x50, 0x4b, 0x03, 0x04))).toBeNull();
    expect(detectFile(new Uint8Array())).toBeNull();
    expect(detectFile(text('%PDF'))).toBeNull(); // assinatura incompleta
  });
});

describe('PDF ativo', () => {
  it('sinaliza JavaScript, Launch e arquivo embutido', () => {
    expect(hasActivePdfContent(text('%PDF-1.4 << /JavaScript (app.alert(1)) >>'))).toBe(true);
    expect(hasActivePdfContent(text('%PDF-1.4 << /S /Launch >>'))).toBe(true);
    expect(hasActivePdfContent(text('%PDF-1.4 << /EmbeddedFile >>'))).toBe(true);
  });
  it('aceita PDF comum', () => {
    expect(hasActivePdfContent(text('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF'))).toBe(false);
  });
});

describe('nome de arquivo seguro', () => {
  it('remove caminho, controle e caracteres perigosos', () => {
    expect(safeFileName('../../etc/passwd')).toBe('passwd');
    expect(safeFileName('C:\\temp\\nota<fiscal>.pdf')).toBe('notafiscal.pdf');
    expect(safeFileName('a"b|c?.pdf')).toBe('abc.pdf');
    expect(safeFileName('   ')).toBe('arquivo');
    expect(safeFileName('x'.repeat(300)).length).toBe(120);
  });
});
