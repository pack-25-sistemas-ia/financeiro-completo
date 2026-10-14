# RECONCILIATION — Importação de CSV e conciliação manual

A conciliação é **manual assistida**. Não há conexão com bancos (Open Finance fica fora do escopo). Conciliar **nunca cria, altera ou apaga** movimento: só liga uma linha do extrato a um movimento que já existe no livro (`reconciliation_matches`).

## Importação de CSV (`imports` → `import_rows`)
Três tipos: **extrato** (vira `bank_statement_lines`, não mexe no saldo), **títulos** (cria contas a pagar/receber previstas) e **histórico** (cria títulos já baixados e movimentos; exige gestor financeiro ou administrador por mover saldo).

1. **Leitura no navegador/servidor**: codificação detectada (UTF-8 com ou sem BOM, Windows-1252), separador detectado (`;`, `,`, tabulação), aspas e quebras de linha dentro de campo. Limite de 12 MB de corpo; 5.000 linhas por arquivo.
2. **Mapeamento de colunas** sugerido pelo cabeçalho (data, descrição, valor, débito/crédito, documento, vencimento…), ajustável antes de enviar.
3. **Prévia** (`fin_create_import`): valida cada linha (data real, valor em formato BR ou ponto decimal, teto de R$ 999.999.999.999,99, campos obrigatórios) e classifica como **válida**, **duplicada** ou **com erro**. Nada é gravado no livro nesta etapa.
4. **Duplicidade**: (a) o **mesmo arquivo** (hash SHA-256 do conteúdo) não é importado duas vezes para o mesmo tipo e conta; (b) cada linha tem um **hash normalizado** (data + valor + descrição normalizada + referência); linha repetida no arquivo ou já importada vira «duplicada». Dois lançamentos legítimos idênticos no mesmo arquivo exigem diferenciar a referência.
5. **Confirmação** (`fin_commit_import`): importa só as válidas, em uma transação, idempotente. As rejeitadas ficam registradas com o motivo, e o **relatório de erros** é baixável em CSV (`/api/imports/[id]/erros`).
6. **Cancelamento**: importação em prévia pode ser cancelada sem efeito.

## Sugestões (`fin_suggest_matches`)
Para cada linha pendente de uma conta, procura movimentos **ainda não conciliados**, de mesmo sinal (entrada com entrada, saída com saída), dentro de uma tolerância de dias (padrão 3).

| Critério | Pontos |
|---|---|
| Valor idêntico | 70 (valor diferente com mesma referência: 20) |
| Mesma referência externa | +30 |
| Proximidade de data | até +10 (cai 3 por dia de diferença) |

Marca **ambígua** quando há mais de um candidato de mesmo valor para a linha, ou quando o movimento serve a mais de uma linha. Ambígua nunca é conciliada automaticamente: a pessoa escolhe. Mostra as razões («valor igual», «mesma data», «2 dia(s) de diferença»).

## Conciliar (`fin_reconcile`)
- Linha precisa estar **pendente**; movimento e linha, na **mesma conta** e com **mesmo sinal**; movimento não pode estar em outra conciliação ativa.
- Valores diferentes exigem **justificativa** (mínimo 5 caracteres); a diferença fica gravada em `difference_cents`.
- Analista concilia; **desfazer** (`fin_undo_reconciliation`) é do gestor. Desfazer exige motivo, marca a ligação como desfeita (histórico preservado) e devolve a linha a pendente.
- **Ignorar linha** (`fin_ignore_statement_line`) exige motivo e é reversível (`fin_unignore_statement_line`).

## Resumo do período (`fin_reconciliation_summary`)
Para uma conta e um período: saldo do livro até o fim do período, movimento líquido do livro × total do extrato (e a diferença), linhas pendentes (quantidade e valor), conciliadas, **divergentes** (conciliadas com diferença justificada, e o valor da divergência), ignoradas e movimentos do livro ainda sem extrato. Serve para saber o que falta explicar.

## Limites conhecidos
Sem conciliação 1-para-N (uma linha do extrato para vários movimentos) nem N-para-1; sem regras automáticas aprendidas; sem OFX/CNAB (só CSV); sem câmbio.
