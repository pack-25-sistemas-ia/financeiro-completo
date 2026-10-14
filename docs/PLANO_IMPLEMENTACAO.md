# PLANO_IMPLEMENTACAO — Gestão Financeira Empresarial

| Fase | Entrega | Verificação |
|---|---|---|
| 1. Diagnóstico | Auditoria open source, modelo, decisões, plano | Licenças conferidas (`gh`/`npm`) |
| 2. Fundação | `sync-core`, papéis, layout, tema, package.json, job de CI | lint, tipos, build, test:db do Core |
| 3. Motor financeiro (banco primeiro) | Migrações: contas, contrapartes, categorias, centros, títulos, parcelas, baixas, movimentos, transferências, estornos, auditoria, RLS; funções de baixa/estorno/transferência/parcelamento | Testes SQL com fixtures à mão (concorrência, idempotência, RLS A/B) + mutação |
| 4. Libs TS | `lib/finance/money`, parcelamento, rateio, recorrência, projeção | Vitest (centavos, zero, valores grandes, bissexto, fim de mês) |
| 5. Cadastros e operações | Contas, pagar, receber, transferências, categorias, centros | E2E |
| 6. Recorrência, CSV, conciliação, anexos | Dedup por hash, prévia, proteção a fórmulas no CSV, Storage privado | SQL + E2E |
| 7. Dashboard, fluxos, relatórios, notificações | Métricas no backend, `METRICS.md`, `CASHFLOW_RULES.md` | Totais das fixtures = esperados |
| 8. Seed (Nova Horizonte Serviços Ltda.), docs, CI, export isolado | Instalação isolada | Checklist VALIDADO do AGENTS |

Riscos tratados desde o início: baixa duplicada ou concorrente, estorno repetido, transferência entre organizações, saldo inicial alterado, importação repetida, vazamento entre empresas, CSV com fórmulas, valores vindos do front, comprovante por ID adivinhado.

Fora do MVP: contabilidade e fiscal, integração bancária, conciliação automática, aprovação multinível.
