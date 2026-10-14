-- Importação CSV (prévia → confirmação), deduplicação, extrato e conciliação manual. Totais esperados calculados à mão.
-- Atores: OA (dono, aal2), MA (gestor), NA (analista), VA (consulta); empresa B: OB.

\set as_oa 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a0","aal":"aal2","email":"oa@t.invalid"}'', true); set local role authenticated;'
\set as_ma 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a1","aal":"aal1","email":"ma@t.invalid"}'', true); set local role authenticated;'
\set as_na 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a2","aal":"aal1","email":"na@t.invalid"}'', true); set local role authenticated;'
\set as_va 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a3","aal":"aal1","email":"va@t.invalid"}'', true); set local role authenticated;'
\set as_ob 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000b0","aal":"aal2","email":"ob@t.invalid"}'', true); set local role authenticated;'

begin;

create function test.errmsg(q text) returns text language plpgsql as $$ begin execute q; return null; exception when others then return sqlerrm; end $$;
create function test.t(k text) returns uuid language sql as $$ select current_setting('t.' || k)::uuid $$;
create function test.today() returns date language sql as $$ select (now() at time zone 'America/Sao_Paulo')::date $$;
create function test.h(seed text) returns text language sql as $$ select encode(sha256(convert_to(seed, 'UTF8')), 'hex') $$;
create function test.row(n integer, seed text, data jsonb, extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('row_number', n, 'reference', 'r' || n, 'hash', test.h(seed), 'data', data) || extra $$;
create function test.bal(a uuid) returns bigint language sql as $$ select balance_cents from public.fin_account_balances where account_id = a $$;
grant execute on all functions in schema test to anon, authenticated;

insert into auth.users (id, email) values
  ('ffffffff-0000-4000-8000-0000000000a0', 'oa@t.invalid'), ('ffffffff-0000-4000-8000-0000000000a1', 'ma@t.invalid'), ('ffffffff-0000-4000-8000-0000000000a2', 'na@t.invalid'),
  ('ffffffff-0000-4000-8000-0000000000a3', 'va@t.invalid'), ('ffffffff-0000-4000-8000-0000000000b0', 'ob@t.invalid');

:as_oa
do $$
declare org uuid;
begin
  org := public.create_organization('Empresa Importadora', 'empresa-imp');
  insert into public.organization_members (organization_id, user_id, role) values
    (org, 'ffffffff-0000-4000-8000-0000000000a1', 'manager'), (org, 'ffffffff-0000-4000-8000-0000000000a2', 'member'), (org, 'ffffffff-0000-4000-8000-0000000000a3', 'viewer');
  perform set_config('t.org', org::text, true);
  perform set_config('t.banco', public.fin_create_account(org, 'Banco', 'checking', null, 0, test.today() - 90)::text, true);
  perform set_config('t.caixa', public.fin_create_account(org, 'Caixa', 'cash', null, 0, test.today() - 90)::text, true);
end $$;
reset role;
:as_ob
do $$ begin perform public.create_organization('Empresa B', 'empresa-b'); end $$;
reset role;

-- ===================================================================== 1. contas a pagar por CSV: prévia, erros, duplicidade, confirmação
:as_na
do $$
declare org uuid := test.t('org'); r jsonb; imp uuid; res jsonb; rows_ jsonb;
begin
  rows_ := jsonb_build_array(
    test.row(1, 'p1', jsonb_build_object('description', 'Papel A4', 'amount_cents', 12345, 'issue_date', test.today() - 5, 'due_date', test.today() + 10, 'counterparty_name', 'Papelaria X', 'category_name', 'Fornecedores')),
    test.row(2, 'p2', jsonb_build_object('description', 'Toner', 'amount_cents', 50000, 'issue_date', test.today() - 5, 'due_date', test.today() + 20, 'counterparty_name', 'Papelaria X')),
    test.row(3, 'p3', jsonb_build_object('description', 'Data ruim', 'amount_cents', 100, 'issue_date', '2024-13-45', 'due_date', test.today())),
    test.row(4, 'p4', jsonb_build_object('description', 'Valor zero', 'amount_cents', 0, 'issue_date', test.today(), 'due_date', test.today())),
    test.row(5, 'p1', jsonb_build_object('description', 'Papel A4 (repetida no arquivo)', 'amount_cents', 12345, 'issue_date', test.today() - 5, 'due_date', test.today() + 10)),
    test.row(6, 'p6', '{}'::jsonb, jsonb_build_object('parse_error', 'valor «abc» não é um número')),
    test.row(7, 'p7', jsonb_build_object('description', 'Categoria inexistente', 'amount_cents', 700, 'issue_date', test.today(), 'due_date', test.today() + 1, 'category_name', 'Inexistente')),
    test.row(8, 'p8', jsonb_build_object('description', 'Vence antes de emitir', 'amount_cents', 800, 'issue_date', test.today(), 'due_date', test.today() - 3)));
  r := public.fin_create_import(org, 'payables', 'pagar.csv', test.h('file-pagar'), null, rows_);
  imp := (r ->> 'import_id')::uuid;
  perform set_config('t.imp1', imp::text, true);
  assert r = jsonb_build_object('duplicate_file', false, 'import_id', imp, 'status', 'previewed', 'total', 8, 'valid', 3, 'duplicates', 1, 'errors', 4), 'prévia: 3 válidas, 1 repetida, 4 erros: ' || r::text;
  assert (select status from public.import_rows where import_id = imp and row_number = 3) = 'error' and (select error_message from public.import_rows where import_id = imp and row_number = 3) like '%data inválida%', 'data inválida acusada';
  assert (select error_message from public.import_rows where import_id = imp and row_number = 4) like '%valor inválido%', 'valor zero acusado';
  assert (select status from public.import_rows where import_id = imp and row_number = 5) = 'duplicate', 'linha repetida no arquivo marcada';
  assert (select error_message from public.import_rows where import_id = imp and row_number = 6) like '%não é um número%', 'erro de leitura do app preservado';
  assert (select error_message from public.import_rows where import_id = imp and row_number = 8) like '%vencimento anterior%', 'vencimento antes da emissão';
  -- a PRÉVIA não cria nada
  assert (select count(*) from public.financial_entries) = 0 and (select count(*) from public.counterparties) = 0, 'prévia não cria títulos nem contrapartes';
  -- confirmar
  res := public.fin_commit_import(imp);
  assert res ->> 'accepted' = '2' and res ->> 'failed_on_commit' = '1' and res ->> 'rejected' = '6', 'confirmação: 2 aceitas, 1 falhou ao criar, 6 rejeitadas no total: ' || res::text;
  assert (select count(*) from public.financial_entries where entry_type = 'payable') = 2, 'dois títulos criados';
  assert (select amount_cents from public.financial_entries where description = 'Papel A4') = 12345, 'valor em centavos preservado';
  assert (select count(*) from public.counterparties where name = 'Papelaria X' and kind = 'supplier') = 1, 'fornecedor criado uma vez, mesmo usado em duas linhas';
  assert (select category_id is not null from public.financial_entries where description = 'Papel A4'), 'categoria vinculada';
  assert (select error_message from public.import_rows where import_id = imp and row_number = 7) like '%categoria «Inexistente» não encontrada%', 'linha com categoria inexistente rejeitada na confirmação';
  assert (select status from public.imports where id = imp) = 'completed', 'importação concluída';
  assert test.errmsg(format($q$select public.fin_commit_import(%L)$q$, imp)) like '%já foi processada%', 'confirmar de novo é recusado';
  -- mesmo arquivo de novo
  r := public.fin_create_import(org, 'payables', 'pagar-copia.csv', test.h('file-pagar'), null, rows_);
  assert (r ->> 'duplicate_file')::boolean and (r ->> 'import_id')::uuid = imp, 'arquivo repetido (mesmo conteúdo) é reconhecido';
  assert (select count(*) from public.imports) = 1, 'nenhuma importação nova criada';
  -- outro arquivo contendo uma linha já importada
  r := public.fin_create_import(org, 'payables', 'pagar2.csv', test.h('file-pagar-2'), null, jsonb_build_array(
    test.row(1, 'p1', jsonb_build_object('description', 'Papel A4', 'amount_cents', 12345, 'issue_date', test.today() - 5, 'due_date', test.today() + 10)),
    test.row(2, 'p9', jsonb_build_object('description', 'Grampeador', 'amount_cents', 2500, 'issue_date', test.today(), 'due_date', test.today() + 5))));
  assert (r ->> 'duplicates')::integer = 1 and (r ->> 'valid')::integer = 1, 'linha já importada em outro arquivo vira duplicada';
  perform public.fin_cancel_import((r ->> 'import_id')::uuid);
  assert (select status from public.imports where id = (r ->> 'import_id')::uuid) = 'cancelled', 'prévia pode ser cancelada';
  assert test.errmsg(format($q$select public.fin_commit_import(%L)$q$, (r ->> 'import_id')::uuid)) like '%já foi processada%', 'prévia cancelada não confirma';
  raise notice 'PASS: importar contas a pagar — prévia sem efeito, erros por linha, repetição no arquivo/entre arquivos, arquivo repetido, confirmação atômica';
end $$;
reset role;

-- ===================================================================== 2. contas a receber, clientes e fornecedores
:as_na
do $$
declare org uuid := test.t('org'); r jsonb; imp uuid; res jsonb;
begin
  -- «Papelaria X» já existe como FORNECEDOR: usar como cliente de uma conta a receber é recusado na confirmação
  r := public.fin_create_import(org, 'receivables', 'receber.csv', test.h('file-receber'), null, jsonb_build_array(
    test.row(1, 'r1', jsonb_build_object('description', 'Projeto Beta', 'amount_cents', 900000, 'issue_date', test.today() - 3, 'due_date', test.today() + 15, 'counterparty_name', 'Cliente Beta', 'category_name', 'Serviços')),
    test.row(2, 'r2', jsonb_build_object('description', 'Venda errada', 'amount_cents', 1000, 'issue_date', test.today(), 'due_date', test.today() + 1, 'counterparty_name', 'Papelaria X'))));
  imp := (r ->> 'import_id')::uuid;
  res := public.fin_commit_import(imp);
  assert res ->> 'accepted' = '1' and res ->> 'failed_on_commit' = '1', 'recebíveis: 1 aceita e 1 rejeitada por tipo oposto: ' || res::text;
  assert (select error_message from public.import_rows where import_id = imp and row_number = 2) like '%tipo oposto%', 'contraparte de tipo oposto';
  assert (select kind from public.counterparties where name = 'Cliente Beta') = 'customer', 'cliente criado como cliente';

  r := public.fin_create_import(org, 'customers', 'clientes.csv', test.h('file-clientes'), null, jsonb_build_array(
    test.row(1, 'c1', jsonb_build_object('name', 'Cliente Gama', 'document_number', '12345678000199', 'email', 'gama@gama.invalid')),
    test.row(2, 'c2', jsonb_build_object('name', 'Cliente Doc Ruim', 'document_number', '123')),
    test.row(3, 'c3', jsonb_build_object('name', 'Cliente Doc Repetido', 'document_number', '12345678000199')),
    test.row(4, 'c4', jsonb_build_object('name', 'Cliente Email Ruim', 'email', 'Sem Arroba'))));
  assert (r ->> 'valid')::integer = 2 and (r ->> 'errors')::integer = 2, 'clientes: 2 válidos e 2 erros (CPF/CNPJ e e-mail)';
  res := public.fin_commit_import((r ->> 'import_id')::uuid);
  assert res ->> 'accepted' = '1' and res ->> 'failed_on_commit' = '1', 'documento repetido é rejeitado na confirmação (índice único)';
  assert (select count(*) from public.counterparties where kind = 'customer' and name like 'Cliente %') = 2, 'clientes criados: Beta e Gama';

  r := public.fin_create_import(org, 'suppliers', 'fornecedores.csv', test.h('file-fornecedores'), null, jsonb_build_array(test.row(1, 's1', jsonb_build_object('name', 'Fornecedor Delta'))));
  perform public.fin_commit_import((r ->> 'import_id')::uuid);
  assert (select kind from public.counterparties where name = 'Fornecedor Delta') = 'supplier', 'fornecedor importado';
  raise notice 'PASS: importar a receber, clientes e fornecedores — tipo oposto, documento inválido/repetido';
end $$;
reset role;

-- ===================================================================== 3. extrato bancário: linhas idênticas legítimas e reimportação
:as_na
do $$
declare org uuid := test.t('org'); r jsonb; imp uuid; res jsonb; rows_ jsonb;
begin
  rows_ := jsonb_build_array(
    test.row(1, 'L1', jsonb_build_object('date', test.today() - 10, 'amount_cents', 150000, 'description', 'PIX RECEBIDO ALFA', 'external_reference', 'E2E001')),
    test.row(2, 'L2', jsonb_build_object('date', test.today() - 9, 'amount_cents', -50000, 'description', 'BOLETO FORNECEDOR')),
    test.row(3, 'L3', jsonb_build_object('date', test.today() - 8, 'amount_cents', 30000, 'description', 'TED RECEBIDA')),
    test.row(4, 'L4', jsonb_build_object('date', test.today() - 8, 'amount_cents', 30000, 'description', 'TED RECEBIDA')),
    test.row(5, 'L5', jsonb_build_object('date', test.today() - 7, 'amount_cents', -1000, 'description', 'TARIFA MENSAL')));
  assert test.errmsg(format($q$select public.fin_create_import(%L, 'statement', 'extrato.csv', %L, null, %L::jsonb)$q$, org, test.h('file-ext'), rows_)) like '%selecione uma conta%', 'extrato exige conta';
  assert test.errmsg(format($q$select public.fin_create_import(%L, 'payables', 'x.csv', %L, %L, %L::jsonb)$q$, org, test.h('file-x'), test.t('banco'), rows_)) like '%não usa conta%', 'pagar não usa conta';
  r := public.fin_create_import(org, 'statement', 'extrato.csv', test.h('file-ext'), test.t('banco'), rows_);
  imp := (r ->> 'import_id')::uuid;
  assert (r ->> 'valid')::integer = 5, 'cinco linhas válidas (duas idênticas têm hashes distintos pelo ordinal)';
  assert (select count(*) from public.bank_statement_lines) = 0, 'prévia do extrato não grava linhas';
  res := public.fin_commit_import(imp);
  assert res ->> 'accepted' = '5', 'cinco linhas de extrato gravadas';
  assert (select count(*) from public.bank_statement_lines where reconciliation_status = 'pending') = 5, 'todas pendentes';
  assert (select count(*) from public.settlements) = 0 and (select count(*) from public.account_movements) = 0, 'extrato NÃO baixa títulos nem cria movimentos';
  -- reimportação do mesmo arquivo
  assert (public.fin_create_import(org, 'statement', 'extrato-de-novo.csv', test.h('file-ext'), test.t('banco'), rows_) ->> 'duplicate_file')::boolean, 'mesmo extrato reconhecido';
  -- período sobreposto: L1 já existe, L6 é nova
  r := public.fin_create_import(org, 'statement', 'extrato-2.csv', test.h('file-ext-2'), test.t('banco'), jsonb_build_array(
    test.row(1, 'L1', jsonb_build_object('date', test.today() - 10, 'amount_cents', 150000, 'description', 'PIX RECEBIDO ALFA', 'external_reference', 'E2E001')),
    test.row(2, 'L6', jsonb_build_object('date', test.today() - 6, 'amount_cents', 2000, 'description', 'RENDIMENTO'))));
  assert (r ->> 'duplicates')::integer = 1 and (r ->> 'valid')::integer = 1, 'sobreposição: linha repetida detectada';
  perform public.fin_commit_import((r ->> 'import_id')::uuid);
  assert (select count(*) from public.bank_statement_lines) = 6, 'seis linhas no total, sem duplicar L1';
  raise notice 'PASS: extrato — linhas idênticas legítimas, sem baixa automática, reimportação e sobreposição sem duplicar';
end $$;
reset role;

-- ===================================================================== 4. sugestões e conciliação manual
:as_ma
do $$
declare org uuid := test.t('org'); b uuid := test.t('banco'); e uuid; i uuid; s1 uuid; s2 uuid; s3 uuid; adj uuid;
begin
  -- movimentos reais: recebimento 1.500,00 (ref E2E001, há 10 dias), pagamento 500,00 (há 9 dias), recebimento 300,00 (há 8 dias), tarifa 9,00 (há 7 dias)
  e := public.fin_create_entry(org, 'receivable', 'Fatura Alfa', null, null, null, 150000, test.today() - 20, test.today() - 20, test.today() - 10, 1);
  select id into i from public.financial_installments where entry_id = e;
  s1 := public.fin_settle_installment(i, b, 150000, now() - interval '10 days', 'pix', 'E2E001', 'imp-settle-0001');
  e := public.fin_create_entry(org, 'payable', 'Boleto fornecedor', null, null, null, 50000, test.today() - 20, test.today() - 20, test.today() - 9, 1);
  select id into i from public.financial_installments where entry_id = e;
  s2 := public.fin_settle_installment(i, b, 50000, now() - interval '9 days', 'boleto', null, 'imp-settle-0002');
  e := public.fin_create_entry(org, 'receivable', 'Fatura Beta', null, null, null, 30000, test.today() - 20, test.today() - 20, test.today() - 8, 1);
  select id into i from public.financial_installments where entry_id = e;
  s3 := public.fin_settle_installment(i, b, 30000, now() - interval '8 days', 'transfer', null, 'imp-settle-0003');
  adj := public.fin_create_adjustment(org, b, -900, 'fee', 'tarifa mensal cobrada pelo banco', now() - interval '7 days', 'imp-adjust-0001');
  perform set_config('t.s1', s1::text, true); perform set_config('t.s2', s2::text, true); perform set_config('t.s3', s3::text, true);
  perform set_config('t.m1', (select id::text from public.account_movements where settlement_id = s1 and movement_type = 'settlement'), true);
  perform set_config('t.m2', (select id::text from public.account_movements where settlement_id = s2 and movement_type = 'settlement'), true);
  perform set_config('t.m3', (select id::text from public.account_movements where settlement_id = s3 and movement_type = 'settlement'), true);
  perform set_config('t.m4', (select id::text from public.account_movements where adjustment_id = adj), true);
  -- entrada de 300,00 em OUTRA conta (Caixa): mesmo valor e sinal da linha L4, mas conta diferente
  adj := public.fin_create_adjustment(org, test.t('caixa'), 30000, 'manual', 'ajuste em outra conta', now() - interval '8 days', 'imp-adjust-0002');
  perform set_config('t.m5', (select id::text from public.account_movements where adjustment_id = adj), true);
  perform set_config('t.l1', (select id::text from public.bank_statement_lines where description = 'PIX RECEBIDO ALFA'), true);
  perform set_config('t.l2', (select id::text from public.bank_statement_lines where description = 'BOLETO FORNECEDOR'), true);
  perform set_config('t.l3', (select id::text from public.bank_statement_lines where description = 'TED RECEBIDA' order by id limit 1), true);
  perform set_config('t.l4', (select id::text from public.bank_statement_lines where description = 'TED RECEBIDA' order by id desc limit 1), true);
  perform set_config('t.l5', (select id::text from public.bank_statement_lines where description = 'TARIFA MENSAL'), true);
  perform set_config('t.l6', (select id::text from public.bank_statement_lines where description = 'RENDIMENTO'), true);

  -- sugestões
  assert (select count(*) from public.fin_suggest_matches(org, b)) >= 4, 'há sugestões';
  assert (select ambiguous from public.fin_suggest_matches(org, b) where line_id = test.t('l1') and movement_id = test.t('m1')) = false, 'L1 ↔ M1 não é ambígua';
  assert (select score from public.fin_suggest_matches(org, b) where line_id = test.t('l1') and movement_id = test.t('m1')) = 110, 'L1 ↔ M1: valor igual (70) + mesma referência (30) + mesma data (10)';
  assert (select bool_and(ambiguous) from public.fin_suggest_matches(org, b) where movement_id = test.t('m3')), 'M3 concorre com duas linhas idênticas (L3 e L4): ambíguo';
  assert not exists (select 1 from public.fin_suggest_matches(org, b) where line_id = test.t('l2') and movement_id = test.t('m1')), 'entrada nunca é sugerida para saída';
  -- nada é confirmado sozinho
  assert (select count(*) from public.reconciliation_matches) = 0 and (select count(*) from public.bank_statement_lines where reconciliation_status <> 'pending') = 0, 'sugestão não concilia';
  raise notice 'PASS: sugestões — pontuação calculada à mão, ambiguidade sinalizada, nada confirmado automaticamente';
end $$;
reset role;

:as_na
do $$
declare mt uuid;
begin
  mt := public.fin_reconcile(test.t('l1'), test.t('m1'));
  assert (select reconciliation_status from public.bank_statement_lines where id = test.t('l1')) = 'reconciled', 'analista concilia valores iguais';
  assert test.errmsg(format($q$select public.fin_reconcile(%L, %L)$q$, test.t('l1'), test.t('m1'))) like '%não está pendente%', 'mesma linha não concilia duas vezes';
  assert test.errmsg(format($q$select public.fin_reconcile(%L, %L)$q$, test.t('l6'), test.t('m1'))) like '%sinais%' or test.errmsg(format($q$select public.fin_reconcile(%L, %L)$q$, test.t('l6'), test.t('m1'))) like '%já conciliado%', 'mesmo movimento não concilia duas vezes';
  assert test.errmsg(format($q$select public.fin_reconcile(%L, %L)$q$, test.t('l2'), test.t('m3'))) like '%entrada e saída%', 'entrada não concilia com saída';
  assert test.errmsg(format($q$select public.fin_reconcile(%L, %L)$q$, test.t('l4'), test.t('m5'))) like '%contas diferentes%', 'extrato de uma conta não concilia com movimento de outra';
  assert test.errmsg(format($q$select public.fin_undo_reconciliation(%L, 'desfazer sem permissão')$q$, mt)) like '%sem permissão%', 'analista não desfaz conciliação';
  perform set_config('t.match1', mt::text, true);
end $$;
reset role;
:as_ma
do $$
declare mt uuid; sm jsonb;
begin
  -- conciliação com diferença exige justificativa e fica DIVERGENTE
  assert test.errmsg(format($q$select public.fin_reconcile(%L, %L)$q$, test.t('l5'), test.t('m4'))) like '%informe a justificativa%', 'diferença exige justificativa';
  mt := public.fin_reconcile(test.t('l5'), test.t('m4'), 'banco cobrou R$ 10,00; sistema registrou R$ 9,00');
  assert (select reconciliation_status from public.bank_statement_lines where id = test.t('l5')) = 'divergent' and (select difference_cents from public.reconciliation_matches where id = mt) = -100, 'divergente com diferença de −1,00';
  perform public.fin_reconcile(test.t('l2'), test.t('m2'));
  perform public.fin_reconcile(test.t('l3'), test.t('m3'));
  -- L4 (idêntica a L3) fica sem par: ignorar com justificativa
  assert test.errmsg(format($q$select public.fin_ignore_statement_line(%L, 'ok')$q$, test.t('l4'))) like '%justificativa%', 'ignorar exige justificativa';
  perform public.fin_ignore_statement_line(test.t('l4'), 'lançamento duplicado pelo banco, estornado no dia seguinte');
  assert (select reconciliation_status from public.bank_statement_lines where id = test.t('l4')) = 'ignored', 'linha ignorada com justificativa';
  -- L6 (rendimento) sem movimento: segue pendente
  assert (select reconciliation_status from public.bank_statement_lines where id = test.t('l6')) = 'pending', 'movimento inexistente: linha segue pendente';

  -- resumo do período inteiro: extrato = 150000 − 50000 + 30000 + 30000 − 1000 + 2000 = 161000; movimentos = 150000 − 50000 + 30000 − 900 = 129100
  sm := public.fin_reconciliation_summary(test.t('org'), test.t('banco'), test.today() - 30, test.today());
  assert (sm ->> 'statement_total_cents')::bigint = 161000 and (sm ->> 'movements_net_cents')::bigint = 129100 and (sm ->> 'difference_cents')::bigint = 129100 - 161000, 'totais do extrato e do sistema e diferença: ' || sm::text;
  assert (sm ->> 'system_balance_cents')::bigint = 129100, 'saldo do sistema = movimentos (saldo inicial zero)';
  assert (sm ->> 'lines_pending')::integer = 1 and (sm ->> 'lines_pending_cents')::bigint = 2000, 'uma pendente de 20,00';
  assert (sm ->> 'lines_reconciled')::integer = 3 and (sm ->> 'lines_divergent')::integer = 1 and (sm ->> 'lines_ignored')::integer = 1, 'conciliadas 3, divergente 1, ignorada 1';
  assert (sm ->> 'divergence_cents')::bigint = -100, 'divergência total −1,00';
  assert (sm ->> 'movements_unreconciled')::integer = 0, 'todos os movimentos conciliados';

  -- movimentação conciliada: gestor não estorna; administrador sim
  assert test.errmsg(format($q$select public.fin_reverse_settlement(%L, 'estorno de baixa conciliada')$q$, test.t('s2'))) like '%movimentação conciliada%', 'gestor não estorna movimento conciliado';
  -- desfazer: motivo obrigatório; vínculo não se desfaz duas vezes
  assert test.errmsg(format($q$select public.fin_undo_reconciliation(%L, 'x')$q$, test.t('match1'))) like '%motivo%', 'desfazer exige motivo';
  perform public.fin_undo_reconciliation(test.t('match1'), 'conciliado com a linha errada');
  assert (select reconciliation_status from public.bank_statement_lines where id = test.t('l1')) = 'pending', 'linha volta a pendente';
  assert test.errmsg(format($q$select public.fin_undo_reconciliation(%L, 'desfazer de novo')$q$, test.t('match1'))) like '%já foi desfeito%', 'vínculo desfeito não desfaz de novo';
  perform public.fin_reconcile(test.t('l1'), test.t('m1'));
  assert (select count(*) from public.reconciliation_matches where status = 'active') = 4 and (select count(*) from public.reconciliation_matches where status = 'undone') = 1, 'histórico preserva o vínculo desfeito';
  -- unignore só gestão
  perform public.fin_unignore_statement_line(test.t('l4'));
  assert (select reconciliation_status from public.bank_statement_lines where id = test.t('l4')) = 'pending', 'linha reaberta';
end $$;
reset role;
:as_oa
do $$
begin
  perform public.fin_reverse_settlement(test.t('s2'), 'pagamento lançado em duplicidade (administrador)');
  assert (select is_reversed from public.fin_movements_view where movement_id = test.t('m2')), 'administrador estorna movimento conciliado';
  raise notice 'PASS: conciliação — valores iguais, divergência com justificativa, ignorar, desfazer com histórico, resumo calculado à mão, estorno de conciliado só pelo administrador';
end $$;
reset role;

-- ===================================================================== 5. movimentações históricas (criam título + baixa + movimento)
:as_na
do $$
begin
  assert test.errmsg(format($q$select public.fin_create_import(%L, 'history', 'hist.csv', %L, %L, jsonb_build_array(%L::jsonb))$q$, test.t('org'), test.h('file-hist'), test.t('banco'),
    test.row(1, 'h0', jsonb_build_object('date', test.today() - 30, 'amount_cents', 100, 'description', 'x')))) like '%sem permissão%', 'analista não importa movimentações históricas';
end $$;
reset role;
:as_ma
do $$
declare org uuid := test.t('org'); r jsonb; res jsonb; bal0 bigint := test.bal(test.t('banco'));
begin
  r := public.fin_create_import(org, 'history', 'hist.csv', test.h('file-hist'), test.t('banco'), jsonb_build_array(
    test.row(1, 'h1', jsonb_build_object('date', test.today() - 30, 'amount_cents', 20000, 'description', 'Venda antiga', 'category_name', 'Serviços')),
    test.row(2, 'h2', jsonb_build_object('date', test.today() - 30, 'amount_cents', -8000, 'description', 'Despesa antiga', 'category_name', 'Aluguel')),
    test.row(3, 'h3', jsonb_build_object('date', test.today() - 100, 'amount_cents', 500, 'description', 'Antes do saldo inicial')),
    test.row(4, 'h4', jsonb_build_object('date', test.today() + 5, 'amount_cents', 500, 'description', 'No futuro')),
    test.row(5, 'h5', jsonb_build_object('date', test.today() - 29, 'amount_cents', -700, 'description', 'Categoria de receita em despesa', 'category_name', 'Serviços'))));
  assert (r ->> 'valid')::integer = 5, 'cinco linhas válidas na prévia';
  assert test.bal(test.t('banco')) = bal0, 'prévia não mexe no saldo';
  res := public.fin_commit_import((r ->> 'import_id')::uuid);
  assert res ->> 'accepted' = '2' and res ->> 'failed_on_commit' = '3', 'histórico: 2 aceitas e 3 recusadas na confirmação: ' || res::text;
  assert test.bal(test.t('banco')) = bal0 + 20000 - 8000, 'saldo reflete as duas movimentações';
  assert (select count(*) from public.fin_installments_view where description in ('Venda antiga', 'Despesa antiga') and status = 'paid' and pending_cents = 0) = 2, 'títulos históricos nascem quitados';
  assert (select error_message from public.import_rows where import_id = (r ->> 'import_id')::uuid and row_number = 3) like '%anterior ao saldo inicial%', 'antes do saldo inicial recusada';
  assert (select error_message from public.import_rows where import_id = (r ->> 'import_id')::uuid and row_number = 4) like '%futuro%', 'futuro recusado';
  assert (select error_message from public.import_rows where import_id = (r ->> 'import_id')::uuid and row_number = 5) like '%não encontrada%', 'categoria de outra natureza recusada';
  raise notice 'PASS: movimentações históricas — só gestão, título quitado + movimento, datas inválidas recusadas';
end $$;
reset role;

-- ===================================================================== 6. permissões, isolamento e imutabilidade
:as_va
do $$
begin
  assert test.errmsg(format($q$select public.fin_create_import(%L, 'customers', 'v.csv', %L, null, jsonb_build_array(%L::jsonb))$q$, test.t('org'), test.h('file-v'),
    test.row(1, 'v1', jsonb_build_object('name', 'Cliente V')))) like '%sem permissão%', 'consulta não importa';
  assert test.errmsg(format($q$select public.fin_reconcile(%L, %L)$q$, test.t('l6'), test.t('m1'))) like '%sem permissão%', 'consulta não concilia';
  assert (select count(*) from public.bank_statement_lines) = 6 and (select count(*) from public.imports) >= 5, 'consulta lê extrato e importações';
end $$;
reset role;
:as_ob
do $$
begin
  assert (select count(*) from public.bank_statement_lines) = 0 and (select count(*) from public.imports) = 0 and (select count(*) from public.import_rows) = 0 and (select count(*) from public.reconciliation_matches) = 0, 'B não enxerga importações, extrato nem vínculos de A';
  assert test.errmsg(format($q$select public.fin_reconcile(%L, %L)$q$, test.t('l6'), test.t('m1'))) like '%sem permissão%', 'B não concilia em A';
  assert test.errmsg(format($q$select public.fin_commit_import(%L)$q$, test.t('imp1'))) like '%sem permissão%' or test.errmsg(format($q$select public.fin_commit_import(%L)$q$, test.t('imp1'))) like '%já foi processada%', 'B não confirma importação de A';
  assert test.errmsg(format($q$select public.fin_create_import(%L, 'customers', 'b.csv', %L, null, jsonb_build_array(%L::jsonb))$q$, test.t('org'), test.h('file-b'),
    test.row(1, 'b1', jsonb_build_object('name', 'Cliente B')))) like '%sem permissão%', 'B não importa em A';
  assert test.errmsg(format($q$select public.fin_suggest_matches(%L, %L)$q$, test.t('org'), test.t('banco'))) is null and (select count(*) from public.fin_suggest_matches(test.t('org'), test.t('banco'))) = 0, 'B não recebe sugestões de A (RLS)';
  assert test.errmsg(format($q$select public.fin_reconciliation_summary(%L, %L, test.today() - 10, test.today())$q$, test.t('org'), test.t('banco'))) like '%sem permissão%', 'B não lê resumo de A';
end $$;
reset role;
:as_oa
do $$
begin
  assert test.errmsg($q$update public.bank_statement_lines set amount_cents = 1$q$) is not null, 'escrita direta em extrato negada';
  assert test.errmsg($q$insert into public.bank_statement_lines (organization_id, account_id, transaction_date, amount_cents, description, normalized_hash) values (gen_random_uuid(), gen_random_uuid(), test.today(), 1, 'x', repeat('a', 64))$q$) is not null, 'insert direto em extrato negado';
  assert test.errmsg($q$update public.reconciliation_matches set status = 'undone'$q$) is not null, 'escrita direta em vínculos negada';
  assert test.errmsg($q$update public.import_rows set status = 'valid'$q$) is not null, 'escrita direta em linhas de importação negada';
end $$;
reset role;
do $$
begin
  assert test.errmsg($q$update public.bank_statement_lines set amount_cents = amount_cents + 1$q$) like '%imutável%', 'linha de extrato imutável até para o dono';
  assert test.errmsg($q$update public.bank_statement_lines set reconciliation_status = 'reconciled'$q$) like '%funções de conciliação%', 'estado só muda pelas funções';
  assert test.errmsg($q$delete from public.bank_statement_lines$q$) like '%não podem ser apagados%', 'extrato não se apaga';
  assert test.errmsg($q$delete from public.reconciliation_matches$q$) like '%não podem ser apagados%', 'vínculos não se apagam';
  assert test.errmsg($q$update public.reconciliation_matches set difference_cents = 0$q$) like '%só pode ser desfeito%', 'vínculo só se desfaz';
  assert test.errmsg($q$update public.import_rows set parsed_data = '{}'::jsonb$q$) like '%imutáveis%', 'dados importados imutáveis';
  assert test.errmsg($q$delete from public.imports$q$) like '%não podem ser apagados%', 'importações não se apagam';
  assert test.errmsg($q$insert into public.reconciliation_matches (organization_id, account_id, statement_line_id, movement_id, matched_amount_cents, difference_cents)
     select organization_id, account_id, statement_line_id, movement_id, 1, 0 from public.reconciliation_matches where status = 'active' limit 1$q$) like '%duplicate key%', 'um vínculo ativo por linha';
  raise notice 'PASS: permissões, isolamento A × B e imutabilidade de extrato, vínculos e importações';
end $$;

rollback;
select 'PASS 64_fin_import_recon' as result;
