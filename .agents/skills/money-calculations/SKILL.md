---
name: money-calculations
description: Use ao somar, ratear, parcelar, arredondar, formatar ou converter valores monetários, taxas e datas de vencimento.
---

# Cálculos de dinheiro

- Valor = inteiro em **centavos** (`bigint` no banco; inteiro seguro em `lib/finance/money`). Proibido `float`, `number` com casas decimais e `numeric` para valor. Teto: 99.999.999.999.999 centavos.
- Rateio e parcelas: maior resto (`distribute` em TS ↔ `private.fin_distribute` em SQL). A soma das partes é **sempre** o total; o resto vai para as primeiras parcelas. Mesmos casos nos dois lados (`tests/unit/finance-money.test.ts` e `supabase/tests/60_fin_money.sql`).
- Divisão com arredondamento: meio-para-o-par (`divideRound` ↔ `private.fin_round_div`). `decimal.js` só em taxas/percentuais e converte para centavos na fronteira.
- Entrada de usuário: `parseBRL` aceita «1.234,56» e «1234.56», recusa lixo, negativo onde não cabe e acima do teto. Exibição: `formatBRL`/componente `Money`.
- Datas de parcelas (`private.fin_due_dates` ↔ `dates.ts`): mensal preserva o dia-âncora com ajuste de fim de mês (31/01 → 28/02 → 31/03), sem acumular o ajuste.
- Mudou fórmula: atualize o espelho, os dois testes e `docs/MONEY_RULES.md`.
