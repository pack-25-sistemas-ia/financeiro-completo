# FINANCIAL_MODEL — Gestão Financeira Empresarial

## Conceitos
- **Título** (`financial_entries`, payable/receivable): direito ou obrigação. Sempre tem ≥1 **parcela** (`financial_installments`); a soma das parcelas = valor do título (rateio de centavos por maior resto).
- **Baixa** (`settlements`): pagamento/recebimento efetivo de uma parcela; parcial permitido; `valor ≤ pendente` (excesso fora do MVP).
- **Movimento** (`account_movements`): entrada (+) ou saída (−) em conta. `amount_cents` com sinal, `≠ 0`. Origem exatamente uma de: baixa, transferência, ajuste.
- **Transferência**: dois movimentos ligados por `transfer_id`, soma 0; excluída de receita/despesa.

## Saldo
`saldo(conta, t) = opening_balance_cents + Σ movimentos com effective_at ≥ opening_balance_date e ≤ t`. Estorno = movimento de sinal oposto referenciando o original; o original nunca é editado. A pagar/receber **não** entram no saldo disponível.

## Pendente e status
`pendente = valor_parcela − Σ baixas não estornadas`. Status do título derivado: aberta, parcialmente paga, paga, cancelada (só sem baixas ativas). Atraso derivado.

## Regimes
Caixa usa a data efetiva do movimento; competência usa `competence_date` do título. Nenhum relatório mistura; cada um declara o regime.

## Projeção
`saldo_proj(d) = saldo_atual + Σ pendente a receber(venc ≤ d) − Σ pendente a pagar(venc ≤ d)`. Usa só o pendente (sem dupla contagem de baixas); transferências neutras; cenários conservador/otimista com parâmetros explícitos, rotulados como hipótese.

## Idempotência e concorrência
`settlements.idempotency_key` única por organização; a baixa trava a parcela (`FOR UPDATE`) e recalcula o pendente na transação; estorno exige `reversed_at is null`. Importação: `file_hash` e `normalized_hash` únicos por organização/conta.

## Multiempresa
`organization_id` em toda tabela + RLS; chaves compostas (id, organization_id) impedem relação cruzada. Papéis: administrador, gestor financeiro, analista, consulta; mapeamento aos papéis do Core na Fase 2 (`PERMISSIONS.md`).
