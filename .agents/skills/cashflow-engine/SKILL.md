---
name: cashflow-engine
description: Use ao mexer em fluxo de caixa realizado/projetado, recorrências, indicadores do painel ou relatórios.
---

# Fluxo de caixa, indicadores e relatórios

- Realizado = movimentos efetivos (caixa). Projetado = saldo atual + pendente a receber − pendente a pagar por vencimento, em três cenários (conservador, esperado, otimista). Sempre rotulado como **hipótese**; transferências são neutras.
- Regime declarado em todo relatório: caixa usa a data efetiva do movimento; competência usa `competence_date`. Nunca misture.
- Indicadores e relatórios vivem em funções SQL (`fin_dashboard_kpis`, `fin_dashboard_series`, `fin_cashflow_*`, `fin_report_*`). A tela não recalcula nada. «Hoje» usa o fuso da organização (`fin_settings.timezone`).
- Teste de métrica = fixture de datas fixas com `p_today` explícito e total **calculado à mão** (`supabase/tests/66_fin_metrics.sql`). Não use `now()` em fixture.
- Recorrência: `fin_generate_recurring` é idempotente (`unique(rule_id, scheduled_date)`), preenche só o futuro dentro da janela, trata fim de mês e respeita pausa/fim. Rotinas rodam por pg_cron ou ao abrir o painel.
- «Resumo Gerencial de Receitas e Despesas» nunca é chamado de DRE oficial.
- Documentação: `docs/CASHFLOW_RULES.md`, `docs/METRICS.md`.
