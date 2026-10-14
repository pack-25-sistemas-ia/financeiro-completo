---
name: financial-security
description: Use ao criar tabela, política, função, rota, anexo ou exportação que toque dados financeiros ou cruze empresas.
---

# Segurança financeira e LGPD

- Toda tabela: `organization_id`, RLS ligada, FKs compostas `(id, organization_id)`. Escrita de livro/títulos só por função `fin_*` (SECURITY DEFINER, `search_path` vazio) que começa com `private.fin_guard(org, nível)` (sessão + MFA + papel).
- Visões `security_invoker`. Nunca `service_role` no app nem em variável pública.
- Perfis: administrador (owner/admin), gestor (manager), analista (member), consulta (viewer). Analista não faz baixa, estorno nem transferência (D-F11). A interface esconde; o banco decide.
- Anexo: bucket privado, caminho opaco `<org>/<uuid>.<ext>`, tipo pelos bytes, PDF ativo recusado, URL assinada de 60 s só depois de o banco autorizar. Em política de `storage.objects`, use `objects.name`.
- Exportação: só gestão, auditada (quem, qual relatório, quantas linhas — nunca valores), CSV neutralizado.
- Logs e auditoria sem valores, CPF/CNPJ ou nomes. Seed só com dados fictícios (`@demo.exemplo`).
- Cuidado com PGRST201: tabela nova com FK para `organization_members` e `organizations` quebra o embed do Core; o teste 61 pega.
- Prove com: `supabase/tests/61_fin_access.sql` (A×B, MFA), E2E `fin-security`, `pnpm test:mutation`.
