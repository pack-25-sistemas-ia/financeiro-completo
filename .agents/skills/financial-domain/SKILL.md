---
name: financial-domain
description: Use ao mexer em títulos, parcelas, baixas, movimentos, saldos, estornos, transferências ou ajustes.
---

# Domínio financeiro

- Três conceitos separados: **título/parcela** (previsto) → **baixa** (`settlements`) → **movimento** (`account_movements`). Previsto não é dinheiro; só a baixa move saldo.
- Saldo = `opening_balance_cents` + soma dos movimentos com data efetiva ≥ abertura. Não existe coluna de saldo; nunca crie uma.
- Livro imutável: UPDATE/DELETE em movimento, baixa e histórico de saldo inicial são bloqueados por gatilho. Correção = estorno (movimento de sinal oposto referenciando o original) ou ajuste com motivo.
- Escrita no livro só por `private.fin_post_movement`, chamada pelas funções `fin_settle_installment`, `fin_reverse_settlement`, `fin_create_transfer`, `fin_reverse_transfer`, `fin_create_adjustment`.
- Transferência = duas pernas ligadas que somam zero; transferência e ajuste **nunca** entram em receita/despesa.
- Baixa sempre com `idempotency_key`; excesso sobre o pendente é recusado; pendente = valor da parcela − baixas não estornadas.
- Atraso é derivado (`due_date < hoje` e pendente > 0), nunca status gravado. Cancelar título só sem baixas ativas.
- Prove com: `supabase/tests/62_fin_engine.sql`, `pnpm test:concurrency`, `pnpm test:mutation`.
