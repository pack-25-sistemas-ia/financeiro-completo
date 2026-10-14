---
name: reconciliation
description: Use ao mexer em importação de CSV, linhas de extrato, sugestões ou conciliação.
---

# Importação e conciliação

- Importar = prévia (nada vai ao livro) → confirmar (só linhas válidas, uma transação, idempotente). Duplicidade por hash do arquivo (SHA-256) e por hash normalizado da linha.
- CSV: UTF-8 ou Windows-1252, separador detectado, máximo 5.000 linhas e 12 MB. Erros vão para relatório baixável. Exportação neutraliza fórmulas (`=`, `+`, `-`, `@`).
- Conciliar **só liga** linha de extrato a movimento existente; não cria nem altera movimento. Mesma conta, mesmo sinal, 1-para-1; valor diferente exige justificativa (≥ 5 caracteres).
- Sugestão (`fin_suggest_matches`): valor igual 70, mesma referência +30, até +10 por proximidade de data; ambígua nunca é automática.
- Desfazer é do gestor, com motivo, e preserva histórico. Analista concilia.
- Prove com: `supabase/tests/64_fin_import_recon.sql`, `tests/unit/finance-csv.test.ts`, E2E `fin-flow`. Documentação: `docs/RECONCILIATION.md`.
