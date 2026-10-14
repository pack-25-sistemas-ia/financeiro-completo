# CASHFLOW_RULES — Fluxo de caixa

## Realizado (regime de caixa)
- Fonte: `account_movements` efetivos (`status = 'posted'`), por `effective_at` no fuso da organização.
- `saldo_final = saldo_inicial_do_período + entradas − saídas`, onde `saldo_inicial_do_período` = saldo inicial das contas + movimentos anteriores ao período (a partir de `opening_balance_date`; movimentos anteriores a essa data não contam).
- **Entradas/saídas operacionais** = movimentos originados de baixas. **Transferências** (`transfer_id`) e **ajustes** aparecem em linhas próprias e ficam fora de receita/despesa; o consolidado das transferências é 0.
- **Estorno** é movimento de sinal oposto ligado ao original e reduz o realizado no dia do estorno (efeito líquido; o original permanece visível). O detalhe mostra original e estorno.
- Categoria do movimento = categoria do título da baixa; rateio por centro de custo proporcional às `financial_allocations` (método do maior resto).

## Projetado (previsto)
- `saldo_proj(d) = saldo_atual_consolidado + Σ pendente a receber(vencimento ≤ d) − Σ pendente a pagar(vencimento ≤ d)`, por dia/semana/mês; janelas 30/60/90 ou personalizada.
- Só **pendente** (valor da parcela − baixas não estornadas): baixas já feitas não são contadas de novo.
- Parcelas vencidas e ainda pendentes entram na **data de referência** (hoje), pois a data real é incerta; ficam sinalizadas.
- Recorrências futuras ainda não geradas entram como previstas dentro da janela (geradas a partir da regra, sem gravar), sem duplicar as já geradas (chave regra+data).
- Transferências não alteram o consolidado.
- Saldo projetado negativo gera alerta.

## Cenários (hipóteses, não previsão estatística)
- **Base:** vencimentos cadastrados.
- **Conservador:** recebimentos deslocados `+atraso_dias` e reduzidos em `redução_%`; pagamentos inalterados.
- **Otimista:** recebimentos antecipados `−antecipação_dias` (nunca antes de hoje) e acrescidos em `aumento_%`.
- Parâmetros ficam em `organizations.settings_json`, visíveis na tela; a interface rotula «hipótese, não garantia».

## Regimes
Realizado = caixa; «previsto × realizado» compara `competence_date`/vencimento dos títulos com baixas; cada tela e relatório declara o regime.
