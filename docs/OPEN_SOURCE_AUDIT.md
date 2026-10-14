# OPEN_SOURCE_AUDIT — Gestão Financeira Empresarial

Pesquisa de 2026-10-13 (API do GitHub via `gh` e `npm view`). «Incorporado» = código copiado para este repositório. **Nenhum código de terceiros foi incorporado** (verificado na entrega final); se isso mudar, registre commit e atribuição em `THIRD_PARTY_NOTICES.md` do hub.

| Projeto | Licença (confirmada) | Estrelas | Último push | Papel | Decisão |
|---|---|---|---|---|---|
| Actual Budget | MIT | ~29,5 mil | 2026-10-13 | Referência: saldos, reconciliação, importação, testes monetários | **Só referência** (produto pessoal; regras próprias em SQL). Nada copiado |
| Bigcapital | **AGPL-3.0** | ~3,9 mil | 2026-10-11 | Referência: A pagar/receber, conciliação | **Só inspiração funcional.** Nada incorporado |
| ERPNext | **GPL-3.0** | ~40,1 mil | 2026-10-13 | Referência: centros de custo, processos | **Só inspiração.** Nada incorporado |
| Firefly III | **AGPL-3.0** | ~24,9 mil | 2026-10-13 | Referência: transferências, regras | **Só inspiração.** Nada incorporado |
| Dinero.js | MIT (npm 2.0.2) | ~6,8 mil | 2026-10-13 | Dinheiro tipado | **Avaliado**; ver D-F2 (módulo próprio mínimo) |
| Decimal.js | MIT (npm 10.6.0) | ~7,3 mil | 2026-08-30 | Taxas, percentuais | **Usar** só em taxas/percentuais; fronteiras convertem para centavos inteiros |
| Kill Bill | Apache-2.0 | ~5,8 mil | 2026-10-12 | Referência: recorrência, idempotência | **Só referência** de modelagem |
| shadcn/ui | MIT | ~125 mil | 2026-10-12 | Kit de UI | **Não adotado** (Core tem kit próprio; D-F1) |
| TanStack Table | MIT (8.21.3 usado no Pack; npm latest 9.3.1) | ~28,5 mil | 2026-10-12 | Tabelas | **Usar** 8.21.3 (alinhado ao Pack) |
| Akaunting | **NOASSERTION** (BSL 1.1 + restrições) | ~10,2 mil | 2026-10-08 | Conceitual | **Não utilizado** |
| Maybe Finance | **AGPL-3.0**, **arquivado** | ~54 mil | 2025-07-24 | Visual/histórico | **Não utilizado** |

Dependências novas sobre o Core: `recharts`, `react-hook-form` + `@hookform/resolvers`, `@tanstack/react-table`, `decimal.js`, `date-fns` — todas MIT (confirmadas com `npm view`; versões fixadas ao instalar).

## Riscos
AGPL/GPL (Bigcapital, ERPNext, Firefly III, Maybe) são incompatíveis com a distribuição pretendida; semelhanças de fluxo são ideias gerais, reimplementadas em SQL. Akaunting tem licença mista/restritiva. Maybe está arquivado.

## Situação final
Dependências de produção (`pnpm licenses list --prod`, 73 pacotes): MIT 54, ISC 12, Apache-2.0 2, BSD-3-Clause 2, 0BSD 1, MIT AND ISC 1, CC-BY-4.0 1 (`caniuse-lite`, dados de compatibilidade usados só na compilação). Nenhuma AGPL/GPL/SSPL/BSL. Nenhum trecho de Actual Budget, Bigcapital, ERPNext, Firefly III, Maybe ou Akaunting foi copiado: o modelo (título → baixa → movimento), a conciliação e a importação foram desenhados a partir do prompt e implementados em SQL próprio.
