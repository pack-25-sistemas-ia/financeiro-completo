import { describe, expect, it } from 'vitest';
import { CsvError, decodeText, detectDelimiter, parseAmountCell, parseCsv, parseDateCell, prepareRows, safeCell, sha256Hex, suggestMapping, toCsv } from '@/lib/finance/csv';

describe('leitura do CSV', () => {
  it('detecta ; , tab e |', () => {
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';');
    expect(detectDelimiter('a,b,c\n1,2,3')).toBe(',');
    expect(detectDelimiter('a\tb\tc\n1\t2\t3')).toBe('\t');
    expect(detectDelimiter('a|b|c\n1|2|3')).toBe('|');
    expect(detectDelimiter('nome;valor\n"Silva, João";"1,50"')).toBe(';');
  });
  it('campos entre aspas, aspas escapadas e quebras de linha dentro do campo', () => {
    expect(parseCsv('a;b\n"x;y";"he said ""hi"""\n"linha1\nlinha2";z', ';')).toEqual([['a', 'b'], ['x;y', 'he said "hi"'], ['linha1\nlinha2', 'z']]);
  });
  it('CRLF, LF, CR e linhas vazias finais', () => {
    expect(parseCsv('a;b\r\n1;2\r\n\r\n', ';')).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseCsv('a;b\r1;2', ';')).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseCsv('a;b\n1;2', ';')).toEqual([['a', 'b'], ['1', '2']]);
  });
  it('recusa arquivo malformado ou grande demais', () => {
    expect(() => parseCsv('a;b\n"aberto;2', ';')).toThrow(CsvError);
    expect(() => parseCsv(Array.from({ length: 5003 }, (_, i) => `l${i};1`).join('\n'), ';')).toThrow(CsvError);
    expect(() => parseCsv(`a;${'x'.repeat(2001)}`, ';')).toThrow(CsvError);
    expect(() => parseCsv(Array.from({ length: 61 }, () => 'c').join(';'), ';')).toThrow(CsvError);
  });
  it('codificação: UTF-8 estrito com BOM e Windows-1252 como alternativa', () => {
    const utf8 = new TextEncoder().encode('﻿descrição;valor');
    expect(decodeText(utf8)).toEqual({ text: 'descrição;valor', encoding: 'utf-8' });
    const latin1 = Uint8Array.from([0x64, 0x65, 0x73, 0x63, 0x72, 0x69, 0xe7, 0xe3, 0x6f]); // «descrição» em Windows-1252
    expect(decodeText(latin1)).toEqual({ text: 'descrição', encoding: 'windows-1252' });
  });
});

describe('células', () => {
  it.each([['05/01/2024', '2024-01-05'], ['5/1/2024', '2024-01-05'], ['05-01-2024', '2024-01-05'], ['05.01.2024', '2024-01-05'], ['2024-01-05', '2024-01-05'], ['29/02/2024', '2024-02-29']])('data %s', (i, o) => {
    expect(parseDateCell(i)).toBe(o);
  });
  it.each(['', '31/02/2024', '29/02/2023', '05/01/24', '2024-13-01', 'ontem', '01/13/2024x'])('data inválida «%s»', (i) => expect(parseDateCell(i)).toBeNull());
  it.each([['1.234,56', 123456], ['-1.234,56', -123456], ['(123,45)', -12345], ['R$ 10,00', 1000], ['10,5', 1050], ['100,00 D', -10000], ['100,00 C', 10000], ['0,01', 1], ['1234', 123400]])('valor %s', (i, o) => {
    expect(parseAmountCell(i)).toBe(o);
  });
  it.each(['', 'abc', '1,2,3', '1e5', '12,345', '9999999999999999,00'])('valor inválido «%s»', (i) => expect(parseAmountCell(i)).toBeNull());
});

describe('mapeamento automático', () => {
  it('reconhece cabeçalhos brasileiros com acento e variações', () => {
    const m = suggestMapping('payables', ['Descrição', 'Valor (R$)', 'Vencimento', 'Fornecedor', 'Categoria', 'Obs.']);
    expect(m.description).toBe(0); expect(m.amount).toBe(1); expect(m.due_date).toBe(2); expect(m.counterparty_name).toBe(3); expect(m.category_name).toBe(4); expect(m.notes).toBe(5);
    expect(m.issue_date).toBeNull();
  });
  it('não usa a mesma coluna duas vezes', () => {
    const m = suggestMapping('customers', ['Nome', 'CPF/CNPJ', 'E-mail', 'Telefone']);
    expect(new Set(Object.values(m).filter((v) => v !== null)).size).toBe(Object.values(m).filter((v) => v !== null).length);
    expect(m.document_number).toBe(1);
  });
  it('extrato com crédito/débito', () => {
    const m = suggestMapping('statement', ['Data', 'Histórico', 'Crédito', 'Débito', 'Documento']);
    expect(m.date).toBe(0); expect(m.description).toBe(1); expect(m.credit).toBe(2); expect(m.debit).toBe(3); expect(m.external_reference).toBe(4); expect(m.amount).toBeNull();
  });
});

describe('preparar linhas', () => {
  it('contas a pagar: valores, datas e erros por linha', async () => {
    const map = suggestMapping('payables', ['Descrição', 'Valor', 'Vencimento', 'Fornecedor']);
    const rows = await prepareRows('payables', [['Papel A4', '123,45', '10/06/2025', 'Papelaria X'], ['Sem valor', 'abc', '10/06/2025', ''], ['Data ruim', '10,00', '31/02/2025', ''], ['Negativa', '-5,00', '10/06/2025', '']], map);
    expect(rows[0]).toMatchObject({ row_number: 2, parse_error: null, data: { description: 'Papel A4', amount_cents: 12345, due_date: '2025-06-10', issue_date: '2025-06-10', counterparty_name: 'Papelaria X' } });
    expect(rows[1]!.parse_error).toContain('valor');
    expect(rows[2]!.parse_error).toContain('vencimento');
    expect(rows[3]!.parse_error).toContain('maior que zero');
    expect(rows[0]!.hash).toMatch(/^[0-9a-f]{64}$/);
  });
  it('a identificação da linha não depende da posição nem de caixa alta/baixa', async () => {
    const map = suggestMapping('payables', ['Descrição', 'Valor', 'Vencimento']);
    const a = await prepareRows('payables', [['Papel A4', '123,45', '10/06/2025']], map, 2);
    const b = await prepareRows('payables', [['PAPEL a4', '123,45', '10/06/2025']], map, 40);
    expect(a[0]!.hash).toBe(b[0]!.hash);
    const c = await prepareRows('payables', [['Papel A4', '123,46', '10/06/2025']], map);
    expect(c[0]!.hash).not.toBe(a[0]!.hash);
  });
  it('extrato: crédito/débito vira valor com sinal e linhas idênticas ganham hashes distintos', async () => {
    const map = suggestMapping('statement', ['Data', 'Histórico', 'Crédito', 'Débito']);
    const rows = await prepareRows('statement', [['05/06/2025', 'TED', '300,00', ''], ['05/06/2025', 'TED', '300,00', ''], ['06/06/2025', 'TARIFA', '', '15,00']], map);
    expect(rows.map((r) => r.data.amount_cents)).toEqual([30000, 30000, -1500]);
    expect(rows[0]!.hash).not.toBe(rows[1]!.hash);
    expect(rows.every((r) => r.parse_error === null)).toBe(true);
  });
  it('mesmo extrato em ordem/linhas diferentes gera os mesmos hashes (sobreposição de períodos)', async () => {
    const map = suggestMapping('statement', ['Data', 'Histórico', 'Valor']);
    const a = await prepareRows('statement', [['05/06/2025', 'PIX', '10,00'], ['06/06/2025', 'TED', '20,00']], map, 2);
    const b = await prepareRows('statement', [['06/06/2025', 'TED', '20,00'], ['07/06/2025', 'OUTRO', '1,00']], map, 2);
    expect(a[1]!.hash).toBe(b[0]!.hash);
  });
  it('clientes: CPF/CNPJ só dígitos, e-mail em minúsculas e caracteres de controle removidos', async () => {
    const map = suggestMapping('customers', ['Nome', 'CPF/CNPJ', 'E-mail']);
    const r = await prepareRows('customers', [['Ana\u0007 Souza', '123.456.789-09', 'ANA@Ex.com']], map);
    expect(r[0]!.data).toEqual({ name: 'Ana Souza', document_number: '12345678909', email: 'ana@ex.com' });
  });
  it('sha256 conhecido', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('exportação segura (injeção de fórmula)', () => {
  it('neutraliza = + - @ TAB CR no início de texto', () => {
    expect(safeCell('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(safeCell('+55 11 99999')).toBe("'+55 11 99999");
    expect(safeCell('-cmd')).toBe("'-cmd");
    expect(safeCell('@SOMA(A1)')).toBe("'@SOMA(A1)");
    expect(safeCell('\tabc')).toBe("'\tabc");
    expect(safeCell('\rabc')).toBe(`"'\rabc"`);
  });
  it('números formatados não são alterados e textos comuns passam', () => {
    expect(safeCell({ num: '-12.50' })).toBe('-12.50');
    expect(safeCell(42)).toBe('42');
    expect(safeCell('Aluguel')).toBe('Aluguel');
    expect(safeCell(null)).toBe('');
    expect(safeCell('a;b')).toBe('"a;b"');
    expect(safeCell('diz "oi"')).toBe('"diz ""oi"""');
  });
  it('arquivo com BOM, separador ; e CRLF', () => {
    const csv = toCsv(['Descrição', 'Valor'], [['=1+1', { num: '10.00' }], ['Normal', { num: '-5.00' }]]);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toBe("﻿Descrição;Valor\r\n'=1+1;10.00\r\nNormal;-5.00\r\n");
  });
});
