-- Isolamento e permissões (RLS + funções): empresas A e B, os quatro perfis, MFA no banco, escrita direta negada, referências cruzadas.
-- Empresa A: OA (dono, aal2), AD (admin SEM aal2), MA (gestor financeiro), NA (analista), VA (consulta). Empresa B: OB (dono, aal2).

\set as_oa 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a0","aal":"aal2","email":"oa@t.invalid"}'', true); set local role authenticated;'
\set as_ad 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a4","aal":"aal1","email":"ad@t.invalid"}'', true); set local role authenticated;'
\set as_ma 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a1","aal":"aal1","email":"ma@t.invalid"}'', true); set local role authenticated;'
\set as_na 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a2","aal":"aal1","email":"na@t.invalid"}'', true); set local role authenticated;'
\set as_va 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a3","aal":"aal1","email":"va@t.invalid"}'', true); set local role authenticated;'
\set as_ob 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000b0","aal":"aal2","email":"ob@t.invalid"}'', true); set local role authenticated;'
\set as_anon 'select set_config(''request.jwt.claims'', ''{}'', true); set local role anon;'

begin;

create function test.errmsg(q text) returns text language plpgsql as $$ begin execute q; return null; exception when others then return sqlerrm; end $$;
create function test.today() returns date language sql as $$ select (now() at time zone 'America/Sao_Paulo')::date $$;
grant execute on all functions in schema test to anon, authenticated;

insert into auth.users (id, email) values
  ('ffffffff-0000-4000-8000-0000000000a0', 'oa@t.invalid'), ('ffffffff-0000-4000-8000-0000000000a1', 'ma@t.invalid'), ('ffffffff-0000-4000-8000-0000000000a2', 'na@t.invalid'),
  ('ffffffff-0000-4000-8000-0000000000a3', 'va@t.invalid'), ('ffffffff-0000-4000-8000-0000000000a4', 'ad@t.invalid'), ('ffffffff-0000-4000-8000-0000000000b0', 'ob@t.invalid');

:as_oa
do $$
declare a uuid;
begin
  a := public.create_organization('Empresa A', 'empresa-a');
  insert into public.organization_members (organization_id, user_id, role) values
    (a, 'ffffffff-0000-4000-8000-0000000000a1', 'manager'), (a, 'ffffffff-0000-4000-8000-0000000000a2', 'member'),
    (a, 'ffffffff-0000-4000-8000-0000000000a3', 'viewer'), (a, 'ffffffff-0000-4000-8000-0000000000a4', 'admin');
  perform set_config('t.org', a::text, true);
end $$;
reset role;
:as_ob
do $$ begin perform set_config('t.orgb', public.create_organization('Empresa B', 'empresa-b')::text, true); end $$;
reset role;

-- padrões por organização
:as_oa
do $$
declare org uuid := current_setting('t.org')::uuid;
begin
  assert (select count(*) from public.fin_settings where organization_id = org) = 1, 'configurações financeiras criadas';
  assert (select count(*) from public.financial_categories where organization_id = org and nature = 'income') = 4, '4 categorias de receita padrão';
  assert (select count(*) from public.financial_categories where organization_id = org and nature = 'expense') = 8, '8 categorias de despesa padrão';
  raise notice 'PASS: padrões criados com a organização (configuração e categorias)';
end $$;
reset role;

-- contas: gestão cria; analista, consulta, admin sem MFA e outra empresa não
:as_ma
do $$
declare org uuid := current_setting('t.org')::uuid; a1 uuid; a2 uuid;
begin
  a1 := public.fin_create_account(org, 'Banco A', 'checking', 'Banco Fictício', 100000, test.today() - 120);
  a2 := public.fin_create_account(org, 'Caixa', 'cash', null, 0, test.today() - 120, true, false);
  perform set_config('t.acc1', a1::text, true); perform set_config('t.acc2', a2::text, true);
end $$;
reset role;
:as_ob
do $$
declare orgb uuid := current_setting('t.orgb')::uuid;
begin perform set_config('t.accb', public.fin_create_account(orgb, 'Banco B', 'checking', null, 50000, test.today() - 120)::text, true); end $$;
reset role;

:as_na
do $$
declare org uuid := current_setting('t.org')::uuid;
begin
  assert test.errmsg(format($q$select public.fin_create_account(%L, 'Conta do analista', 'cash', null, 0, test.today())$q$, org)) like '%sem permissão%', 'analista não cria conta';
end $$;
reset role;
:as_va
do $$
declare org uuid := current_setting('t.org')::uuid;
begin
  assert test.errmsg(format($q$select public.fin_create_account(%L, 'Conta da consulta', 'cash', null, 0, test.today())$q$, org)) like '%sem permissão%', 'consulta não cria conta';
  assert test.count('select 1 from public.financial_accounts') = 2, 'consulta enxerga as contas da própria empresa';
end $$;
reset role;
:as_ad
do $$
declare org uuid := current_setting('t.org')::uuid;
begin
  assert test.errmsg(format($q$select public.fin_create_account(%L, 'Conta sem MFA', 'cash', null, 0, test.today())$q$, org)) like '%duas etapas%', 'admin sem AAL2 barrado pelo banco';
  assert test.errmsg(format($q$select public.fin_set_opening_balance(%L, 1, test.today() - 100, 'tentativa sem mfa')$q$, current_setting('t.acc1'))) like '%duas etapas%', 'admin sem AAL2 não corrige saldo';
end $$;
reset role;
:as_ob
do $$
declare org uuid := current_setting('t.org')::uuid;
begin
  assert test.errmsg(format($q$select public.fin_create_account(%L, 'Invasão', 'cash', null, 0, test.today())$q$, org)) like '%sem permissão%', 'outra empresa não cria conta em A';
  assert test.count(format('select 1 from public.financial_accounts where organization_id = %L', org)) = 0, 'B não enxerga contas de A';
  assert test.count('select 1 from public.financial_accounts') = 1, 'B enxerga só a própria conta';
  assert test.count('select 1 from public.fin_account_balances') = 1, 'visão de saldos respeita a RLS';
end $$;
reset role;
:as_oa
do $$
begin
  assert test.count(format('select 1 from public.financial_accounts where id = %L', current_setting('t.accb'))) = 0, 'A não enxerga conta de B';
  raise notice 'PASS: contas — criação por perfil, MFA no banco e isolamento A × B';
end $$;
reset role;

-- escrita direta nas tabelas de dinheiro é negada a TODOS (até ao dono): só as funções escrevem
:as_oa
do $$
declare org uuid := current_setting('t.org')::uuid; acc uuid := current_setting('t.acc1')::uuid;
begin
  assert test.throws(format($q$insert into public.financial_accounts (organization_id, name, account_type, opening_balance_date) values (%L, 'direta', 'cash', test.today())$q$, org)), 'insert direto em conta';
  assert test.throws(format($q$update public.financial_accounts set opening_balance_cents = 999999 where id = %L$q$, acc)), 'update direto do saldo inicial';
  assert test.throws(format($q$delete from public.financial_accounts where id = %L$q$, acc)), 'delete direto de conta';
  assert test.throws(format($q$insert into public.account_movements (organization_id, account_id, movement_type, amount_cents, effective_at, adjustment_id) values (%L, %L, 'adjustment', 100, now(), gen_random_uuid())$q$, org, acc)), 'insert direto no livro';
  assert test.throws(format($q$insert into public.settlements (organization_id, installment_id, account_id, amount_cents, settled_at, idempotency_key) values (%L, gen_random_uuid(), %L, 100, now(), 'direta-123')$q$, org, acc)), 'insert direto de baixa';
  assert test.throws(format($q$insert into public.financial_entries (organization_id, entry_type, description, amount_cents, issue_date, due_date, competence_date) values (%L, 'payable', 'direto', 100, test.today(), test.today(), test.today())$q$, org)), 'insert direto de título';
  assert test.throws(format($q$insert into public.audit_log (organization_id, action, entity) values (%L, 'x', 'y')$q$, org)), 'auditoria não é gravável';
  raise notice 'PASS: escrita direta em contas, livro, baixas e títulos negada até ao dono';
end $$;
reset role;

-- catálogos: contrapartes (analista+), categorias e centros (gestão+)
:as_na
do $$
declare org uuid := current_setting('t.org')::uuid; cust uuid; sup uuid;
begin
  insert into public.counterparties (organization_id, kind, name, document_number, email) values (org, 'customer', 'Cliente Alfa', '12345678000199', 'alfa@alfa.invalid') returning id into cust;
  insert into public.counterparties (organization_id, kind, name) values (org, 'supplier', 'Fornecedor Beta') returning id into sup;
  perform set_config('t.cust', cust::text, true); perform set_config('t.sup', sup::text, true);
  assert test.throws(format($q$insert into public.counterparties (organization_id, kind, name, document_number) values (%L, 'customer', 'Doc ruim', '123')$q$, org)), 'documento inválido recusado';
  assert test.throws(format($q$insert into public.counterparties (organization_id, kind, name, document_number) values (%L, 'customer', 'Doc repetido', '12345678000199')$q$, org)), 'documento duplicado recusado';
  assert test.throws(format($q$insert into public.financial_categories (organization_id, name, nature) values (%L, 'Categoria do analista', 'expense')$q$, org)), 'analista não cria categoria';
  assert test.throws(format($q$insert into public.cost_centers (organization_id, name, code) values (%L, 'Centro do analista', 'AN')$q$, org)), 'analista não cria centro de custo';
end $$;
reset role;
:as_va
do $$
declare org uuid := current_setting('t.org')::uuid;
begin
  assert test.throws(format($q$insert into public.counterparties (organization_id, kind, name) values (%L, 'customer', 'Cliente da consulta')$q$, org)), 'consulta não cria contraparte';
  assert test.affected(format($q$update public.counterparties set name = 'Hackeado' where id = %L$q$, current_setting('t.cust'))) = 0, 'consulta não edita contraparte';
  assert test.count('select 1 from public.counterparties') = 2, 'consulta lê contrapartes';
end $$;
reset role;
:as_ma
do $$
declare org uuid := current_setting('t.org')::uuid; cc uuid; cat uuid; parent uuid;
begin
  insert into public.cost_centers (organization_id, name, code) values (org, 'Comercial', 'COM') returning id into cc;
  insert into public.cost_centers (organization_id, name, code) values (org, 'Operações', 'OPS');
  select id into parent from public.financial_categories where organization_id = org and name = 'Tecnologia';
  insert into public.financial_categories (organization_id, parent_id, name, nature) values (org, parent, 'Licenças de software', 'expense') returning id into cat;
  perform set_config('t.cc', cc::text, true); perform set_config('t.cat_sub', cat::text, true);
  assert test.errmsg(format($q$insert into public.financial_categories (organization_id, parent_id, name, nature) values (%L, %L, 'Natureza trocada', 'income')$q$, org, parent)) like '%mesma natureza%', 'subcategoria com natureza diferente do pai';
  assert test.errmsg(format($q$update public.financial_categories set parent_id = %L where id = %L$q$, cat, parent)) like '%ciclo%', 'ciclo de categorias recusado';
  assert test.errmsg(format($q$update public.financial_categories set nature = 'income' where id = %L$q$, cat)) like '%permission denied%', 'natureza não editável';
  assert test.throws(format($q$insert into public.cost_centers (organization_id, name, code) values (%L, 'Outro', 'COM')$q$, org)), 'código de centro repetido';
  assert test.throws(format($q$insert into public.financial_categories (organization_id, parent_id, name, nature) values (%L, %L, 'Nivel 3', 'expense')$q$, org, cat)) = false, 'terceiro nível permitido';
  assert test.throws(format($q$insert into public.financial_categories (organization_id, parent_id, name, nature) values (%L, (select id from public.financial_categories where name = 'Nivel 3'), 'Nivel 4', 'expense')$q$, org)), 'quarto nível recusado';
end $$;
reset role;
:as_ob
do $$
declare org uuid := current_setting('t.org')::uuid;
begin
  assert test.throws(format($q$insert into public.financial_categories (organization_id, name, nature) values (%L, 'Invasão', 'expense')$q$, org)), 'B não cria categoria em A';
  assert test.affected(format($q$update public.counterparties set name = 'Invadido' where id = %L$q$, current_setting('t.cust'))) = 0, 'B não edita contraparte de A';
  assert test.count('select 1 from public.counterparties') = 0 and test.count('select 1 from public.cost_centers') = 0, 'B não enxerga cadastros de A';
  assert test.throws(format($q$insert into public.financial_categories (organization_id, parent_id, name, nature) values (%L, %L, 'Pai de outra empresa', 'expense')$q$, current_setting('t.orgb'), current_setting('t.cat_sub'))), 'categoria-pai de outra empresa recusada (chave composta)';
  raise notice 'PASS: catálogos por perfil, hierarquia de categorias e isolamento';
end $$;
reset role;

-- títulos e baixas: analista lança, só gestão baixa/estorna/transfere; consulta nada
:as_na
do $$
declare org uuid := current_setting('t.org')::uuid; e uuid; i uuid;
begin
  e := public.fin_create_entry(org, 'receivable', 'Serviço de consultoria', current_setting('t.cust')::uuid, null, null, 100000, test.today() - 10, test.today() - 10, test.today() + 5, 2, 'monthly', null, 'entry-key-001');
  select id into i from public.financial_installments where entry_id = e and installment_number = 1;
  perform set_config('t.entry', e::text, true); perform set_config('t.inst', i::text, true);
  assert test.errmsg(format($q$select public.fin_settle_installment(%L, %L, 1000, now(), 'pix', null, 'settle-key-na-1')$q$, i, current_setting('t.acc1'))) like '%sem permissão%', 'analista não faz baixa';
  assert test.errmsg(format($q$select public.fin_create_transfer(%L, %L, %L, 100, now(), null, 'transfer-key-na-1')$q$, org, current_setting('t.acc1'), current_setting('t.acc2'))) like '%sem permissão%', 'analista não transfere';
  assert test.errmsg(format($q$select public.fin_cancel_entry(%L, 'cancelamento pelo analista')$q$, e)) like '%sem permissão%', 'analista não cancela título';
  assert test.errmsg(format($q$select public.fin_set_opening_balance(%L, 1, test.today() - 100, 'tentativa do analista')$q$, current_setting('t.acc1'))) like '%sem permissão%', 'analista não altera saldo inicial';
  assert test.errmsg(format($q$select public.fin_create_adjustment(%L, %L, 100, 'manual', 'ajuste do analista', now(), 'adjust-key-na-1')$q$, org, current_setting('t.acc1'))) like '%sem permissão%', 'analista não ajusta saldo';
end $$;
reset role;
:as_va
do $$
declare org uuid := current_setting('t.org')::uuid;
begin
  assert test.errmsg(format($q$select public.fin_create_entry(%L, 'payable', 'Despesa da consulta', null, null, null, 100, test.today(), test.today(), test.today(), 1)$q$, org)) like '%sem permissão%', 'consulta não cria título';
  assert test.errmsg(format($q$select public.fin_settle_installment(%L, %L, 1000, now(), 'pix', null, 'settle-key-va-1')$q$, current_setting('t.inst'), current_setting('t.acc1'))) like '%sem permissão%', 'consulta não faz baixa';
  assert test.count('select 1 from public.fin_installments_view') = 2, 'consulta enxerga os títulos';
end $$;
reset role;
:as_ma
do $$
declare org uuid := current_setting('t.org')::uuid; s uuid;
begin
  s := public.fin_settle_installment(current_setting('t.inst')::uuid, current_setting('t.acc1')::uuid, 20000, now(), 'pix', null, 'settle-key-ma-1');
  perform set_config('t.settle', s::text, true);
  assert (select balance_cents from public.fin_account_balances where account_id = current_setting('t.acc1')::uuid) = 120000, 'gestão baixa e o saldo sobe';
  assert test.errmsg(format($q$select public.fin_set_opening_balance(%L, 1, test.today() - 100, 'tentativa da gestão')$q$, current_setting('t.acc1'))) like '%sem permissão%', 'gestão não altera saldo inicial (só administrador)';
  assert test.affected(format($q$update public.fin_settings set timezone = 'UTC' where organization_id = %L$q$, org)) = 0, 'gestão não altera configurações';
end $$;
reset role;
:as_na
do $$
begin
  assert test.errmsg(format($q$select public.fin_reverse_settlement(%L, 'estorno do analista')$q$, current_setting('t.settle'))) like '%sem permissão%', 'analista não estorna baixa';
end $$;
reset role;
:as_ob
do $$
declare org uuid := current_setting('t.org')::uuid;
begin
  assert test.errmsg(format($q$select public.fin_reverse_settlement(%L, 'estorno de outra empresa')$q$, current_setting('t.settle'))) like '%sem permissão%', 'B não estorna baixa de A';
  assert test.errmsg(format($q$select public.fin_settle_installment(%L, %L, 100, now(), 'pix', null, 'settle-key-ob-1')$q$, current_setting('t.inst'), current_setting('t.accb'))) like '%sem permissão%', 'B não baixa parcela de A';
  assert test.errmsg(format($q$select public.fin_cancel_entry(%L, 'cancelamento de outra empresa')$q$, current_setting('t.entry'))) like '%sem permissão%', 'B não cancela título de A';
  assert test.errmsg(format($q$select public.fin_create_transfer(%L, %L, %L, 100, now(), null, 'transfer-key-ob-1')$q$, current_setting('t.orgb'), current_setting('t.accb'), current_setting('t.acc1'))) like '%pertencer%', 'transferência para conta de outra empresa recusada';
  assert test.errmsg(format($q$select public.fin_create_transfer(%L, %L, %L, 100, now(), null, 'transfer-key-ob-2')$q$, org, current_setting('t.acc1'), current_setting('t.acc2'))) like '%sem permissão%', 'B não transfere entre contas de A';
  assert test.count('select 1 from public.settlements') = 0 and test.count('select 1 from public.account_movements') = 0 and test.count('select 1 from public.fin_installments_view') = 0, 'B não enxerga baixas, livro nem títulos de A';
end $$;
reset role;
:as_oa
do $$
declare org uuid := current_setting('t.org')::uuid;
begin
  assert test.errmsg(format($q$select public.fin_create_entry(%L, 'payable', 'Conta prevista de outra empresa', null, null, %L, 100, test.today(), test.today(), test.today(), 1)$q$, org, current_setting('t.accb'))) like '%não encontrada%', 'conta prevista de outra empresa recusada';
  assert test.errmsg(format($q$select public.fin_settle_installment(%L, %L, 100, now(), 'pix', null, 'settle-key-oa-x')$q$, current_setting('t.inst'), current_setting('t.accb'))) like '%inválida%', 'baixa em conta de outra empresa recusada';
  perform public.fin_set_opening_balance(current_setting('t.acc1')::uuid, 90000, test.today() - 100, 'correção após conferência do extrato');
  assert (select balance_cents from public.fin_account_balances where account_id = current_setting('t.acc1')::uuid) = 110000, 'administrador corrige saldo inicial (90.000 + 20.000)';
  assert (select count(*) from public.account_opening_history where account_id = current_setting('t.acc1')::uuid) = 2, 'histórico do saldo inicial registrado';
  update public.fin_settings set alert_days_before = 5 where organization_id = org;
  assert (select alert_days_before from public.fin_settings where organization_id = org) = 5, 'administrador altera configurações';
  raise notice 'PASS: títulos, baixas, transferências e saldo inicial por perfil; referências cruzadas recusadas';
end $$;
reset role;

-- Estrutura: nenhuma tabela pode ter chave estrangeira para organization_members E para organizations ao mesmo tempo (ambiguidade de embeds do PostgREST).
do $$
declare bad text;
begin
  select string_agg(distinct c1.conrelid::regclass::text, ', ') into bad
  from pg_constraint c1 join pg_constraint c2 on c2.conrelid = c1.conrelid
  where c1.contype = 'f' and c2.contype = 'f' and c1.confrelid = 'public.organization_members'::regclass and c2.confrelid = 'public.organizations'::regclass;
  assert bad is null, 'tabelas com FK para organization_members e organizations (ambíguo para o PostgREST): ' || coalesce(bad, '');
  raise notice 'PASS: sem caminho muitos-para-muitos entre organization_members e organizations';
end $$;

-- anônimo e sessão sem usuário
:as_anon
do $$
begin
  assert test.throws('select * from public.financial_accounts'), 'anon sem acesso às contas';
  assert test.throws('select * from public.fin_installments_view'), 'anon sem acesso à visão de títulos';
  assert test.throws($q$select public.fin_create_account(gen_random_uuid(), 'x', 'cash', null, 0, test.today())$q$), 'anon não executa funções';
  raise notice 'PASS: anônimo sem acesso';
end $$;
reset role;

rollback;
select 'PASS 61_fin_access' as result;
