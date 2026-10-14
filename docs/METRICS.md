# METRICS — Indicadores e fórmulas

Todos calculados no banco/servidor, com autorização por papel e organização. Período e filtros (conta, categoria, centro de custo, contraparte, status) se aplicam a todos. «Hoje» usa o fuso da organização. Valores em centavos inteiros.

| # | Indicador | Regime | Fórmula |
|---|---|---|---|
| 1 | Saldo consolidado atual | caixa | Σ por conta ativa incluída no consolidado de `opening_balance_cents + Σ movimentos posted com effective_at ≤ agora e ≥ opening_balance_date` |
| 2 | Receitas realizadas | caixa | Σ movimentos positivos **de baixas de títulos a receber** no período, menos os estornos desses movimentos no período; exclui transferências e ajustes |
| 3 | Despesas realizadas | caixa | Σ (valor absoluto) de movimentos negativos **de baixas de títulos a pagar** no período, menos estornos; exclui transferências e ajustes |
| 4 | Resultado líquido de caixa | caixa | (2) − (3) |
| 5 | Contas a pagar | — | Σ pendente das parcelas de títulos a pagar não cancelados e não arquivados (pendente = valor − baixas não estornadas) |
| 6 | Contas a receber | — | idem para títulos a receber |
| 7 | Valores vencidos | — | Σ pendente das parcelas com `due_date < hoje` (a pagar e a receber exibidos separadamente) |
| 8 | Saldo projetado | previsto | Ver `CASHFLOW_RULES.md` |
| 9 | Ticket médio de recebimentos | caixa | (2) ÷ nº de **baixas** de recebimento não estornadas no período (considera pagamentos individuais, não títulos quitados); divisão inteira arredondada half-even; «indisponível» se nº = 0 |
| 10 | Despesas por categoria | caixa | (3) agrupado pela categoria do título; subcategorias somam na categoria-pai no resumo; sem categoria = «Sem categoria» |

## Gráficos
1. Receitas × despesas mensais = (2) e (3) por mês. 2. Evolução do saldo = saldo consolidado ao fim de cada dia/mês. 3. Fluxo realizado = entradas/saídas/saldo por período. 4. Fluxo projetado = série diária do saldo projetado nos três cenários. 5–6. Despesas/receitas por categoria = (3)/(2) por categoria. 7–8. A pagar/receber por vencimento = pendente por faixa (vencido, 0–7, 8–30, 31–60, 61+ dias). 9. Previsto × realizado = Σ valor das parcelas com vencimento no período × Σ baixas líquidas no período. 10. Centros de custo = alocações proporcionais das baixas por centro.

## Regras
- Transferências nunca entram em receita/despesa/faturamento. Competência (`competence_date`) só aparece em relatórios rotulados «competência».
- Estados: carregando, sem dados, falha, comparativo indisponível, alerta de pendência, saldo negativo, filtro sem resultados.
- Projeções são rotuladas como hipótese. Cada métrica tem teste que compara com totais esperados das fixtures do seed.

## Dados de conferência (fixture de `supabase/tests/66_fin_metrics.sql`)
«Hoje» = 15/06/2025 (parâmetro `p_today`); período do painel = 02/06 a 30/06 (o anterior, de mesmo tamanho, vai de 02/05 a 31/05). Contas: Banco 10.000,00, Caixa 500,00, Poupança 2.000,00 (**fora do consolidado**), todas abertas em 01/01/2025.

**Títulos a receber**: R1 Projeto Alfa 5.000,00 (rateio 60% Comercial / 40% Operações; recebido 2.000,00 em 20/05 e 3.000,00 em 02/06) · R2 Venda balcão 1.200,00 (recebida 05/06) · R3 Contrato mensal 3.000,00 (vence 10/06, aberto) · R4 Serviço futuro 4.500,00 (vence 30/06) · R5 Venda 700,00 (recebida 08/06 e **estornada** 09/06).
**Títulos a pagar**: P1 Aluguel 2.500,00 (pago 05/06) · P2 Insumos 1.000,00 em 3× (333,34 pago 25/05; 333,33 em 25/06 e 25/07) · P3 Marketing 800,00 (vence 01/06, aberto) · P4 Licença 600,00 (vence 18/06; pago 200,00 em 12/06).
**Outros**: transferência Banco→Caixa 1.000,00 (03/06) · tarifa −15,00 (04/06, ajuste) · regra mensal «Internet» 199,90 a partir de 01/07 · meta de receita 10.000,00 em junho.

| Indicador | Valor esperado | Como se chega |
|---|---|---|
| Saldo consolidado (Banco + Caixa) | 13.651,66 | Banco 11.151,66 + Caixa 2.500,00; a Poupança não entra |
| Receitas realizadas | 4.200,00 | R1 3.000,00 + R2 1.200,00; R5 (700,00 − 700,00 estorno) = 0; transferência e tarifa fora |
| Despesas realizadas | 2.700,00 | P1 2.500,00 + P4 200,00 |
| Resultado de caixa | 1.500,00 | 4.200,00 − 2.700,00 |
| Período anterior | 2.000,00 / 333,34 / 1.666,66 | R1 em 20/05; P2 parcela 1 |
| A pagar / a receber (pendente) | 1.866,66 / 8.200,00 | 800 + 400 + 333,33 + 333,33 ; 3.000 + 4.500 + 700 |
| Vencido pagar / receber | 800,00 (1) / 3.700,00 (2) | P3 ; R3 + R5 (estornada volta a ficar pendente) |
| Vence em 7 dias / 30 dias | 400,00 (1) / 733,33 (2) | P4 ; P4 + P2 parc. 2 |
| Ticket médio de recebimentos | 2.100,00 | 4.200,00 ÷ 2 recebimentos individuais não estornados |
| Meta de receita | 42% | 4.200,00 de 10.000,00 |
| Saldo projetado em 30 dias (base) | 20.118,43 | 13.651,66 + 8.200,00 − 1.533,33 − 199,90 |
| Fluxo diário (consolidado) | 01/06 12.166,66 · 02/06 15.166,66 · 03/06 15.166,66 (transferência neutra) · 04/06 15.151,66 · 09/06 13.851,66 · 30/06 13.651,66 | movimentos efetivos acumulados |
| Despesa por categoria | Aluguel 2.500,00 (92,59%) · Tecnologia 200,00 (7,41%) | |
| Receita por categoria | Serviços 3.000,00 (71,43%) · Vendas 1.200,00 (28,57%) | |
| Centros de custo | Comercial 1.800,00 · Operações 1.200,00 | rateio 60/40 de 3.000,00 |
| Previsto × realizado (junho) | receitas 9.400,00 × 4.200,00 · despesas 4.233,33 × 2.700,00 | |

O teste também cobre filtros (conta, categoria, cliente, centro de custo), período invertido ou longo demais, contas fora do consolidado, o arredondamento `fin_round_div` (100÷3 = 33; 15÷10 = 2; 25÷10 = 2; 35÷10 = 4; negativos e divisor inválido), os cenários da projeção (saldo final em 30 dias: conservador 19.298,43 · base 20.118,43 · otimista 20.528,43), os fluxos semanal e mensal, e os relatórios por categoria e por cliente/fornecedor.
