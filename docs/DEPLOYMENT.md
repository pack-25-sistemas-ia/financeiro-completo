# DEPLOYMENT — Gestão Financeira Empresarial

Tudo é seu: seu projeto Supabase, seu repositório, sua hospedagem. Nada é enviado ao autor do Pack.

## Pré-requisitos
Node 22+, pnpm, Docker (só para o Supabase local e para `pnpm test:db`), conta Supabase (região **São Paulo** para dados pessoais) e hospedagem Node (ex.: Vercel).

## Variáveis (`.env.local`, nunca no git)
| Variável | Valor |
|---|---|
| `NEXT_PUBLIC_APP_URL` | URL pública do app |
| `NEXT_PUBLIC_SUPABASE_URL` | URL do seu projeto Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | chave publishable/anon (segura no navegador, limitada pelo RLS) |

O app **não usa** `service_role`. Não a coloque em variável alguma.

## Banco e Storage
1. **Local**: `supabase start` (o Storage precisa estar habilitado: `[storage] enabled = true` no `config.toml`) e `supabase db reset` (migrações + `seed.sql` fictício). As portas deste projeto são 583xx (`project_id = pack25-financeiro-completo`) para não colidir com outros projetos Supabase locais. Em máquina com pouca memória: `supabase start -x realtime,imgproxy,studio,edge-runtime,logflare,vector,supavisor,postgres-meta`.
2. **Produção**: `supabase link --project-ref <ref>` e `supabase db push`. **Não** aplique `seed.sql` em produção (cria usuários de demonstração). A migração cria o bucket privado `fin-attachments` (10 MB; PDF, PNG, JPEG) com políticas por empresa.
3. **Autenticação** no painel do Supabase: confirmação de e-mail ligada, senha mínima de 12, **TOTP (MFA) habilitado** — as operações financeiras exigem sessão com segunda etapa —, **SMTP próprio** e a URL do app em Redirect URLs.
4. **Rotinas agendadas** (recorrências e avisos). Ative a extensão `pg_cron` em *Database → Extensions* e agende: `select cron.schedule('fin-rotinas', '0 6 * * *', 'select private.fin_run_scheduled()');`. A função é idempotente (rodar duas vezes não duplica títulos nem avisos). Sem `pg_cron`, o app executa as mesmas rotinas ao abrir o painel ou as recorrências, quando a pessoa tem perfil de analista ou acima (`fin_run_routines`), então nada fica parado — só atrasa até alguém abrir o sistema.
5. **Backup e restauração**: use os backups diários do Supabase (e *Point-in-Time Recovery* em plano pago). O livro de movimentos é só-acréscimo, o que facilita conferência após restaurar: o saldo de cada conta deve fechar com saldo inicial + movimentos. Guarde também exportações CSV mensais fora do Supabase.
6. **Reversão (rollback)**: as migrações são só para frente. Para voltar, restaure o backup anterior à migração; não apague movimentos ou baixas à mão (os gatilhos de imutabilidade impedem e a correção correta é o estorno).

## Aplicação
`pnpm install --frozen-lockfile` → `pnpm lint && pnpm typecheck && pnpm test && pnpm build` → `pnpm start`.

**Corpo da requisição**: importações de CSV e anexos usam envios de até 12 MB no proxy e 6 MB em Server Actions (`next.config.ts`). Algumas hospedagens serverless limitam o corpo a 4,5 MB; nelas reduza o arquivo ou ajuste o limite da plataforma. Anexos têm teto de 10 MB no Storage.

**E2E**: `pnpm test:e2e` usa o Supabase local e o app **compilado** (`pnpm build && pnpm start -p 3123`, a porta do `site_url`). Copie as URLs/chaves de `supabase status` para `.env.e2e` (ignorado pelo git) com `E2E_SUPABASE_URL`, `E2E_SUPABASE_ANON_KEY`, `E2E_BASE_URL` e `E2E_MAILPIT_URL`.

**Windows**: use um caminho curto para a pasta (caminho longo quebra o Vitest/Vite).

## Dados de demonstração
Senha local única `DemoLocal#2026`, todos `@demo.exemplo`, empresa «Nova Horizonte Serviços Ltda.»: `dono@` (administrador), `gestor@` (gestor financeiro), `analista@`, `consulta@`. No primeiro acesso cada pessoa cadastra a verificação em duas etapas (TOTP); sem ela, as operações financeiras são recusadas pelo banco. `pnpm seed:gen` regenera `supabase/seed.sql` e `seed-plan.json` (tudo passa pelas funções `fin_*`, então o seed obedece às mesmas regras do app).

## Checklist de produção
- [ ] Região Brasil; backups ligados; MFA ligado; SMTP próprio; Redirect URLs.
- [ ] `seed.sql` **não** aplicado; nenhuma chave `service_role` em variável de ambiente.
- [ ] `pg_cron` agendado (ou aceita-se executar só ao abrir o painel).
- [ ] Revisar o texto de privacidade com seu jurídico (controlador = quem implanta).
- [ ] Antivírus no envio de anexos se receber arquivos de terceiros (o sistema confere o tipo real e recusa PDF ativo, mas **não** é antivírus).
