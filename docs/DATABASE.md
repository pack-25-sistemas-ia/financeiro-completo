# DATABASE — Modelo de dados e regras no banco

Sete migrações `20270601000000…0600` (`fin_schema`, `fin_engine`, `fin_views_recurring`, `fin_import_recon`, `fin_attachments_notifications`, `fin_metrics`, `fin_export_log`) sobre as do Core (organizações, membros, auditoria, MFA). Todo o dinheiro é `bigint` em **centavos** com teto de 99.999.999.999.999 (R$ 999.999.999.999,99). Nada de `float`/`numeric` para valores.

## Tabelas (todas com `organization_id`, RLS e FKs compostas `(id, organization_id)`)
| Grupo | Tabelas | Observações |
|---|---|---|
| Configuração | `fin_settings` | fuso (padrão America/Sao_Paulo), políticas da organização; criada por trigger ao criar a empresa |
| Contas | `financial_accounts`, `account_opening_history` | saldo inicial + data de abertura; toda alteração do saldo inicial gera histórico imutável |
| Cadastros | `financial_categories`, `cost_centers`, `counterparties` | categoria com até 3 níveis, natureza (receita/despesa) imutável (receita/despesa); contraparte cliente/fornecedor/ambos; arquivar em vez de apagar |
| Títulos | `financial_entries`, `financial_installments`, `financial_allocations` | soma das parcelas = valor do título e soma do rateio = valor do título (constraint triggers) |
| Livro | `settlements`, `account_movements`, `transfers`, `balance_adjustments` | só-acréscimo; origem do movimento = exatamente uma de baixa, transferência ou ajuste |
| Recorrência | `recurring_rules`, `recurring_occurrences` | `unique (rule_id, scheduled_date)`: gerar duas vezes não duplica |
| Importação | `imports`, `import_rows`, `bank_statement_lines`, `reconciliation_matches` | hashes de arquivo e de linha; conciliação sem alterar o livro |
| Apoio | `attachments`, `fin_notifications`, `fin_notification_prefs`, `financial_goals` | anexo ligado a título/baixa/conta; a exportação CSV é registrada na auditoria do Core (`audit_log`) |

Visões (todas `security_invoker`, herdam o RLS de quem consulta): `fin_account_balances` (saldo calculado), `fin_installments_view` (pendente, pago, atraso derivado), `fin_movements_view`.

## Imutabilidade e integridade
- `settlements`, `account_movements`, `account_opening_history`, `reconciliation_matches` (exceto o estado «desfeita»), `recurring_occurrences`: gatilho `fin_append_only` bloqueia UPDATE/DELETE; `fin_no_delete` bloqueia DELETE em cadastros e cabeçalhos (arquivar, nunca apagar).
- Guardas por gatilho (`settlement_guard`, `transfer_guard`, `entry_guard`, `installment_guard`, `account_guard`, `category_guard`, `statement_guard`, `match_guard`, `import_row_guard`, `attachment_guard`) impedem: baixa acima do pendente, baixa em título cancelado, movimento em conta de outra empresa, categoria incompatível com a natureza, ciclo de categorias, saldo negativo em conta marcada «sem saldo negativo» (`allow_negative = false`).
- Constraint triggers de soma (`chk_entry_sums_*`) rodam no fim da transação, validando parcelas e rateio já completos.
- Auditoria: `private.audit_trigger` registra quem/quando/o quê **sem valores monetários nem documentos** nos logs.

## Funções de negócio (`public.fin_*`, SECURITY DEFINER, `search_path` vazio)
Cada uma começa com `private.fin_guard(org, nível)`: exige sessão autenticada, **MFA** (AAL2), pertencimento à empresa e o papel mínimo. A interface apenas esconde botões; quem decide é o banco.

| Área | Funções (nível mínimo) |
|---|---|
| Contas | `fin_create_account`, `fin_update_account`, `fin_archive_account`, `fin_unarchive_account` (gestor); `fin_set_opening_balance` (administrador) |
| Títulos | `fin_create_entry`, `fin_update_entry`, `fin_replan_entry`, `fin_set_allocations`, `fin_reschedule_installment` (analista); `fin_cancel_entry`, `fin_archive_entry` (gestor) |
| Dinheiro | `fin_settle_installment`, `fin_reverse_settlement`, `fin_create_transfer`, `fin_reverse_transfer`, `fin_create_adjustment` (gestor) |
| Recorrência | `fin_create_recurring_rule`, `fin_update_recurring_rule`, `fin_pause_/resume_/end_recurring_rule`, `fin_generate_recurring`, `fin_run_routines` (analista) |
| Importação/conciliação | `fin_create_import`, `fin_commit_import` (analista; histórico = gestor), `fin_cancel_import`, `fin_suggest_matches`, `fin_reconcile` (analista), `fin_undo_reconciliation` (gestor), `fin_ignore_/unignore_statement_line` |
| Anexos e avisos | `fin_register_attachment`, `fin_archive_attachment`, `fin_mark_notifications_read`, `fin_set_notification_pref` |
| Leitura | `fin_dashboard_kpis`, `fin_dashboard_series`, `fin_cashflow_opening/realized/projection`, `fin_report_*`, `fin_reconciliation_summary` (leitura); `fin_log_export` (gestor) |

Funções auxiliares em `private` (não expostas pela API): `fin_distribute` (rateio por maior resto), `fin_round_div` (meio-para-o-par), `fin_due_dates` (datas de parcelas), `fin_post_movement` (única porta de escrita no livro), `fin_balance`, `fin_pending`, `fin_planned`, `fin_realized`, `fin_projection`.

## Concorrência
Ordem fixa de travas: **parcela → conta**; transferências travam as duas contas **ordenadas por id** (sem impasse). A baixa trava a conta *antes* de inserir (evita o impasse que `test:concurrency` encontrou). Idempotência por `idempotency_key` única por organização: repetir devolve a operação original. Estorno exige `reversed_at is null`, então estorno × pagamento simultâneos têm um único vencedor consistente.

## RLS
Toda tabela: SELECT para membros que podem ler. Cadastros simples (categorias, centros de custo, contrapartes) têm políticas de INSERT/UPDATE por papel e uma política restritiva exigindo MFA; as tabelas do livro e dos títulos não têm escrita direta para `authenticated` (a escrita passa pelas funções). Storage: `storage.objects` do bucket `fin-attachments` só acessa o caminho `<org>/…` de quem é da empresa (leitura) e analista com MFA (escrita). Teste `61_fin_access.sql` prova negação A×B para cada tabela e função.

## Testes SQL (`pnpm test:db`)
60 dinheiro/datas · 61 acesso, RLS A×B, MFA e anti-PGRST201 · 62 motor (baixa, estorno, transferência, ajuste, parcelas, rateio, imutabilidade) · 63 recorrência · 64 importação e conciliação · 65 anexos, avisos, metas · 66 métricas com datas fixas (`p_today = 2025-06-15`) e totais calculados à mão · 67 log de exportação. Concorrência real em `scripts/test-concurrency.mjs`; mutação em `scripts/mutation-check.mjs`.
