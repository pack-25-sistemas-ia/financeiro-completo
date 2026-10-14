# CHANGELOG_INTERNAL — Gestão Financeira Empresarial

Histórico de construção (não é changelog de produto). Datas de 2026-10-13.

| Fase | O que entrou | Lição |
|---|---|---|
| 1 Pesquisa e plano | Auditoria de licenças (AGPL/GPL só como inspiração), decisões D-F1..D-F10, modelo financeiro, regras de dinheiro, fluxo de caixa, indicadores | O prompt colado veio truncado; a fonte íntegra é o Word (D-F10) |
| 2 Base | Core sincronizado, dependências extras, `system.config`, permissões, arquitetura | Layout do Core na raiz, sem `src/` (D-F1) |
| 3 Banco e motor | Migrações `fin_schema`, `fin_engine`, `fin_views_recurring`; funções de baixa, estorno, transferência, ajuste, parcelas, rateio, recorrência; testes SQL 60–63; concorrência | Sessões paralelas reais acharam um impasse que teste sequencial não acharia: travar a conta antes de inserir a baixa |
| 4 Importação e conciliação | `fin_import_recon`, wizard CSV, sugestões pontuadas, desfazer, resumo; teste 64 | Duplicidade precisa de dois hashes: arquivo e linha |
| 5 Apoio | Anexos privados, avisos, preferências, metas; teste 65 | PGRST201: FK dupla para `organization_members` e `organizations` derrubou o onboarding de todos (D-F18) |
| 6 Métricas e relatórios | `fin_metrics`, 10 indicadores, 10 gráficos, 15 relatórios, fluxo realizado/projetado; teste 66 com fixture de datas fixas e totais à mão | Teste de métrica não usa `now()`: o `p_today` é parâmetro |
| 7 Interface | 17 telas, formulários com idempotência, restauração de valores após erro, aviso de confirmação que sobrevive à atualização | React 19 reinicia o formulário após toda ação; `use-fin-action` reaplica o digitado |
| 8 Exportação | CSV auditado e neutralizado; teste 67 | Auditoria guarda quem/qual/quantas linhas, nunca valores |
| 9 Testes de ponta a ponta | `fin-demo`, `fin-flow`, `fin-security`, `fin-ui` (acessibilidade estrutural, celular, tema escuro) | Limitador de login: reaproveitar a sessão numa página compartilhada |
| 10 Fechamento | Documentação, skills internas, mutação ampliada (importação, conciliação, anexo, exportação, métricas), CI no hub, instalação isolada | — |
