# AGENTS — Gestão Financeira Empresarial

Sistema 06 do Pack 25 Sistemas IA (financeiro-completo). O status real vive em MEMORY.md.

## Regras perenes
- Esta pasta é autossuficiente: nada importa de fora dela, sem workspace:*, sem citar outros sistemas.
- Ler MEMORY.md antes de trabalhar; atualizar ao concluir marcos, só com fatos comprovados.
- Toda tabela de negócio tem organization_id + RLS; toda mutação valida sessão, papel e entrada (Zod) no servidor e chama função `fin_*`.
- Nunca commitar segredos; o app não usa service-role; jamais com prefixo NEXT_PUBLIC_.
- Dados pessoais mínimos; sem PII nem valores em logs; sem dados reais de cliente em seed.
- Não declarar pronto sem evidência (comando + resultado). Se algo não foi executado, escrever NÃO EXECUTADO.

## Comandos
pnpm install --frozen-lockfile · pnpm lint · pnpm typecheck · pnpm test · pnpm build · pnpm test:db (Docker) · pnpm test:concurrency · pnpm test:mutation · pnpm test:e2e (Supabase local + app **recompilado**, porta 3123) · pnpm seed:gen

## Regras do sistema
- **Dinheiro**: `bigint` em centavos, nunca float. Soma/rateio só por `lib/finance/money` (TS) e `private.fin_distribute`/`fin_round_div` (SQL), espelhados e testados com os mesmos casos. `decimal.js` só em taxas.
- Três conceitos: título/parcela (previsto) → baixa (`settlements`) → movimento (`account_movements`). Saldo = saldo inicial + soma dos movimentos; não existe coluna de saldo mantida à mão.
- Movimentos, baixas e histórico de saldo inicial são imutáveis (trigger). Correção = estorno/compensação. Baixa e transferência exigem chave de idempotência.
- Transferência e ajuste nunca entram em receita/despesa. Atraso é derivado.
- O que importa mora no BANCO: baixa, estorno, parcelamento, rateio, recorrência, métricas, conciliação. `lib/finance/*` espelha só para a tela. Nenhuma tela calcula saldo, pendente ou indicador por conta própria.
- Funções `fin_*` são SECURITY DEFINER e começam por `private.fin_guard(org, nível)` (MFA + papel). Visões são `security_invoker`. FKs compostas `(id, organization_id)`.
- Tabela nova com FK para `organization_members` **e** para `organizations` torna o embed do Core ambíguo (PGRST201 e todos caem no onboarding): o teste 61 impede.
- Anexos: bucket privado `fin-attachments`, caminho opaco `<org>/<uuid>.<ext>`, tipo pelos bytes, URL assinada de 60 s só após o banco autorizar. CSV exportado neutraliza fórmulas e é auditado.
- CSP estrita: sem estilo em linha; gráficos só no navegador.
- Mudou regra crítica de banco: rode `pnpm test:mutation` (todas as mutações devem morrer; crie mutação nova para regra nova).
- Cuidados: `String.replace` com `$$` corrompe SQL (use Edit ou função); React 19 reinicia formulários após toda ação (veja `use-fin-action.ts`); logins repetidos nos E2E esbarram no limitador (reaproveite a sessão); não pare containers Supabase de outros projetos.

## Definição de pronto (resumo)
Migrações em banco limpo, seed reproduzível, teste RLS A/B negando acesso cruzado, concorrência real, mutação, fluxos críticos em Playwright, mobile e desktop revisados, licenças e segredos verificados, instalação isolada validada, docs e MEMORY.md atualizados.
