# ARCHITECTURE — Gestão Financeira Empresarial

Base: Core do Pack (Next.js 16 App Router, TypeScript strict, Tailwind 4, Supabase Auth/Postgres/Storage) sincronizado por `scripts/sync-core.mjs`. Layout na raiz, sem `src/` (D-F1).

## Camadas
| Camada | Onde | Responsabilidade |
|---|---|---|
| Presentation | `app/(app)/*`, `components/finance/*` | Telas, formulários (react-hook-form + Zod), tabelas (TanStack), gráficos (Recharts, só no navegador via `dynamic ssr:false`) |
| Application | `lib/finance/actions/*`, `action-kit.ts` | Server Actions: validam sessão, papel e entrada (Zod) e chamam o banco por RPC; nunca recalculam regra. `guarded()` padroniza papel, erro e auditoria |
| Domain | `lib/finance/{money,dates,filters,schemas,labels}.ts` | Funções puras espelho das regras do banco (distribuição de centavos, datas de parcelas, formatação BRL) para UI e testes |
| Infrastructure | `lib/finance/{data,dashboard,reports,csv,files,page}.ts`, `app/api/*`, `supabase/migrations` | Leituras Supabase, CSV, tipo real de arquivo, exportação, anexos assinados |

## Onde moram as regras
**No banco** (funções SQL transacionais + constraints + triggers de imutabilidade): baixa, estorno, transferência, parcelamento, rateio, recorrência, métricas. O TS só espelha para pré-visualização e é testado contra os mesmos casos. Nenhuma tela calcula saldo, pendente ou indicador por conta própria.

## Fluxo de uma baixa
Formulário → ação do servidor (sessão, papel, Zod) → RPC `fin_settle_installment(installment, account, amount, idempotency_key, …)` → `FOR UPDATE` na parcela e depois na conta → valida pendente → insere `settlements` + `account_movements` → auditoria → retorna resultado. Repetição com a mesma chave devolve a baixa original.

## Fronteiras de segurança
RLS em todas as tabelas por `organization_id`; chaves compostas; sem `service_role` no app; Storage privado com URL assinada curta; CSP e cabeçalhos do Core; logs sem PII nem valores.

## Execução agendada
Recorrência e alertas por função idempotente (`private.fin_run_scheduled()`), agendável com pg_cron; sem pg_cron o app roda `fin_run_routines` ao abrir o painel. Sem processo permanente.
