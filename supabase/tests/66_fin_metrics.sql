-- Indicadores, séries, fluxo de caixa realizado/projetado e relatórios sobre um conjunto de dados de DATAS FIXAS.
-- Referência de «hoje» = 2025-06-15 (parâmetro p_today). Todos os totais esperados foram calculados à mão e estão documentados em docs/METRICS.md (seção «Dados de conferência»).
--
--  Contas   A Banco 10.000,00 · B Caixa 500,00 · C Poupança 2.000,00 (fora do consolidado)  — saldos iniciais em 2025-01-01
--  Receber  R1 Projeto Alfa 5.000,00 (rateio COM 60/OPS 40; recebido 2.000,00 em 20/05 e 3.000,00 em 02/06) · R2 Venda balcão 1.200,00 (recebida 05/06 no Caixa)
--           R3 Contrato mensal 3.000,00 (vence 10/06, aberto) · R4 Serviço futuro 4.500,00 (vence 30/06) · R5 Venda estornada 700,00 (recebida 08/06 e estornada 09/06)
--  Pagar    P1 Aluguel 2.500,00 (pago 05/06) · P2 Insumos 1.000,00 em 3x (333,34 pago 25/05; 333,33 em 25/06; 333,33 em 25/07) · P3 Marketing 800,00 (vence 01/06, aberto)
--           P4 Licença 600,00 (vence 18/06; pago 200,00 em 12/06 no Caixa)
--  Outros   Transferência A→B 1.000,00 (03/06) · tarifa −15,00 (04/06) · regra mensal «Internet» 199,90 a partir de 01/07 (não gerada) · meta de receita 10.000,00 em junho

\set as_oa 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a0","aal":"aal2","email":"oa@t.invalid"}'', true); set local role authenticated;'
\set as_va 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a3","aal":"aal1","email":"va@t.invalid"}'', true); set local role authenticated;'
\set as_ob 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000b0","aal":"aal2","email":"ob@t.invalid"}'', true); set local role authenticated;'
\set as_anon 'select set_config(''request.jwt.claims'', ''{}'', true); set local role anon;'

begin;

create function test.errmsg(q text) returns text language plpgsql as $$ begin execute q; return null; exception when others then return sqlerrm; end $$;
create function test.t(k text) returns uuid language sql as $$ select current_setting('t.' || k)::uuid $$;
create function test.ts(d text) returns timestamptz language sql as $$ select (d || ' 12:00:00-03')::timestamptz $$;
create function test.k(j jsonb, key text) returns bigint language sql as $$ select (j ->> key)::bigint $$;
create function test.pick(arr jsonb, field text, val text, key text) returns bigint language sql as $$
  select (e ->> key)::bigint from jsonb_array_elements(arr) e where e ->> field = val limit 1 $$;
grant execute on all functions in schema test to anon, authenticated;

insert into auth.users (id, email) values ('ffffffff-0000-4000-8000-0000000000a0', 'oa@t.invalid'), ('ffffffff-0000-4000-8000-0000000000a3', 'va@t.invalid'), ('ffffffff-0000-4000-8000-0000000000b0', 'ob@t.invalid');

:as_oa
do $$
declare org uuid; a uuid; b uuid; c uuid; alfa uuid; beta uuid; gama uuid; loc uuid; ins uuid; com uuid; ops uuid; e uuid; i uuid; cat jsonb;
  function_dummy integer;
begin
  org := public.create_organization('Nova Horizonte (conferência)', 'nh-conf');
  insert into public.organization_members (organization_id, user_id, role) values (org, 'ffffffff-0000-4000-8000-0000000000a3', 'viewer');
  perform set_config('t.org', org::text, true);
  a := public.fin_create_account(org, 'Banco', 'checking', null, 1000000, date '2025-01-01');
  b := public.fin_create_account(org, 'Caixa', 'cash', null, 50000, date '2025-01-01');
  c := public.fin_create_account(org, 'Poupança reserva', 'savings', null, 200000, date '2025-01-01', false);
  perform set_config('t.a', a::text, true); perform set_config('t.b', b::text, true); perform set_config('t.c', c::text, true);
  insert into public.counterparties (organization_id, kind, name) values (org, 'customer', 'Alfa') returning id into alfa;
  insert into public.counterparties (organization_id, kind, name) values (org, 'customer', 'Beta') returning id into beta;
  insert into public.counterparties (organization_id, kind, name) values (org, 'customer', 'Gama') returning id into gama;
  insert into public.counterparties (organization_id, kind, name) values (org, 'supplier', 'Locador') returning id into loc;
  insert into public.counterparties (organization_id, kind, name) values (org, 'supplier', 'Insumos') returning id into ins;
  insert into public.cost_centers (organization_id, name, code) values (org, 'Comercial', 'COM') returning id into com;
  insert into public.cost_centers (organization_id, name, code) values (org, 'Operações', 'OPS') returning id into ops;
  perform set_config('t.alfa', alfa::text, true); perform set_config('t.com', com::text, true);
  perform set_config('t.cat_serv', (select id::text from public.financial_categories where organization_id = org and name = 'Serviços'), true);
  perform set_config('t.cat_alug', (select id::text from public.financial_categories where organization_id = org and name = 'Aluguel'), true);

  -- R1 (rateio 60/40) e baixas
  e := public.fin_create_entry(org, 'receivable', 'Projeto Alfa', alfa, (select id from public.financial_categories where organization_id = org and name = 'Serviços'), a, 500000, date '2025-05-10', date '2025-05-10', date '2025-05-20', 1, 'monthly', null, null,
         jsonb_build_array(jsonb_build_object('cost_center_id', com, 'weight', 60), jsonb_build_object('cost_center_id', ops, 'weight', 40)));
  select id into i from public.financial_installments where entry_id = e;
  perform public.fin_settle_installment(i, a, 200000, test.ts('2025-05-20'), 'pix', null, 'met-r1-p1-0001');
  perform public.fin_settle_installment(i, a, 300000, test.ts('2025-06-02'), 'pix', null, 'met-r1-p2-0001');
  -- R2
  e := public.fin_create_entry(org, 'receivable', 'Venda balcão', beta, (select id from public.financial_categories where organization_id = org and name = 'Vendas'), null, 120000, date '2025-06-01', date '2025-06-01', date '2025-06-05', 1);
  select id into i from public.financial_installments where entry_id = e;
  perform public.fin_settle_installment(i, b, 120000, test.ts('2025-06-05'), 'cash', null, 'met-r2-0001');
  -- R3, R4
  perform public.fin_create_entry(org, 'receivable', 'Contrato mensal', alfa, (select id from public.financial_categories where organization_id = org and name = 'Recorrências'), null, 300000, date '2025-06-01', date '2025-06-01', date '2025-06-10', 1);
  perform public.fin_create_entry(org, 'receivable', 'Serviço futuro', gama, (select id from public.financial_categories where organization_id = org and name = 'Serviços'), null, 450000, date '2025-06-10', date '2025-06-30', date '2025-06-30', 1);
  -- R5 (recebida em 08/06; o estorno de 09/06 é fabricado abaixo, pois a função estorna «agora»)
  e := public.fin_create_entry(org, 'receivable', 'Venda estornada', beta, (select id from public.financial_categories where organization_id = org and name = 'Vendas'), null, 70000, date '2025-06-01', date '2025-06-01', date '2025-06-08', 1);
  select id into i from public.financial_installments where entry_id = e;
  perform set_config('t.r5_settle', public.fin_settle_installment(i, a, 70000, test.ts('2025-06-08'), 'pix', null, 'met-r5-0001')::text, true);
  -- P1
  e := public.fin_create_entry(org, 'payable', 'Aluguel junho', loc, (select id from public.financial_categories where organization_id = org and name = 'Aluguel'), null, 250000, date '2025-06-01', date '2025-06-01', date '2025-06-05', 1);
  select id into i from public.financial_installments where entry_id = e;
  perform public.fin_settle_installment(i, a, 250000, test.ts('2025-06-05'), 'boleto', null, 'met-p1-0001');
  -- P2 (3 parcelas)
  e := public.fin_create_entry(org, 'payable', 'Fornecedor insumos', ins, (select id from public.financial_categories where organization_id = org and name = 'Fornecedores'), null, 100000, date '2025-05-20', date '2025-05-25', date '2025-05-25', 3, 'monthly');
  select id into i from public.financial_installments where entry_id = e and installment_number = 1;
  perform public.fin_settle_installment(i, a, 33334, test.ts('2025-05-25'), 'boleto', null, 'met-p2-0001');
  -- P3, P4
  perform public.fin_create_entry(org, 'payable', 'Marketing', null, (select id from public.financial_categories where organization_id = org and name = 'Marketing'), null, 80000, date '2025-05-25', date '2025-06-01', date '2025-06-01', 1);
  e := public.fin_create_entry(org, 'payable', 'Licença anual', null, (select id from public.financial_categories where organization_id = org and name = 'Tecnologia'), null, 60000, date '2025-06-01', date '2025-06-01', date '2025-06-18', 1);
  select id into i from public.financial_installments where entry_id = e;
  perform public.fin_settle_installment(i, b, 20000, test.ts('2025-06-12'), 'pix', null, 'met-p4-0001');
  -- transferência, tarifa, regra recorrente e meta
  perform public.fin_create_transfer(org, a, b, 100000, test.ts('2025-06-03'), 'Reforço do caixa', 'met-xfer-0001');
  perform public.fin_create_adjustment(org, a, -1500, 'fee', 'tarifa mensal do banco', test.ts('2025-06-04'), 'met-adj-0001');
  perform public.fin_create_recurring_rule(org, 'payable', 'Internet', null, null, null, 19990, 'monthly', 1, date '2025-07-01', null, 0);
  insert into public.financial_goals (organization_id, name, metric_type, target_amount_cents, period_start, period_end, created_by)
    values (org, 'Receita de junho', 'income', 1000000, date '2025-06-01', date '2025-06-30', 'ffffffff-0000-4000-8000-0000000000a0');
end $$;
reset role;
:as_ob
do $$ begin perform public.create_organization('Empresa B', 'empresa-b'); end $$;
reset role;

-- estorno de R5 em 09/06 (fabricado como superusuário para fixar a data; a função real estorna «agora»)
do $$
declare s uuid := test.t('r5_settle'); mo uuid; org uuid := test.t('org');
begin
  select id into mo from public.account_movements where settlement_id = s and movement_type = 'settlement';
  update public.settlements set reversed_at = test.ts('2025-06-09'), reversal_reason = 'estorno de conferência' where id = s;
  insert into public.account_movements (organization_id, account_id, movement_type, amount_cents, effective_at, settlement_id, reverses_movement_id, description)
  values (org, test.t('a'), 'settlement_reversal', -70000, test.ts('2025-06-09'), s, mo, 'Estorno de baixa');
end $$;

-- ===================================================================== utilitário e saldos
do $$
begin
  assert private.fin_round_div(100, 3) = 33 and private.fin_round_div(101, 2) = 50 and private.fin_round_div(103, 2) = 52, 'meio para o par (positivos)';
  assert private.fin_round_div(15, 10) = 2 and private.fin_round_div(25, 10) = 2 and private.fin_round_div(35, 10) = 4, 'empates vão ao par';
  assert private.fin_round_div(-15, 10) = -2 and private.fin_round_div(-25, 10) = -2 and private.fin_round_div(0, 5) = 0, 'negativos e zero';
  assert private.fin_round_div(7, 0) is null and private.fin_round_div(7, -1) is null, 'divisor inválido → nulo';
  raise notice 'PASS: arredondamento meio-para-o-par no banco (mesmos casos do TypeScript)';
end $$;

:as_oa
do $$
declare k jsonb; org uuid := test.t('org'); t date := date '2025-06-15';
begin
  k := public.fin_dashboard_kpis(org, date '2025-06-01', date '2025-06-30', null, null, null, null, t);
  assert test.k(k, 'balance_now_cents') = 1365166, 'saldo consolidado: A 1.115.166 + B 250.000 (C fora): ' || k::text;
  assert test.k(k, 'balance_period_end_cents') = 1365166, 'saldo ao fim de junho';
  assert test.k(k, 'income_cents') = 420000 and test.k(k, 'expense_cents') = 270000 and test.k(k, 'net_cents') = 150000, 'receitas 4.200,00 · despesas 2.700,00 · resultado 1.500,00 (estorno de R5 líquido; transferência e tarifa fora)';
  assert test.k(k, 'previous_income_cents') = 200000 and test.k(k, 'previous_expense_cents') = 33334 and test.k(k, 'previous_net_cents') = 166666, 'período anterior (02/05 a 31/05)';
  assert test.k(k, 'payables_pending_cents') = 186666 and test.k(k, 'receivables_pending_cents') = 820000, 'pendente: pagar 1.866,66 · receber 8.200,00';
  assert test.k(k, 'payables_overdue_cents') = 80000 and test.k(k, 'payables_overdue_count') = 1, 'pagar vencido 800,00 (1)';
  assert test.k(k, 'receivables_overdue_cents') = 370000 and test.k(k, 'receivables_overdue_count') = 2, 'receber vencido 3.700,00 (R3 + R5 estornada)';
  assert test.k(k, 'payables_due_today_cents') = 0 and test.k(k, 'payables_due_7d_cents') = 40000 and test.k(k, 'payables_due_7d_count') = 1, 'vence em 7 dias: 400,00 (P4)';
  assert test.k(k, 'payables_due_30d_cents') = 73333 and test.k(k, 'payables_due_30d_count') = 2, 'vence em 30 dias: 733,33 (P2 parc. 2 + P4)';
  assert test.k(k, 'partial_payables_count') = 1 and test.k(k, 'partial_receivables_count') = 0, 'parcialmente pagas: só P4';
  assert test.k(k, 'projected_30d_cents') = 2011843, 'saldo projetado em 30 dias (base): 1.365.166 + 820.000 − 153.333 − 19.990';
  assert test.k(k, 'receipts_count') = 2 and test.k(k, 'avg_ticket_cents') = 210000, 'ticket médio: 4.200,00 ÷ 2 recebimentos individuais não estornados';
  assert (k -> 'goals' -> 0 ->> 'actual_cents')::bigint = 420000 and (k -> 'goals' -> 0 ->> 'progress_bps')::integer = 4200, 'meta de receita: 42% (4.200,00 de 10.000,00)';
  assert k -> 'negative_accounts' = '[]'::jsonb, 'nenhuma conta negativa';
  assert k #>> '{period,previous_from}' = '2025-05-02' and k #>> '{period,previous_to}' = '2025-05-31', 'período anterior de mesmo tamanho';
  raise notice 'PASS: KPIs de junho/2025 batem com os totais calculados à mão';
end $$;

-- filtros
do $$
declare org uuid := test.t('org'); t date := date '2025-06-15'; k jsonb;
begin
  k := public.fin_dashboard_kpis(org, date '2025-06-01', date '2025-06-30', test.t('b'), null, null, null, t);
  assert test.k(k, 'income_cents') = 120000 and test.k(k, 'expense_cents') = 20000 and test.k(k, 'balance_now_cents') = 250000, 'filtro por conta (Caixa)';
  k := public.fin_dashboard_kpis(org, date '2025-06-01', date '2025-06-30', test.t('c'), null, null, null, t);
  assert test.k(k, 'balance_now_cents') = 200000 and test.k(k, 'income_cents') = 0, 'conta fora do consolidado só aparece quando filtrada';
  k := public.fin_dashboard_kpis(org, date '2025-06-01', date '2025-06-30', null, test.t('cat_serv'), null, null, t);
  assert test.k(k, 'income_cents') = 300000 and test.k(k, 'receivables_pending_cents') = 450000, 'filtro por categoria (Serviços)';
  k := public.fin_dashboard_kpis(org, date '2025-06-01', date '2025-06-30', null, null, null, test.t('alfa'), t);
  assert test.k(k, 'income_cents') = 300000 and test.k(k, 'receivables_pending_cents') = 300000, 'filtro por cliente (Alfa)';
  k := public.fin_dashboard_kpis(org, date '2025-06-01', date '2025-06-30', null, null, test.t('com'), null, t);
  assert test.k(k, 'income_cents') = 180000 and test.k(k, 'expense_cents') = 0, 'filtro por centro de custo (COM = 60% de 3.000,00)';
  k := public.fin_dashboard_kpis(org, date '2025-06-01', date '2025-06-30', null, test.t('cat_alug'), null, null, t);
  assert test.k(k, 'expense_cents') = 250000 and test.k(k, 'income_cents') = 0, 'filtro por categoria (Aluguel)';
  k := public.fin_dashboard_kpis(org, date '2025-06-03', date '2025-06-03', null, null, null, null, t);
  assert test.k(k, 'income_cents') = 0 and test.k(k, 'expense_cents') = 0, 'dia só com transferência: sem receita nem despesa';
  assert test.errmsg(format($q$select public.fin_dashboard_kpis(%L, date '2025-06-30', date '2025-06-01')$q$, org)) like '%período inválido%', 'período invertido';
  assert test.errmsg(format($q$select public.fin_dashboard_kpis(%L, date '2000-01-01', date '2025-06-01')$q$, org)) like '%período inválido%', 'período longo demais';
  raise notice 'PASS: filtros do painel (conta, categoria, cliente, centro de custo, período)';
end $$;

-- séries
do $$
declare org uuid := test.t('org'); t date := date '2025-06-15'; s jsonb; b jsonb;
begin
  s := public.fin_dashboard_series(org, date '2025-05-01', date '2025-06-30', null, null, null, null, t);
  assert jsonb_array_length(s -> 'monthly') = 2, 'dois meses';
  assert (s -> 'monthly' -> 0 ->> 'income_cents')::bigint = 200000 and (s -> 'monthly' -> 0 ->> 'expense_cents')::bigint = 33334, 'maio: 2.000,00 / 333,34';
  assert (s -> 'monthly' -> 1 ->> 'income_cents')::bigint = 420000 and (s -> 'monthly' -> 1 ->> 'expense_cents')::bigint = 270000, 'junho: 4.200,00 / 2.700,00';
  s := public.fin_dashboard_series(org, date '2025-06-01', date '2025-06-30', null, null, null, null, t);
  b := s -> 'balance';
  assert jsonb_array_length(b) = 30, 'saldo diário em 30 pontos';
  assert test.pick(b, 'date', '2025-06-01', 'balance_cents') = 1216666, 'saldo em 01/06';
  assert test.pick(b, 'date', '2025-06-02', 'balance_cents') = 1516666, 'saldo em 02/06 (+3.000,00)';
  assert test.pick(b, 'date', '2025-06-03', 'balance_cents') = 1516666, 'transferência não muda o consolidado';
  assert test.pick(b, 'date', '2025-06-04', 'balance_cents') = 1515166, 'saldo em 04/06 (tarifa −15,00)';
  assert test.pick(b, 'date', '2025-06-05', 'balance_cents') = 1385166, 'saldo em 05/06';
  assert test.pick(b, 'date', '2025-06-08', 'balance_cents') = 1455166 and test.pick(b, 'date', '2025-06-09', 'balance_cents') = 1385166, 'recebimento e estorno de R5';
  assert test.pick(b, 'date', '2025-06-30', 'balance_cents') = 1365166, 'saldo em 30/06';
  -- categorias
  assert s -> 'expense_by_category' -> 0 ->> 'name' = 'Aluguel' and (s -> 'expense_by_category' -> 0 ->> 'cents')::bigint = 250000 and (s -> 'expense_by_category' -> 0 ->> 'share_bps')::integer = 9259, 'despesa: Aluguel 2.500,00 (92,59%)';
  assert s -> 'expense_by_category' -> 1 ->> 'name' = 'Tecnologia' and (s -> 'expense_by_category' -> 1 ->> 'cents')::bigint = 20000 and (s -> 'expense_by_category' -> 1 ->> 'share_bps')::integer = 741, 'despesa: Tecnologia 200,00 (7,41%)';
  assert jsonb_array_length(s -> 'expense_by_category') = 2, 'só categorias com movimento';
  assert s -> 'income_by_category' -> 0 ->> 'name' = 'Serviços' and (s -> 'income_by_category' -> 0 ->> 'cents')::bigint = 300000 and (s -> 'income_by_category' -> 0 ->> 'share_bps')::integer = 7143, 'receita: Serviços 3.000,00 (71,43%)';
  assert s -> 'income_by_category' -> 1 ->> 'name' = 'Vendas' and (s -> 'income_by_category' -> 1 ->> 'cents')::bigint = 120000 and (s -> 'income_by_category' -> 1 ->> 'share_bps')::integer = 2857, 'receita: Vendas 1.200,00 (28,57%; R5 líquida zero)';
  -- centros de custo
  assert jsonb_array_length(s -> 'cost_centers') = 2, 'dois centros com movimento';
  assert test.pick(s -> 'cost_centers', 'code', 'COM', 'income_cents') = 180000 and test.pick(s -> 'cost_centers', 'code', 'OPS', 'income_cents') = 120000, 'rateio 60/40 de 3.000,00 = 1.800,00 + 1.200,00';
  -- envelhecimento (hoje = 15/06)
  assert test.pick(s -> 'payables_aging', 'bucket', 'overdue', 'cents') = 80000 and test.pick(s -> 'payables_aging', 'bucket', 'd0_7', 'cents') = 40000
     and test.pick(s -> 'payables_aging', 'bucket', 'd8_30', 'cents') = 33333 and test.pick(s -> 'payables_aging', 'bucket', 'd31_60', 'cents') = 33333 and test.pick(s -> 'payables_aging', 'bucket', 'd61p', 'cents') = 0, 'pagar por vencimento';
  assert test.pick(s -> 'receivables_aging', 'bucket', 'overdue', 'cents') = 370000 and test.pick(s -> 'receivables_aging', 'bucket', 'overdue', 'count') = 2
     and test.pick(s -> 'receivables_aging', 'bucket', 'd8_30', 'cents') = 450000 and test.pick(s -> 'receivables_aging', 'bucket', 'd0_7', 'cents') = 0, 'receber por vencimento';
  -- previsto × realizado (junho)
  assert (s -> 'planned_vs_actual' -> 0 ->> 'planned_income_cents')::bigint = 940000 and (s -> 'planned_vs_actual' -> 0 ->> 'actual_income_cents')::bigint = 420000, 'receitas: previsto 9.400,00 × realizado 4.200,00';
  assert (s -> 'planned_vs_actual' -> 0 ->> 'planned_expense_cents')::bigint = 423333 and (s -> 'planned_vs_actual' -> 0 ->> 'actual_expense_cents')::bigint = 270000, 'despesas: previsto 4.233,33 × realizado 2.700,00';
  raise notice 'PASS: séries do painel (mensal, saldo diário, categorias, centros, envelhecimento, previsto × realizado)';
end $$;

-- ===================================================================== fluxo de caixa PROJETADO
do $$
declare org uuid := test.t('org'); t date := date '2025-06-15'; n integer;
begin
  assert (select count(*) from public.fin_cashflow_projection(org, 30, 'day', 'base', null, t)) = 31, '31 pontos diários (15/06 a 15/07)';
  assert (select inflow_cents from public.fin_cashflow_projection(org, 30, 'day', 'base', null, t) where period = date '2025-06-15') = 370000, 'vencidos a receber entram em «hoje»';
  assert (select outflow_cents from public.fin_cashflow_projection(org, 30, 'day', 'base', null, t) where period = date '2025-06-15') = 80000, 'vencido a pagar entra em «hoje»';
  assert (select balance_cents from public.fin_cashflow_projection(org, 30, 'day', 'base', null, t) where period = date '2025-06-15') = 1655166, 'saldo em 15/06';
  assert (select balance_cents from public.fin_cashflow_projection(org, 30, 'day', 'base', null, t) where period = date '2025-06-18') = 1615166, 'saldo em 18/06 (−400,00)';
  assert (select balance_cents from public.fin_cashflow_projection(org, 30, 'day', 'base', null, t) where period = date '2025-06-25') = 1581833, 'saldo em 25/06 (−333,33)';
  assert (select balance_cents from public.fin_cashflow_projection(org, 30, 'day', 'base', null, t) where period = date '2025-06-30') = 2031833, 'saldo em 30/06 (+4.500,00)';
  assert (select balance_cents from public.fin_cashflow_projection(org, 30, 'day', 'base', null, t) where period = date '2025-07-01') = 2011843, 'saldo em 01/07 (regra recorrente −199,90)';
  assert (select outflow_cents from public.fin_cashflow_projection(org, 30, 'day', 'base', null, t) where period = date '2025-07-25') is null, 'parcela de 25/07 fora da janela de 30 dias';
  assert (select balance_cents from public.fin_cashflow_projection(org, 30, 'day', 'base', null, t) order by period desc limit 1) = 2011843, 'saldo final base';
  assert (select balance_cents from public.fin_cashflow_projection(org, 30, 'day', 'conservative', null, t) order by period desc limit 1) = 1929843, 'conservador: atraso 7 dias e corte de 10% nos recebimentos';
  assert (select balance_cents from public.fin_cashflow_projection(org, 30, 'day', 'optimistic', null, t) order by period desc limit 1) = 2052843, 'otimista: antecipa 3 dias e +5% nos recebimentos';
  assert (select inflow_cents from public.fin_cashflow_projection(org, 30, 'day', 'conservative', null, t) where period = date '2025-06-22') = 333000, 'conservador: R3 e R5 deslocados para 22/06 (2.700,00 + 630,00)';
  assert (select inflow_cents from public.fin_cashflow_projection(org, 30, 'day', 'optimistic', null, t) where period = date '2025-06-27') = 472500, 'otimista: R4 antecipado para 27/06 com +5%';
  -- semana e mês somam o mesmo total
  assert (select sum(inflow_cents) from public.fin_cashflow_projection(org, 30, 'week', 'base', null, t)) = 820000 and (select sum(outflow_cents) from public.fin_cashflow_projection(org, 30, 'week', 'base', null, t)) = 173323, 'semanal: totais iguais ao diário';
  assert (select min(period) from public.fin_cashflow_projection(org, 30, 'week', 'base', null, t)) = date '2025-06-09', 'semana começa na segunda-feira';
  assert (select balance_cents from public.fin_cashflow_projection(org, 30, 'week', 'base', null, t) order by period desc limit 1) = 2011843, 'semanal: saldo final igual';
  assert (select inflow_cents from public.fin_cashflow_projection(org, 30, 'month', 'base', null, t) where period = date '2025-06-01') = 820000 and (select outflow_cents from public.fin_cashflow_projection(org, 30, 'month', 'base', null, t) where period = date '2025-06-01') = 153333, 'mensal: junho';
  assert (select outflow_cents from public.fin_cashflow_projection(org, 30, 'month', 'base', null, t) where period = date '2025-07-01') = 19990, 'mensal: julho (regra)';
  -- janela de 90 dias inclui as duas últimas parcelas e mais ocorrências da regra
  assert (select sum(outflow_cents) from public.fin_cashflow_projection(org, 90, 'month', 'base', null, t)) = 153333 + 33333 + 19990 * 3, '90 dias: + parcela de 25/07 + regra em 01/07, 01/08 e 01/09';
  assert test.errmsg(format($q$select * from public.fin_cashflow_projection(%L, 0, 'day', 'base', null, date '2025-06-15')$q$, org)) like '%janela%', 'janela zero';
  assert test.errmsg(format($q$select * from public.fin_cashflow_projection(%L, 366, 'day', 'base', null, date '2025-06-15')$q$, org)) like '%janela%', 'janela acima de 365';
  assert test.errmsg(format($q$select * from public.fin_cashflow_projection(%L, 30, 'year', 'base', null, date '2025-06-15')$q$, org)) like '%granularidade%', 'granularidade inválida';
  assert test.errmsg(format($q$select * from public.fin_cashflow_projection(%L, 30, 'day', 'otimo', null, date '2025-06-15')$q$, org)) like '%cenário%', 'cenário inválido';
  raise notice 'PASS: fluxo projetado — base, conservador, otimista, diário/semanal/mensal, janelas e validações (valores à mão)';
end $$;

-- ===================================================================== fluxo de caixa REALIZADO
do $$
declare org uuid := test.t('org');
begin
  assert public.fin_cashflow_opening(org, date '2025-06-01') = 1216666, 'saldo inicial do período (31/05)';
  assert public.fin_cashflow_opening(org, date '2025-06-01', test.t('a')) = 1166666, 'saldo inicial da conta A';
  assert (select count(*) from public.fin_cashflow_realized(org, date '2025-06-01', date '2025-06-30', 'day')) = 30, '30 dias';
  assert (select inflow_cents from public.fin_cashflow_realized(org, date '2025-06-01', date '2025-06-30', 'day') where period = date '2025-06-02') = 300000, 'entrada de 02/06';
  assert (select transfers_net_cents from public.fin_cashflow_realized(org, date '2025-06-01', date '2025-06-30', 'day') where period = date '2025-06-03') = 0, 'transferência soma zero no consolidado';
  assert (select adjustments_net_cents from public.fin_cashflow_realized(org, date '2025-06-01', date '2025-06-30', 'day') where period = date '2025-06-04') = -1500, 'tarifa em coluna própria';
  assert (select inflow_cents from public.fin_cashflow_realized(org, date '2025-06-01', date '2025-06-30', 'day') where period = date '2025-06-05') = 120000 and (select outflow_cents from public.fin_cashflow_realized(org, date '2025-06-01', date '2025-06-30', 'day') where period = date '2025-06-05') = 250000, 'entradas e saídas de 05/06';
  assert (select inflow_cents from public.fin_cashflow_realized(org, date '2025-06-01', date '2025-06-30', 'day') where period = date '2025-06-09') = -70000, 'estorno reduz a entrada do dia em que ocorre';
  assert (select closing_balance_cents from public.fin_cashflow_realized(org, date '2025-06-01', date '2025-06-30', 'day') order by period desc limit 1) = 1365166, 'saldo final = inicial + entradas − saídas ± ajustes';
  assert (select sum(net_cents) from public.fin_cashflow_realized(org, date '2025-06-01', date '2025-06-30', 'month')) = 1365166 - 1216666, 'variação do mês';
  assert (select inflow_cents - outflow_cents + transfers_net_cents + adjustments_net_cents - net_cents from public.fin_cashflow_realized(org, date '2025-06-01', date '2025-06-30', 'month')) = 0, 'identidade do fluxo';
  -- conta A isolada: a transferência aparece (−1.000,00)
  assert (select transfers_net_cents from public.fin_cashflow_realized(org, date '2025-06-01', date '2025-06-30', 'month', test.t('a'))) = -100000, 'conta A: transferência enviada';
  assert (select closing_balance_cents from public.fin_cashflow_realized(org, date '2025-06-01', date '2025-06-30', 'month', test.t('a'))) = 1115166, 'conta A: saldo final';
  assert (select count(*) from public.fin_cashflow_realized(org, date '2025-06-01', date '2025-06-30', 'week')) = 6, 'seis semanas (segundas: 26/05, 02, 09, 16, 23 e 30/06)';
  assert (select min(period) from public.fin_cashflow_realized(org, date '2025-06-01', date '2025-06-30', 'week')) = date '2025-05-26', 'primeira semana começa na segunda anterior a 01/06 (domingo)';
  assert (select sum(net_cents) from public.fin_cashflow_realized(org, date '2025-06-01', date '2025-06-30', 'week')) = 1365166 - 1216666 and (select sum(inflow_cents) from public.fin_cashflow_realized(org, date '2025-06-01', date '2025-06-30', 'week')) = 420000, 'semanal soma o mesmo total do diário';
  assert test.errmsg(format($q$select * from public.fin_cashflow_realized(%L, date '2025-06-30', date '2025-06-01')$q$, org)) like '%período inválido%', 'período invertido';
  raise notice 'PASS: fluxo realizado — saldo inicial, entradas/saídas, transferências e ajustes separados, estorno, identidade do saldo';
end $$;

-- ===================================================================== relatórios
do $$
declare org uuid := test.t('org'); r jsonb; t date := date '2025-06-15';
begin
  r := public.fin_report_by_category(org, date '2025-06-01', date '2025-06-30', 'expense', 'cash');
  assert jsonb_array_length(r) = 2 and test.pick(r, 'name', 'Aluguel', 'cents') = 250000 and test.pick(r, 'name', 'Tecnologia', 'cents') = 20000, 'despesas por categoria (caixa)';
  r := public.fin_report_by_category(org, date '2025-06-01', date '2025-06-30', 'income', 'cash');
  assert jsonb_array_length(r) = 2 and test.pick(r, 'name', 'Serviços', 'cents') = 300000 and test.pick(r, 'name', 'Vendas', 'cents') = 120000, 'receitas por categoria (caixa)';
  r := public.fin_report_by_category(org, date '2025-06-01', date '2025-06-30', 'expense', 'accrual');
  assert test.pick(r, 'name', 'Aluguel', 'cents') = 250000 and test.pick(r, 'name', 'Marketing', 'cents') = 80000 and test.pick(r, 'name', 'Tecnologia', 'cents') = 60000 and jsonb_array_length(r) = 3, 'despesas por categoria (competência)';
  r := public.fin_report_by_category(org, date '2025-06-01', date '2025-06-30', 'income', 'accrual');
  assert r -> 0 ->> 'name' = 'Serviços' and (r -> 0 ->> 'cents')::bigint = 450000 and test.pick(r, 'name', 'Recorrências', 'cents') = 300000 and test.pick(r, 'name', 'Vendas', 'cents') = 190000, 'receitas por categoria (competência)';
  assert test.errmsg(format($q$select public.fin_report_by_category(%L, date '2025-06-01', date '2025-06-30', 'income', 'misto')$q$, org)) like '%regime%', 'regime inválido';

  r := public.fin_report_by_counterparty(org, date '2025-06-01', date '2025-06-30', 'customer', t);
  assert r -> 0 ->> 'name' = 'Alfa' and (r -> 0 ->> 'settled_cents')::bigint = 300000 and (r -> 0 ->> 'pending_cents')::bigint = 300000 and (r -> 0 ->> 'overdue_cents')::bigint = 300000, 'cliente Alfa: recebido 3.000,00 · pendente 3.000,00 · vencido 3.000,00';
  assert test.pick(r, 'name', 'Beta', 'settled_cents') = 120000 and test.pick(r, 'name', 'Beta', 'pending_cents') = 70000 and test.pick(r, 'name', 'Beta', 'overdue_cents') = 70000, 'cliente Beta (R5 estornada volta a pendente e vencida)';
  assert test.pick(r, 'name', 'Gama', 'pending_cents') = 450000 and test.pick(r, 'name', 'Gama', 'settled_cents') = 0 and test.pick(r, 'name', 'Gama', 'overdue_cents') = 0, 'cliente Gama: só pendente a vencer';
  r := public.fin_report_by_counterparty(org, date '2025-06-01', date '2025-06-30', 'supplier', t);
  assert test.pick(r, 'name', 'Locador', 'settled_cents') = 250000 and test.pick(r, 'name', 'Locador', 'pending_cents') = 0, 'fornecedor Locador: pago 2.500,00';
  assert test.pick(r, 'name', 'Insumos', 'pending_cents') = 66666 and test.pick(r, 'name', 'Insumos', 'settled_cents') = 0, 'fornecedor Insumos: 2 parcelas pendentes (pagamento de maio fora do período)';
  assert test.pick(r, 'name', 'Sem contraparte', 'settled_cents') = 20000 and test.pick(r, 'name', 'Sem contraparte', 'pending_cents') = 120000 and test.pick(r, 'name', 'Sem contraparte', 'overdue_cents') = 80000, 'despesas sem fornecedor agrupadas';
  assert test.errmsg(format($q$select public.fin_report_by_counterparty(%L, date '2025-06-01', date '2025-06-30', 'both')$q$, org)) like '%cliente ou fornecedor%', 'tipo inválido';

  r := public.fin_report_cost_centers(org, date '2025-06-01', date '2025-06-30');
  assert test.pick(r, 'code', 'COM', 'income_cents') = 180000 and test.pick(r, 'code', 'OPS', 'income_cents') = 120000, 'centros de custo: COM 1.800,00 · OPS 1.200,00';
  assert test.pick(r, 'name', 'Sem centro de custo', 'income_cents') = 120000 and test.pick(r, 'name', 'Sem centro de custo', 'expense_cents') = 270000 and test.pick(r, 'name', 'Sem centro de custo', 'net_cents') = -150000, 'sem centro de custo: 1.200,00 / 2.700,00';
  assert (select sum((e ->> 'income_cents')::bigint) from jsonb_array_elements(r) e) = 420000, 'receitas dos centros + sem centro = total do período';

  r := public.fin_report_monthly(org, date '2025-05-01', date '2025-06-30');
  assert (r -> 0 ->> 'cash_income_cents')::bigint = 200000 and (r -> 0 ->> 'cash_expense_cents')::bigint = 33334 and (r -> 0 ->> 'accrual_income_cents')::bigint = 500000 and (r -> 0 ->> 'accrual_expense_cents')::bigint = 100000, 'maio: caixa 2.000,00/333,34 · competência 5.000,00/1.000,00';
  assert (r -> 1 ->> 'cash_income_cents')::bigint = 420000 and (r -> 1 ->> 'cash_expense_cents')::bigint = 270000 and (r -> 1 ->> 'cash_net_cents')::bigint = 150000, 'junho: caixa';
  assert (r -> 1 ->> 'accrual_income_cents')::bigint = 940000 and (r -> 1 ->> 'accrual_expense_cents')::bigint = 390000 and (r -> 1 ->> 'accrual_net_cents')::bigint = 550000, 'junho: competência 9.400,00 / 3.900,00';
  raise notice 'PASS: relatórios — por categoria (caixa × competência), cliente/fornecedor, centro de custo, mensal (valores à mão)';
end $$;
reset role;

-- ===================================================================== permissões, isolamento e estado vazio
:as_va
do $$
declare org uuid := test.t('org');
begin
  assert test.k(public.fin_dashboard_kpis(org, date '2025-06-01', date '2025-06-30', null, null, null, null, date '2025-06-15'), 'income_cents') = 420000, 'consulta enxerga o painel';
  assert (select count(*) from public.fin_cashflow_projection(org, 30, 'day', 'base', null, date '2025-06-15')) = 31, 'consulta enxerga a projeção';
end $$;
reset role;
:as_ob
do $$
declare org uuid := test.t('org'); orgb uuid;
begin
  assert test.errmsg(format($q$select public.fin_dashboard_kpis(%L, date '2025-06-01', date '2025-06-30')$q$, org)) like '%sem permissão%', 'B não lê KPIs de A';
  assert test.errmsg(format($q$select public.fin_dashboard_series(%L, date '2025-06-01', date '2025-06-30')$q$, org)) like '%sem permissão%', 'B não lê séries de A';
  assert test.errmsg(format($q$select * from public.fin_cashflow_projection(%L, 30)$q$, org)) like '%sem permissão%', 'B não lê projeção de A';
  assert test.errmsg(format($q$select * from public.fin_cashflow_realized(%L, date '2025-06-01', date '2025-06-30')$q$, org)) like '%sem permissão%', 'B não lê fluxo de A';
  assert test.errmsg(format($q$select public.fin_report_monthly(%L, date '2025-06-01', date '2025-06-30')$q$, org)) like '%sem permissão%', 'B não lê relatório de A';
  assert test.errmsg(format($q$select public.fin_report_by_category(%L, date '2025-06-01', date '2025-06-30', 'income')$q$, org)) like '%sem permissão%', 'B não lê categorias de A';
  assert test.errmsg(format($q$select public.fin_report_cost_centers(%L, date '2025-06-01', date '2025-06-30')$q$, org)) like '%sem permissão%', 'B não lê centros de A';
  assert test.errmsg(format($q$select public.fin_report_by_counterparty(%L, date '2025-06-01', date '2025-06-30', 'customer')$q$, org)) like '%sem permissão%', 'B não lê clientes de A';
  -- empresa vazia: tudo zero, ticket médio indisponível (nulo), sem erro
  orgb := (select organization_id from public.organization_members where user_id = 'ffffffff-0000-4000-8000-0000000000b0' limit 1);
  assert test.k(public.fin_dashboard_kpis(orgb, date '2025-06-01', date '2025-06-30', null, null, null, null, date '2025-06-15'), 'balance_now_cents') = 0, 'empresa vazia: saldo zero';
  assert public.fin_dashboard_kpis(orgb, date '2025-06-01', date '2025-06-30', null, null, null, null, date '2025-06-15') -> 'avg_ticket_cents' = 'null'::jsonb, 'empresa vazia: ticket médio indisponível';
  assert jsonb_array_length(public.fin_dashboard_series(orgb, date '2025-06-01', date '2025-06-30', null, null, null, null, date '2025-06-15') -> 'expense_by_category') = 0, 'empresa vazia: sem categorias';
  assert public.fin_cashflow_opening(orgb, date '2025-06-01') = 0 and (select count(*) from public.fin_cashflow_projection(orgb, 30, 'day', 'base', null, date '2025-06-15')) = 31, 'empresa vazia: projeção em zero';
  raise notice 'PASS: isolamento A × B nas métricas e estado vazio sem erro';
end $$;
reset role;
:as_anon
do $$
begin
  assert test.errmsg($q$select public.fin_dashboard_kpis(gen_random_uuid(), date '2025-06-01', date '2025-06-30')$q$) is not null, 'anon não executa métricas';
  assert test.errmsg($q$select * from public.fin_cashflow_projection(gen_random_uuid())$q$) is not null, 'anon não executa projeção';
end $$;
reset role;

rollback;
select 'PASS 66_fin_metrics' as result;
