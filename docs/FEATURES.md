# FEATURES — Gestão Financeira Empresarial
Status: VERIFIED (com evidência: arquivo/teste), FORA DO MVP ou LIMITE DOCUMENTADO. Nesta versão todos os fluxos abaixo estão VERIFIED.
Siglas de evidência: **SQL** = `supabase/tests/NN_*.sql` (`pnpm test:db`); **CONC** = `scripts/test-concurrency.mjs`; **UNIT** = `tests/unit/*`; **E2E** = `tests/e2e/*` (Playwright contra Supabase local).

| Fluxo | Status | Evidência |
|---|---|---|
| Contas financeiras e saldo calculado (saldo inicial + movimentos) | VERIFIED | SQL 62; E2E fin-flow (contas, extrato) |
| Alteração de saldo inicial só administrador, com histórico | VERIFIED | SQL 61, 62; E2E fin-security |
| Contas a pagar: título, parcelas, rateio, edição, cancelamento | VERIFIED | SQL 60, 62; UNIT finance-money; E2E fin-flow |
| Contas a receber | VERIFIED | SQL 62; E2E fin-flow |
| Baixa total/parcial com idempotência (sem baixa duplicada) | VERIFIED | SQL 62; CONC (baixas simultâneas); E2E fin-flow |
| Estorno de baixa por movimento compensatório | VERIFIED | SQL 62; CONC (estorno × pagamento); E2E fin-flow |
| Livro de movimentos imutável (UPDATE/DELETE bloqueados) | VERIFIED | SQL 62; mutação |
| Transferências entre contas e estorno | VERIFIED | SQL 62; CONC (sem impasse); E2E fin-flow |
| Ajustes de saldo com motivo | VERIFIED | SQL 62 |
| Atraso derivado e reagendamento de parcela | VERIFIED | SQL 62, 66 |
| Categorias, subcategorias e centros de custo | VERIFIED | SQL 61, 62, 66; telas abertas em E2E fin-ui |
| Clientes e fornecedores | VERIFIED | SQL 61; E2E fin-flow (cliente criado), fin-ui |
| Recorrências idempotentes | VERIFIED | SQL 63; E2E fin-flow |
| Fluxo de caixa realizado | VERIFIED | SQL 66; E2E fin-demo |
| Fluxo de caixa projetado (3 cenários) | VERIFIED | SQL 66; E2E fin-demo |
| Painel: 10 indicadores e 10 gráficos | VERIFIED | SQL 66 (totais à mão); E2E fin-demo |
| 15 relatórios + Resumo Gerencial de Receitas e Despesas | VERIFIED | SQL 66; UNIT finance-csv; E2E fin-flow |
| Exportação CSV auditada e neutralização de fórmulas | VERIFIED | SQL 67; UNIT finance-csv; E2E fin-flow, fin-security |
| Importação de CSV (extrato, títulos, histórico), prévia, duplicidade, erros | VERIFIED | SQL 64; UNIT finance-csv; E2E fin-flow |
| Conciliação manual com sugestões, desfazer, ignorar linha | VERIFIED | SQL 64; E2E fin-flow |
| Anexos privados, tipo pelos bytes, URL assinada de 60 s | VERIFIED | SQL 65; UNIT finance-files; E2E fin-flow, fin-security |
| Avisos (vencimento, atraso, saldo negativo, recorrência, importação) e preferências | VERIFIED | SQL 65; E2E fin-flow |
| Metas financeiras | VERIFIED | SQL 65 |
| Isolamento entre empresas (RLS A×B) e MFA nas operações | VERIFIED | SQL 61; E2E fin-security |
| Perfis: administrador, gestor, analista, consulta | VERIFIED | SQL 61; E2E fin-security |
| Acessibilidade estrutural, celular (sem rolagem lateral) e tema escuro | VERIFIED | E2E fin-ui |
| Seed reproduzível «Nova Horizonte Serviços Ltda.» | VERIFIED | `pnpm seed:gen`; E2E fin-demo |
