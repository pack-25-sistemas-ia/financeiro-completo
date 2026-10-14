-- Recorrências: geram TÍTULOS PREVISTOS (nunca baixa nem movimento), sem duplicidade, com fim de mês, bissexto, virada de ano e pausa.
-- Datas esperadas calculadas À MÃO. Início sempre no passado (2019–2023) para o resultado não depender do dia em que o teste roda.

\set as_oa 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a0","aal":"aal2","email":"oa@t.invalid"}'', true); set local role authenticated;'
\set as_na 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a2","aal":"aal1","email":"na@t.invalid"}'', true); set local role authenticated;'
\set as_va 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a3","aal":"aal1","email":"va@t.invalid"}'', true); set local role authenticated;'
\set as_ob 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000b0","aal":"aal2","email":"ob@t.invalid"}'', true); set local role authenticated;'

begin;

create function test.errmsg(q text) returns text language plpgsql as $$ begin execute q; return null; exception when others then return sqlerrm; end $$;
create function test.t(k text) returns uuid language sql as $$ select current_setting('t.' || k)::uuid $$;
create function test.dates(rule uuid) returns date[] language sql as $$ select array_agg(scheduled_date order by occurrence_index) from public.recurring_occurrences where recurring_rule_id = rule $$;
create function test.today() returns date language sql as $$ select (now() at time zone 'America/Sao_Paulo')::date $$;
grant execute on all functions in schema test to anon, authenticated;

insert into auth.users (id, email) values
  ('ffffffff-0000-4000-8000-0000000000a0', 'oa@t.invalid'), ('ffffffff-0000-4000-8000-0000000000a2', 'na@t.invalid'),
  ('ffffffff-0000-4000-8000-0000000000a3', 'va@t.invalid'), ('ffffffff-0000-4000-8000-0000000000b0', 'ob@t.invalid');

:as_oa
do $$
declare org uuid;
begin
  org := public.create_organization('Empresa Recorrente', 'empresa-rec');
  insert into public.organization_members (organization_id, user_id, role) values
    (org, 'ffffffff-0000-4000-8000-0000000000a2', 'member'), (org, 'ffffffff-0000-4000-8000-0000000000a3', 'viewer');
  perform set_config('t.org', org::text, true);
  perform set_config('t.banco', public.fin_create_account(org, 'Banco', 'checking', null, 500000, date '2019-01-01')::text, true);
  insert into public.counterparties (organization_id, kind, name) values (org, 'supplier', 'Locador') returning id into org;
  perform set_config('t.sup', org::text, true);
  perform set_config('t.cat', (select id::text from public.financial_categories where organization_id = test.t('org') and name = 'Aluguel'), true);
  perform set_config('t.cat_in', (select id::text from public.financial_categories where organization_id = test.t('org') and name = 'Recorrências'), true);
end $$;
reset role;
:as_ob
do $$ begin perform public.create_organization('Empresa B', 'empresa-b'); end $$;
reset role;

-- ===================================================================== calendário: mensal (fim de mês/bissexto), semanal, trimestral, anual, intervalo 2, término
:as_oa
do $$
declare org uuid := test.t('org'); r uuid; made integer; bal0 bigint;
begin
  select balance_cents into bal0 from public.fin_account_balances where account_id = test.t('banco');
  -- mensal a partir de 31/jan/2020, termina 30/jun/2020: 31/01, 29/02 (bissexto), 31/03, 30/04, 31/05, 30/06
  r := public.fin_create_recurring_rule(org, 'payable', 'Aluguel da sede', test.t('sup'), test.t('cat'), test.t('banco'), 250000, 'monthly', 1, date '2020-01-31', date '2020-06-30', 0);
  made := public.fin_generate_recurring(org);
  assert test.dates(r) = array[date '2020-01-31', '2020-02-29', '2020-03-31', '2020-04-30', '2020-05-31', '2020-06-30'], 'mensal: fim de mês e bissexto';
  assert (select count(*) from public.recurring_occurrences where recurring_rule_id = r and status = 'generated') = 6, 'seis ocorrências geradas';
  assert (select ended_at is not null and not active from public.recurring_rules where id = r), 'regra com término cumprido é encerrada';
  perform set_config('t.r1', r::text, true);

  -- reprocessar não duplica
  assert public.fin_generate_recurring(org) = 0, 'reprocessamento não gera nada';
  assert (select count(*) from public.financial_entries where recurring_rule_id = r) = 6, 'ainda seis títulos';

  -- o que foi gerado é PREVISTO: aberto, sem baixa, sem movimento, saldo intacto
  assert (select count(*) from public.fin_installments_view where entry_id in (select id from public.financial_entries where recurring_rule_id = r) and status = 'open' and pending_cents = 250000) = 6, 'títulos abertos de 2.500,00';
  assert (select count(*) from public.settlements) = 0 and (select count(*) from public.account_movements) = 0, 'nenhuma baixa nem movimento gerados';
  assert (select balance_cents from public.fin_account_balances where account_id = test.t('banco')) = bal0, 'saldo bancário não muda';
  assert (select bool_and(competence_date = due_date and counterparty_id = test.t('sup') and category_id = test.t('cat') and expected_account_id = test.t('banco') and amount_cents = 250000) from public.financial_entries where recurring_rule_id = r), 'dados da regra copiados para os títulos';
  assert (select count(*) from public.financial_entries e where e.recurring_rule_id = r and e.idempotency_key = 'rec:' || r::text || ':' || (select occurrence_index from public.recurring_occurrences o where o.generated_entry_id = e.id)) = 6, 'chave de idempotência por ocorrência';

  -- semanal 28/12/2020 → 18/01/2021 (virada de ano)
  r := public.fin_create_recurring_rule(org, 'payable', 'Limpeza semanal', null, null, null, 15000, 'weekly', 1, date '2020-12-28', date '2021-01-18', 0);
  perform public.fin_generate_recurring(org);
  assert test.dates(r) = array[date '2020-12-28', '2021-01-04', '2021-01-11', '2021-01-18'], 'semanal na virada de ano';

  -- trimestral 30/nov/2019 → 31/dez/2020: 30/11/19, 29/02/20 (bissexto), 30/05, 30/08, 30/11
  r := public.fin_create_recurring_rule(org, 'receivable', 'Contrato trimestral', null, test.t('cat_in'), null, 900000, 'quarterly', 1, date '2019-11-30', date '2020-12-31', 0);
  perform public.fin_generate_recurring(org);
  assert test.dates(r) = array[date '2019-11-30', '2020-02-29', '2020-05-30', '2020-08-30', '2020-11-30'], 'trimestral com fevereiro bissexto';

  -- anual a partir de 29/fev/2020 até 01/mar/2023: 29/02/20, 28/02/21, 28/02/22, 28/02/23
  r := public.fin_create_recurring_rule(org, 'payable', 'Licença anual', null, null, null, 120000, 'annual', 1, date '2020-02-29', date '2023-03-01', 0);
  perform public.fin_generate_recurring(org);
  assert test.dates(r) = array[date '2020-02-29', '2021-02-28', '2022-02-28', '2023-02-28'], 'anual a partir de 29/fev';

  -- a cada 2 meses: 15/01, 15/03, 15/05, 15/07
  r := public.fin_create_recurring_rule(org, 'payable', 'Seguro bimestral', null, null, null, 40000, 'monthly', 2, date '2020-01-15', date '2020-07-15', 0);
  perform public.fin_generate_recurring(org);
  assert test.dates(r) = array[date '2020-01-15', '2020-03-15', '2020-05-15', '2020-07-15'], 'intervalo de 2 meses';
  raise notice 'PASS: recorrência — mensal (fim de mês, bissexto), semanal, trimestral, anual, intervalo 2, término; reprocessamento sem duplicar; só títulos previstos';
end $$;
reset role;

-- ===================================================================== edição, pausa, retomada, encerramento
:as_oa
do $$
declare org uuid := test.t('org'); r uuid; skipped integer; n integer; today date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  -- regra mensal que começou há ~70 dias; pausada antes de gerar qualquer coisa
  r := public.fin_create_recurring_rule(org, 'payable', 'Internet', null, null, null, 19990, 'monthly', 1, today - 70, null, 0);
  perform public.fin_pause_recurring_rule(r);
  assert public.fin_generate_recurring(org) >= 0 and (select count(*) from public.financial_entries where recurring_rule_id = r) = 0, 'regra pausada não gera';
  skipped := public.fin_resume_recurring_rule(r);
  assert skipped >= 2, 'ao reativar, as ocorrências vencidas na pausa são registradas como puladas (≥ 2)';
  assert (select count(*) from public.recurring_occurrences where recurring_rule_id = r and status = 'skipped' and generated_entry_id is null and scheduled_date < today) = skipped, 'puladas ficam no histórico, sem título';
  perform public.fin_generate_recurring(org);
  assert (select count(*) from public.financial_entries where recurring_rule_id = r) = (select count(*) from public.recurring_occurrences where recurring_rule_id = r and status = 'generated'), 'um título por ocorrência gerada';
  assert (select coalesce(min(scheduled_date), today) from public.recurring_occurrences where recurring_rule_id = r and status = 'generated') >= today, 'nada vencido na pausa foi gerado';
  perform set_config('t.r2', r::text, true);

  -- edição vale só para as próximas ocorrências: o que já foi gerado fica como está
  r := public.fin_create_recurring_rule(org, 'payable', 'Plano de dados', null, null, null, 10000, 'monthly', 1, date '2021-01-10', null, 0);
  perform public.fin_generate_recurring(org);
  n := (select count(*) from public.financial_entries where recurring_rule_id = r);
  assert n >= 60 and (select count(distinct amount_cents) from public.financial_entries where recurring_rule_id = r) = 1, 'gerou o histórico com valor único';
  perform public.fin_update_recurring_rule(r, 'Plano de dados (novo)', null, null, null, 12000, null, 300, null);
  assert (select count(*) from public.financial_entries where recurring_rule_id = r) = n, 'editar não gera nem altera nada sozinho';
  assert (select amount_cents from public.recurring_rules where id = r) = 12000, 'regra guarda o novo valor';
  perform public.fin_generate_recurring(org);
  assert (select count(*) from public.financial_entries where recurring_rule_id = r) > n, 'antecedência maior gera ocorrências futuras';
  assert (select count(*) from public.financial_entries where recurring_rule_id = r and amount_cents = 10000) = n, 'títulos já gerados mantêm o valor antigo';
  assert (select min(due_date) from public.financial_entries where recurring_rule_id = r and amount_cents = 12000) > today, 'o novo valor só vale para vencimentos futuros';

  -- encerrar
  r := public.fin_create_recurring_rule(org, 'payable', 'Assinatura', null, null, null, 5000, 'monthly', 1, today + 5, null, 0);
  perform public.fin_end_recurring_rule(r);
  assert test.errmsg(format($q$select public.fin_resume_recurring_rule(%L)$q$, r)) like '%encerrada%', 'regra encerrada não reativa';
  assert test.errmsg(format($q$select public.fin_update_recurring_rule(%L, 'x', null, null, null, 1, null, 0, null)$q$, r)) like '%encerrada%', 'regra encerrada não edita';
  raise notice 'PASS: recorrência — pausa, retomada com ocorrências puladas, edição só para o futuro, encerramento';
end $$;
reset role;

-- ===================================================================== validações e permissões
:as_na
do $$
declare org uuid := test.t('org'); r uuid;
begin
  r := public.fin_create_recurring_rule(org, 'payable', 'Assinatura do analista', null, null, null, 5000, 'monthly', 1, date '2022-01-01', date '2022-03-01', 0);
  assert r is not null, 'analista cria regra';
  assert public.fin_generate_recurring(org) >= 3, 'analista gera';
end $$;
reset role;
:as_va
do $$
declare org uuid := test.t('org');
begin
  assert test.errmsg(format($q$select public.fin_create_recurring_rule(%L, 'payable', 'Consulta', null, null, null, 5000, 'monthly', 1, test.today(), null, 0)$q$, org)) like '%sem permissão%', 'consulta não cria regra';
  assert test.errmsg(format($q$select public.fin_generate_recurring(%L)$q$, org)) like '%sem permissão%', 'consulta não gera';
  assert test.errmsg(format($q$select public.fin_pause_recurring_rule(%L)$q$, test.t('r1'))) like '%sem permissão%', 'consulta não pausa';
  assert (select count(*) from public.recurring_rules) >= 6 and (select count(*) from public.recurring_occurrences) > 0, 'consulta lê regras e ocorrências';
end $$;
reset role;
:as_ob
do $$
declare org uuid := test.t('org');
begin
  assert test.errmsg(format($q$select public.fin_generate_recurring(%L)$q$, org)) like '%sem permissão%', 'B não gera na empresa A';
  assert test.errmsg(format($q$select public.fin_pause_recurring_rule(%L)$q$, test.t('r1'))) like '%sem permissão%', 'B não pausa regra de A';
  assert (select count(*) from public.recurring_rules) = 0 and (select count(*) from public.recurring_occurrences) = 0, 'B não enxerga regras de A';
end $$;
reset role;
:as_oa
do $$
declare org uuid := test.t('org');
begin
  assert test.errmsg(format($q$select public.fin_create_recurring_rule(%L, 'payable', 'Zero', null, null, null, 0, 'monthly', 1, test.today(), null, 0)$q$, org)) like '%positivo%', 'valor zero';
  assert test.errmsg(format($q$select public.fin_create_recurring_rule(%L, 'payable', 'Fim antes do início', null, null, null, 100, 'monthly', 1, test.today(), test.today() - 1, 0)$q$, org)) like '%término%', 'término anterior ao início';
  assert test.errmsg(format($q$select public.fin_create_recurring_rule(%L, 'payable', 'Categoria errada', null, %L, null, 100, 'monthly', 1, test.today(), null, 0)$q$, org, test.t('cat_in'))) like '%natureza incompatível%', 'categoria de receita em despesa';
  assert test.errmsg(format($q$select public.fin_create_recurring_rule(%L, 'payable', 'Intervalo inválido', null, null, null, 100, 'monthly', 13, test.today(), null, 0)$q$, org)) is not null, 'intervalo fora de 1–12';
  assert test.errmsg($q$update public.recurring_occurrences set status = 'skipped'$q$) is not null, 'ocorrências não são editáveis';
  raise notice 'PASS: recorrência — permissões, isolamento e validações';
end $$;
reset role;

-- ocorrências são imutáveis também para o dono do schema
do $$
begin
  assert test.errmsg($q$update public.recurring_occurrences set scheduled_date = scheduled_date + 1$q$) like '%imutável%', 'ocorrência imutável';
  assert test.errmsg($q$delete from public.recurring_occurrences$q$) like '%imutável%', 'ocorrência não é apagada';
  assert test.errmsg($q$delete from public.recurring_rules$q$) like '%não podem ser apagados%', 'regra não é apagada';
  assert test.errmsg($q$insert into public.recurring_occurrences (organization_id, recurring_rule_id, occurrence_index, scheduled_date, status, generated_entry_id)
    select organization_id, recurring_rule_id, occurrence_index, scheduled_date + 100, 'generated', generated_entry_id from public.recurring_occurrences where status = 'generated' limit 1$q$) like '%duplicate key%', 'mesma ocorrência não duplica (índice único)';
  raise notice 'PASS: ocorrências imutáveis e únicas por regra e índice';
end $$;

rollback;
select 'PASS 63_fin_recurring' as result;
