# MONEY_RULES — Regras monetárias

1. **Unidade:** centavos de BRL como inteiro. Banco: `bigint`; TS: `number` inteiro seguro (`Number.isSafeInteger`), validado em toda fronteira. Nunca `float`, `numeric` com casas ou `Number` fracionário para dinheiro.
2. **Limite:** valor absoluto ≤ 9.007.199.254.740.991 centavos no TS; o banco limita cada lançamento a R$ 999.999.999.999,99 (`check`). Somas no banco usam `bigint`; no TS, soma com verificação de segurança.
3. **Entrada do usuário:** texto BRL («1.234,56») → centavos por parser estrito (sem notação científica, no máximo 2 casas, rejeita ambíguo). O servidor **nunca confia** em valor calculado pelo cliente: recalcula parcelas, rateios e pendentes.
4. **Percentuais e taxas:** `decimal.js` com precisão 28 e arredondamento **ROUND_HALF_EVEN** (banker's) por padrão único, convertendo para centavos inteiros ao final; `Decimal` nunca vai a JSON (converte na fronteira).
5. **Distribuição (parcelas e rateios):** método do maior resto. `base = floor(total/n)`, `resto = total − base·n`; as primeiras `resto` parcelas recebem +1 centavo. Soma exata, determinística, sem perda ou criação de centavos. Rateio por pesos usa o mesmo método sobre as quotas.
6. **Sinal:** entrada de conta positiva, saída negativa em `account_movements`; `amount_cents` de título, parcela, baixa e transferência é sempre **positivo**.
7. **Zero:** títulos, baixas e transferências exigem valor > 0. Movimento ≠ 0.
8. **Moeda:** BRL no MVP; coluna `currency` mantida e validada (`= 'BRL'`) para evolução futura sem conversão.
9. **Formatação:** `Intl.NumberFormat('pt-BR', {style:'currency', currency:'BRL'})` somente na apresentação; CSV exporta decimal com ponto e 2 casas, sem símbolo.
10. **Datas:** datas contábeis (`due_date`, `competence_date`) são `date` sem fuso; instantes (`settled_at`, `effective_at`) são `timestamptz`. O corte «dia» usa o fuso da organização.
