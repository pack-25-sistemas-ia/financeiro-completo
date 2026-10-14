# MEMORY — GESTÃO FINANCEIRA EMPRESARIAL (financeiro-completo)
Atualizado em: 2026-10-13 | Versão: 0.1.0 | Estado: VALIDADO (instalação isolada conferida em 2026-10-13)

## Missão do sistema
Contas a pagar e receber em planilhas, sem visão de caixa. Público: pequenas empresas sem ERP. Valor: controle de contas, categorias e fluxo de caixa com lançamentos auditáveis.

## Stack e caminhos-chave
Next.js 16 (App Router) + TypeScript strict + Tailwind 4 + Supabase (Auth, Postgres/RLS, Storage); layout do Core na raiz (D-F1). Extras: recharts, react-hook-form, @tanstack/react-table 8.21.3, decimal.js, date-fns.
Banco: `supabase/migrations/20270601000000…0600` (fin_*), testes `supabase/tests/60–67`. Regras no banco; TS espelha (`lib/finance`). Ações em `lib/finance/actions`, telas em `app/(app)`, componentes em `components/finance`.
Comandos: pnpm lint | typecheck | test | build | test:db (Docker) | test:concurrency | test:mutation | test:e2e | seed:gen.

## Escopo contratado do MVP
Contas a pagar; contas a receber; lançamentos imutáveis com estorno; categorias; fluxo de caixa; relatórios; exportação CSV.
Fora do escopo: contabilidade; emissão fiscal; conciliação bancária automática (Open Finance).

## Implementado e verificado (2026-10-13)
- Banco: 7 migrações; testes SQL 60–67 verdes (cenários à mão: dinheiro, acesso A×B/MFA, motor, recorrência, importação+conciliação, anexos/avisos/metas, métricas com `p_today` fixo, log de exportação). Concorrência real (`test:concurrency`) verde.
- App: 17 telas, rotas API (anexos, exportação, erros de importação), CSP estrita. lint 0 erros, typecheck, 139 testes unitários (6 arquivos) e build verdes.
- E2E contra Supabase local real (portas 583xx) e app compilado (3123): fin-demo 6/6, fin-flow 13/13, fin-security 12/12, fin-ui 5 ok + 1 opcional (capturas, `E2E_SHOTS=1`).
- Docs finais: README, AGENTS, FEATURES (todos VERIFIED com evidência), DATABASE, RECONCILIATION, DEPLOYMENT, METRICS (dados de conferência), PERMISSIONS, ARCHITECTURE, DECISIONS (D-F1..D-F18), OPEN_SOURCE_AUDIT, CHANGELOG_INTERNAL; skills em `.agents/skills`.
- CI no hub: jobs `financeiro-db`, `financeiro-web`, `financeiro-e2e` (NÃO EXECUTADOS no GitHub ainda).

## Verificação final (2026-10-13)
- Cópia isolada (export-system → pnpm install --frozen-lockfile): lint, typecheck, 139 unit, build, test:db (Core + 60–67), test:concurrency e E2E 49/49 (core-flow 5, email-flows 3, security 5, fin-demo 6, fin-flow 13, fin-security 12, fin-ui 5), rodados por arquivo.
- Mutação: 59/59 reprovadas na pasta de origem; na cópia, 58/59 numa rodada com E2E rodando em paralelo (a mutação «baixa sem travar a parcela» depende de execução simultânea real e sobreviveu sob carga) e 3/3 reprovadas ao repetir sem carga. Rode a mutação sem outras cargas. A política de Storage dos anexos não entra na mutação (exige schema storage): coberta pelo E2E fin-security.
- Suíte E2E inteira num único comando falhou duas vezes por causas de ambiente (servidor local encerrado no Windows com pouca memória livre e limitador de login), não por regra do sistema; por arquivo, tudo passa.
- NÃO EXECUTADO: CI do GitHub para os jobs financeiro-* (só após o push); antivírus de anexos (fora do escopo).
- Risco LGPD: alto (nome, CPF/CNPJ opcional, dados financeiros).

## Armadilhas aprendidas
- PGRST201: FK dupla para `organization_members` e `organizations` quebra o embed do Core (teste 61 impede).
- React 19 reinicia formulários após toda ação (`use-fin-action.ts` restaura valores).
- Baixa precisa travar a conta antes de inserir (impasse achado só em concorrência real).
- `String.replace` com `$$` corrompe SQL; heredoc/`node -e` do shell consomem crases (use Write/Edit).
- Limitador de login (8/10 min): E2E reaproveita sessão. Subir app antigo na 3123 mascara build novo: matar por porta e recompilar.
- Ambiente local: Supabase CLI 2.120.0; `supabase start -x realtime,imgproxy,studio,edge-runtime,logflare,vector,supavisor,postgres-meta`; não parar containers de outros projetos.

## Próxima tarefa recomendada
Conferir o CI no GitHub após o push dos jobs financeiro-*; manter FEATURES e evidências ao evoluir; rodar test:mutation sem outras cargas.
