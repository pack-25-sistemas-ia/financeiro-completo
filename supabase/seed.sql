-- ARQUIVO GERADO por scripts/gen-seed.mjs — NÃO edite à mão. Dados de DEMONSTRAÇÃO, fictícios e determinísticos.
-- Empresa: «Nova Horizonte Serviços Ltda. (dados fictícios)». Usuários @demo.exemplo, senha local: DemoLocal#2026
--   dono@ (administrador) · gestor@ (gestor financeiro) · analista@ (analista financeiro) · consulta@ (consulta)
-- Tudo que movimenta dinheiro nasce pelas funções do sistema (fin_*), nunca por INSERT direto no livro. Datas relativas ao dia da criação do banco.
-- Só para ambiente local/demonstração; nunca use em produção.

create function pg_temp.today() returns date language sql stable as $f$ select (now() at time zone 'America/Sao_Paulo')::date $f$;
create function pg_temp.d(n int) returns date language sql stable as $f$ select pg_temp.today() - n $f$;
-- instante «N dias atrás» ao meio-dia (horário de Brasília); N = 0 → agora
create function pg_temp.ts(n int) returns timestamptz language sql stable as $f$
  select case when n <= 0 then now() else ((pg_temp.today() - n)::timestamp + time '12:00') at time zone 'America/Sao_Paulo' end $f$;

create temp table seedmap (k text primary key, id uuid not null);
create function pg_temp.id(p_k text) returns uuid language sql stable as $f$ select id from seedmap where k = p_k $f$;
create function pg_temp.org() returns uuid language sql immutable as $f$ select 'f6f6f6f6-0000-4000-8000-000000000001'::uuid $f$;
create function pg_temp.cat(p_name text) returns uuid language sql stable as $f$
  select id from public.financial_categories where organization_id = pg_temp.org() and lower(name) = lower(p_name) limit 1 $f$;
create function pg_temp.cp(p_name text) returns uuid language sql stable as $f$
  select id from public.counterparties where organization_id = pg_temp.org() and name = p_name limit 1 $f$;

create function pg_temp.mk_account(p_k text, p_name text, p_type text, p_inst text, p_open bigint, p_ago int, p_inc boolean, p_neg boolean) returns void language plpgsql as $f$
begin
  insert into seedmap values (p_k, public.fin_create_account(pg_temp.org(), p_name, p_type::public.fin_account_type, p_inst, p_open, pg_temp.d(p_ago), p_inc, p_neg));
end $f$;

create function pg_temp.mk_entry(p_k text, p_type text, p_desc text, p_cp text, p_cat text, p_acct text, p_amount bigint, p_issue int, p_comp int, p_due int, p_n int, p_freq text, p_alloc jsonb) returns void language plpgsql as $f$
declare alloc jsonb;
begin
  select jsonb_agg(jsonb_build_object('cost_center_id', (select id from public.cost_centers where organization_id = pg_temp.org() and code = a ->> 'cost_center'), 'weight', (a ->> 'weight')::bigint))
    into alloc from jsonb_array_elements(coalesce(p_alloc, '[]'::jsonb)) a;
  insert into seedmap values (p_k, public.fin_create_entry(pg_temp.org(), p_type::public.fin_entry_type, p_desc, pg_temp.cp(p_cp), pg_temp.cat(p_cat), pg_temp.id(p_acct), p_amount,
    pg_temp.d(p_issue), pg_temp.d(p_comp), pg_temp.d(p_due), p_n, p_freq, null, 'seed-entry-' || p_k, alloc, null));
end $f$;

-- Dá baixa nas parcelas 1..p_upto (se vencidas há ao menos p_min_age dias): p_pct% do pendente, na data de vencimento + p_lag dias (nunca no futuro).
create function pg_temp.pay(p_k text, p_upto int, p_acct text, p_pct int, p_lag int, p_method text, p_min_age int) returns void language plpgsql as $f$
declare i record; when_ date; amt bigint; pend bigint;
begin
  for i in select * from public.financial_installments where entry_id = pg_temp.id(p_k) and installment_number <= p_upto order by installment_number loop
    when_ := least(i.due_date + p_lag, pg_temp.today());
    if i.due_date > pg_temp.today() - p_min_age then continue; end if;
    select i.amount_cents - coalesce(sum(st.amount_cents), 0) into pend from public.settlements st where st.installment_id = i.id and st.reversed_at is null;
    amt := case when p_pct >= 100 then pend else (pend * p_pct / 100) end;
    if amt <= 0 then continue; end if;
    perform public.fin_settle_installment(i.id, pg_temp.id(p_acct), amt, pg_temp.ts(pg_temp.today() - when_), p_method, null, 'seed-pay-' || p_k || '-' || i.installment_number || '-' || p_pct);
  end loop;
end $f$;

create function pg_temp.reverse(p_k text, p_no int, p_reason text) returns void language plpgsql as $f$
begin
  perform public.fin_reverse_settlement((select s.id from public.settlements s join public.financial_installments i on i.id = s.installment_id
    where i.entry_id = pg_temp.id(p_k) and i.installment_number = p_no and s.reversed_at is null order by s.created_at limit 1), p_reason);
end $f$;
create function pg_temp.cancel(p_k text, p_reason text) returns void language plpgsql as $f$ begin perform public.fin_cancel_entry(pg_temp.id(p_k), p_reason); end $f$;
create function pg_temp.xfer(p_k text, p_from text, p_to text, p_amount bigint, p_ago int, p_desc text) returns void language plpgsql as $f$
begin perform public.fin_create_transfer(pg_temp.org(), pg_temp.id(p_from), pg_temp.id(p_to), p_amount, pg_temp.ts(p_ago), p_desc, 'seed-xfer-' || p_k); end $f$;
create function pg_temp.adj(p_k text, p_acct text, p_amount bigint, p_kind text, p_reason text, p_ago int) returns void language plpgsql as $f$
begin perform public.fin_create_adjustment(pg_temp.org(), pg_temp.id(p_acct), p_amount, p_kind::public.fin_adjustment_kind, p_reason, pg_temp.ts(p_ago), 'seed-adj-' || p_k); end $f$;

create function pg_temp.mk_rule(p_desc text, p_type text, p_cp text, p_cat text, p_acct text, p_amount bigint, p_freq text, p_interval int, p_start int, p_lead int) returns void language plpgsql as $f$
begin
  perform public.fin_create_recurring_rule(pg_temp.org(), p_type::public.fin_entry_type, p_desc, pg_temp.cp(p_cp), pg_temp.cat(p_cat), pg_temp.id(p_acct), p_amount, p_freq::public.fin_frequency, p_interval, pg_temp.d(p_start), null, p_lead, null);
end $f$;
create function pg_temp.gen_rules() returns void language plpgsql as $f$ begin perform public.fin_generate_recurring(pg_temp.org()); end $f$;

-- Paga as ocorrências vencidas de uma regra; as p_leave mais recentes (vencidas) ficam em aberto para demonstrar atrasos.
create function pg_temp.pay_rule(p_desc text, p_acct text, p_lag int, p_leave int) returns void language plpgsql as $f$
declare r record; skip int := p_leave;
begin
  for r in select e.id, i.id as inst, i.due_date, i.amount_cents from public.financial_entries e join public.financial_installments i on i.entry_id = e.id
           where e.organization_id = pg_temp.org() and e.description = p_desc and e.recurring_rule_id is not null and i.due_date < pg_temp.today() order by i.due_date desc loop
    if skip > 0 then skip := skip - 1; continue; end if;
    perform public.fin_settle_installment(r.inst, pg_temp.id(p_acct), r.amount_cents, pg_temp.ts(pg_temp.today() - least(r.due_date + p_lag, pg_temp.today())),
      case when p_acct = 'nubank' then 'card' else 'pix' end, null, 'seed-rule-' || r.inst::text);
  end loop;
end $f$;

-- Extrato do Itaú dos últimos 35 dias a partir do livro: a maioria é conciliada, uma com diferença, uma ignorada e algumas ficam pendentes.
create function pg_temp.statement_demo() returns void language plpgsql as $f$
declare acct uuid := pg_temp.id('itau'); rows_ jsonb; m record; k int := 0; imp jsonb; lid uuid; mid uuid; sug record; recon int := 0;
begin
  select jsonb_agg(jsonb_build_object('row_number', x.rn, 'reference', x.ref, 'hash', encode(sha256(convert_to('seed-stmt|' || x.id::text, 'UTF8')), 'hex'),
      'data', jsonb_build_object('date', x.d, 'amount_cents', x.amt, 'description', x.dsc, 'external_reference', x.ref)) order by x.d, x.id)
    into rows_
  from (select y.*, row_number() over (order by y.d, y.id) as rn from (
    select m2.id, (m2.effective_at at time zone 'America/Sao_Paulo')::date as d,
           case when m2.id = (select id from public.account_movements where account_id = acct and movement_type = 'settlement' and amount_cents < 0 and effective_at > now() - interval '30 days' order by effective_at limit 1) then m2.amount_cents - 500 else m2.amount_cents end as amt,
           upper(case m2.movement_type when 'settlement' then (case when m2.amount_cents > 0 then 'PIX RECEBIDO ' else 'PAGTO TITULO ' end) || coalesce(left(m2.description, 24), '') when 'transfer_out' then 'TED ENVIADA' when 'transfer_in' then 'TED RECEBIDA'
                       when 'settlement_reversal' then 'ESTORNO' else 'TARIFA / AJUSTE' end) as dsc,
           'NH' || substr(replace(m2.id::text, '-', ''), 1, 10) as ref
    from public.account_movements m2 where m2.account_id = acct and m2.effective_at > now() - interval '35 days'
    union all
    select gen_random_uuid(), pg_temp.today() - 2, 18_732, 'RENDIMENTO CONTA REMUNERADA', 'NHRENDIM01'
    union all
    select gen_random_uuid(), pg_temp.today() - 9, -4_190, 'DEBITO AUTOMATICO NAO IDENTIFICADO', 'NHDEBAUT01'
  ) y) x;
  if rows_ is null then return; end if;
  imp := public.fin_create_import(pg_temp.org(), 'statement', 'extrato-demo-itau.csv', encode(sha256(convert_to('seed-extrato-demo', 'UTF8')), 'hex'), acct, rows_);
  perform public.fin_commit_import((imp ->> 'import_id')::uuid);
  -- concilia as sugestões NÃO ambíguas de valor igual (a primeira de cada linha); diferenças e ambíguas ficam para decisão humana
  for sug in select s.* from public.fin_suggest_matches(pg_temp.org(), acct, 3) s where s.amount_equal and not s.ambiguous order by s.score desc loop
    begin
      perform public.fin_reconcile(sug.line_id, sug.movement_id);
      recon := recon + 1;
    exception when others then null; end;
  end loop;
  -- a linha com diferença de R$ 5,00 é conciliada com justificativa (fica «divergente»)
  select s.* into sug from public.fin_suggest_matches(pg_temp.org(), acct, 3) s where not s.amount_equal order by s.score desc limit 1;
  if found then perform public.fin_reconcile(sug.line_id, sug.movement_id, 'Banco debitou R$ 5,00 a menos; conferir com o gerente.'); end if;
  select l.id into lid from public.bank_statement_lines l where l.account_id = acct and l.description = 'DEBITO AUTOMATICO NAO IDENTIFICADO';
  if lid is not null then perform public.fin_ignore_statement_line(lid, 'Débito de teste do banco já estornado; sem reflexo no caixa.'); end if;
end $f$;

create function pg_temp.goal_demo() returns void language plpgsql as $f$
begin
  insert into public.financial_goals (organization_id, name, metric_type, target_amount_cents, period_start, period_end, created_by)
  values (pg_temp.org(), 'Receita realizada do mês', 'income', 15000000, date_trunc('month', pg_temp.today())::date, (date_trunc('month', pg_temp.today()) + interval '1 month - 1 day')::date, 'f6f6f6f6-0000-4000-8000-0000000000a1'),
         (pg_temp.org(), 'Teto de despesas do mês', 'expense', 9000000, date_trunc('month', pg_temp.today())::date, (date_trunc('month', pg_temp.today()) + interval '1 month - 1 day')::date, 'f6f6f6f6-0000-4000-8000-0000000000a1');
end $f$;

do $seed$
declare
  org uuid := 'f6f6f6f6-0000-4000-8000-000000000001';
  pw text := extensions.crypt('DemoLocal#2026', extensions.gen_salt('bf'));
begin
  if exists (select 1 from public.organizations where id = org) then return; end if; -- já semeado
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
  select '00000000-0000-0000-0000-000000000000', v.id::uuid, 'authenticated', 'authenticated', v.email, pw, now(), '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('full_name', v.nome), now(), now(), '', '', '', ''
  from (values
    ('f6f6f6f6-0000-4000-8000-0000000000a1', 'dono@demo.exemplo', 'Helena Souza'), ('f6f6f6f6-0000-4000-8000-0000000000a2', 'gestor@demo.exemplo', 'Rafael Lima'),
    ('f6f6f6f6-0000-4000-8000-0000000000a3', 'analista@demo.exemplo', 'Camila Prado'), ('f6f6f6f6-0000-4000-8000-0000000000a4', 'consulta@demo.exemplo', 'Lívia Torres')
  ) as v(id, email, nome);
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  select gen_random_uuid(), u.id, u.email, jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true), 'email', now(), now(), now() from auth.users u where u.email like '%@demo.exemplo';
  update public.profiles p set full_name = u.raw_user_meta_data ->> 'full_name' from auth.users u where u.id = p.id and u.email like '%@demo.exemplo';
  insert into public.organizations (id, name, slug) values (org, 'Nova Horizonte Serviços Ltda. (dados fictícios)', 'nova-horizonte');
  insert into public.organization_settings (organization_id, display_name, theme) values (org, 'Nova Horizonte Serviços', '{"primary":"#162a43"}'::jsonb);
  insert into public.organization_members (organization_id, user_id, role) values
    (org, 'f6f6f6f6-0000-4000-8000-0000000000a1', 'owner'), (org, 'f6f6f6f6-0000-4000-8000-0000000000a2', 'manager'), (org, 'f6f6f6f6-0000-4000-8000-0000000000a3', 'member'), (org, 'f6f6f6f6-0000-4000-8000-0000000000a4', 'viewer');
  -- cadastros (categorias padrão nascem por gatilho)
  insert into public.counterparties (organization_id, kind, name, legal_name, document_number, email, phone) values
    (org, 'customer', 'Alfa Indústria de Embalagens Ltda', 'Alfa Indústria de Embalagens Ltda', '11222333000181', 'financeiro1@cliente.exemplo', '(11) 4000-1000'),
    (org, 'customer', 'Beta Comércio de Peças Ltda', 'Beta Comércio de Peças Ltda', '45723174000110', 'financeiro2@cliente.exemplo', '(11) 4000-1010'),
    (org, 'customer', 'Gama Consultoria Empresarial', 'Gama Consultoria Empresarial', '11444777000161', 'financeiro3@cliente.exemplo', '(11) 4000-1020'),
    (org, 'customer', 'Delta Logística e Transportes', 'Delta Logística e Transportes', '33444555000122', 'financeiro4@cliente.exemplo', '(11) 4000-1030'),
    (org, 'customer', 'Épsilon Clínica Integrada', 'Épsilon Clínica Integrada', '55666777000133', 'financeiro5@cliente.exemplo', '(11) 4000-1040'),
    (org, 'customer', 'Zeta Educação Profissional', 'Zeta Educação Profissional', '77888999000144', 'financeiro6@cliente.exemplo', '(11) 4000-1050'),
    (org, 'supplier', 'Imobiliária Central', 'Imobiliária Central', '12345670000101', 'contato1@fornecedor.exemplo', '(11) 4000-2000'),
    (org, 'supplier', 'NetFibra Telecom', 'NetFibra Telecom', '23456780000102', 'contato2@fornecedor.exemplo', '(11) 4000-2010'),
    (org, 'supplier', 'Papelaria Pontual', 'Papelaria Pontual', '34567890000103', 'contato3@fornecedor.exemplo', '(11) 4000-2020'),
    (org, 'supplier', 'Agência Pixel Marketing', 'Agência Pixel Marketing', '45678900000104', 'contato4@fornecedor.exemplo', '(11) 4000-2030'),
    (org, 'supplier', 'CloudSoft Licenças', 'CloudSoft Licenças', '56789010000105', 'contato5@fornecedor.exemplo', '(11) 4000-2040'),
    (org, 'supplier', 'Contabilidade Exata', 'Contabilidade Exata', '67890120000106', 'contato6@fornecedor.exemplo', '(11) 4000-2050'),
    (org, 'supplier', 'Transportes Rápido', 'Transportes Rápido', '78901230000107', 'contato7@fornecedor.exemplo', '(11) 4000-2060');
  insert into public.cost_centers (organization_id, name, code) values (org, 'Administrativo', 'ADM'), (org, 'Comercial', 'COM'), (org, 'Marketing', 'MKT'), (org, 'Operações', 'OPS'), (org, 'Tecnologia', 'TEC');
  insert into public.financial_categories (organization_id, parent_id, name, nature) select org, p.id, 'Salários', 'expense'::public.fin_nature from public.financial_categories p where p.organization_id = org and p.name = 'Pessoal';
  insert into public.financial_categories (organization_id, parent_id, name, nature) select org, p.id, 'Encargos e benefícios', 'expense'::public.fin_nature from public.financial_categories p where p.organization_id = org and p.name = 'Pessoal';
  insert into public.financial_categories (organization_id, parent_id, name, nature) select org, p.id, 'Licenças de software', 'expense'::public.fin_nature from public.financial_categories p where p.organization_id = org and p.name = 'Tecnologia';
  insert into public.financial_categories (organization_id, parent_id, name, nature) select org, p.id, 'Infraestrutura', 'expense'::public.fin_nature from public.financial_categories p where p.organization_id = org and p.name = 'Tecnologia';
  update public.fin_settings set alert_days_before = 5 where organization_id = org;
  -- a partir daqui, as operações usam a sessão do proprietário (claims), exatamente como o app
  perform set_config('request.jwt.claims', '{"sub":"f6f6f6f6-0000-4000-8000-0000000000a1","aal":"aal2","role":"authenticated"}', true);
  perform pg_temp.mk_account('itau', 'Itaú Empresas (fictício)', 'checking', 'Banco fictício Itaú', 8200000, 180, true, true);
  perform pg_temp.mk_account('nubank', 'Conta digital PJ', 'digital', 'Fintech fictícia', 1450000, 180, true, true);
  perform pg_temp.mk_account('caixa', 'Caixa da matriz', 'cash', null, 200000, 180, true, false);
  perform pg_temp.mk_account('reserva', 'Reserva de emergência', 'savings', 'Banco fictício Itaú', 5000000, 180, false, false);
end $seed$;

do $ops$
begin
  if not exists (select 1 from public.organizations where id = 'f6f6f6f6-0000-4000-8000-000000000001') or exists (select 1 from public.financial_entries where organization_id = 'f6f6f6f6-0000-4000-8000-000000000001') then return; end if;
  perform set_config('request.jwt.claims', '{"sub":"f6f6f6f6-0000-4000-8000-0000000000a1","aal":"aal2","role":"authenticated"}', true);
  perform pg_temp.mk_entry('e001', 'receivable', 'Projeto de implantação — fase #51', 'Alfa Indústria de Embalagens Ltda', 'Serviços', 'itau', 650000, 170, 170, 140, 1, 'monthly', '[{"cost_center":"COM","weight":60},{"cost_center":"OPS","weight":40}]'::jsonb);
  perform pg_temp.pay('e001', 99, 'itau', 100, 0, 'boleto', 0);
  perform pg_temp.mk_entry('e002', 'receivable', 'Atendimento corporativo #52', 'Épsilon Clínica Integrada', 'Serviços', 'itau', 680000, 173, 173, 150, 1, 'monthly', '[{"cost_center":"OPS","weight":70},{"cost_center":"COM","weight":30}]'::jsonb);
  perform pg_temp.pay('e002', 1, 'nubank', 50, 1, 'pix', 0);
  perform pg_temp.pay('e002', 99, 'itau', 100, 11, 'pix', 3);
  perform pg_temp.mk_entry('e003', 'receivable', 'Treinamento in company #53', 'Zeta Educação Profissional', 'Serviços', 'itau', 960000, 160, 160, 142, 1, 'monthly', '[{"cost_center":"COM","weight":100}]'::jsonb);
  perform pg_temp.pay('e003', 99, 'itau', 100, 2, 'pix', 0);
  perform pg_temp.mk_entry('e004', 'receivable', 'Contrato de logística — adicional #54', 'Delta Logística e Transportes', 'Serviços', 'itau', 1010050, 173, 173, 152, 1, 'monthly', '[{"cost_center":"OPS","weight":70},{"cost_center":"COM","weight":30}]'::jsonb);
  perform pg_temp.pay('e004', 99, 'itau', 100, 2, 'boleto', 0);
  perform pg_temp.mk_entry('e005', 'payable', 'Folha de pagamento (5 mês(es) atrás)', null, 'Salários', 'itau', 1845000, 162, 155, 155, 1, 'monthly', '[{"cost_center":"ADM","weight":40},{"cost_center":"OPS","weight":40},{"cost_center":"COM","weight":20}]'::jsonb);
  perform pg_temp.pay('e005', 99, 'itau', 100, 0, 'transfer', 0);
  perform pg_temp.mk_entry('e006', 'payable', 'Encargos e benefícios (5m)', null, 'Encargos e benefícios', 'itau', 618040, 160, 155, 153, 1, 'monthly', '[{"cost_center":"ADM","weight":50},{"cost_center":"OPS","weight":50}]'::jsonb);
  perform pg_temp.pay('e006', 99, 'itau', 100, 0, 'boleto', 0);
  perform pg_temp.mk_entry('e007', 'payable', 'Honorários contábeis (5m)', 'Contabilidade Exata', 'Administrativas', 'itau', 115000, 164, 158, 158, 1, 'monthly', '[{"cost_center":"ADM","weight":1}]'::jsonb);
  perform pg_temp.pay('e007', 99, 'itau', 100, 0, 'boleto', 0);
  perform pg_temp.mk_entry('e008', 'payable', 'Campanha de marketing digital (5m)', 'Agência Pixel Marketing', 'Marketing', 'nubank', 290000, 170, 162, 161, 1, 'monthly', '[{"cost_center":"MKT","weight":80},{"cost_center":"COM","weight":20}]'::jsonb);
  perform pg_temp.pay('e008', 99, 'nubank', 100, 0, 'pix', 0);
  perform pg_temp.mk_entry('e009', 'payable', 'Material e insumos (5m)', 'Papelaria Pontual', 'Logística', 'caixa', 260070, 168, 165, 161, 1, 'monthly', null);
  perform pg_temp.pay('e009', 99, 'itau', 100, 0, 'pix', 0);
  perform pg_temp.xfer('t010', 'itau', 'caixa', 300000, 172, 'Reforço do caixa da matriz');
  perform pg_temp.adj('a011', 'itau', -8990, 'fee', 'Tarifa mensal de manutenção da conta', 151);
  perform pg_temp.adj('a012', 'reserva', 31245, 'interest', 'Rendimento mensal da reserva', 152);
  perform pg_temp.mk_entry('e013', 'receivable', 'Treinamento in company #41', 'Zeta Educação Profissional', 'Serviços', 'itau', 1400000, 146, 146, 128, 1, 'monthly', '[{"cost_center":"COM","weight":60},{"cost_center":"OPS","weight":40}]'::jsonb);
  perform pg_temp.pay('e013', 99, 'itau', 100, 0, 'pix', 0);
  perform pg_temp.mk_entry('e014', 'receivable', 'Venda de lote de peças #42', 'Beta Comércio de Peças Ltda', 'Vendas', 'itau', 810050, 128, 128, 106, 1, 'monthly', '[{"cost_center":"COM","weight":60},{"cost_center":"OPS","weight":40}]'::jsonb);
  perform pg_temp.pay('e014', 99, 'itau', 100, 0, 'boleto', 0);
  perform pg_temp.mk_entry('e015', 'receivable', 'Consultoria mensal de processos #43', 'Gama Consultoria Empresarial', 'Serviços', 'itau', 950050, 145, 145, 121, 1, 'monthly', '[{"cost_center":"OPS","weight":70},{"cost_center":"COM","weight":30}]'::jsonb);
  perform pg_temp.pay('e015', 99, 'nubank', 100, 4, 'transfer', 0);
  perform pg_temp.mk_entry('e016', 'receivable', 'Treinamento in company #44', 'Zeta Educação Profissional', 'Serviços', 'itau', 1650090, 130, 130, 111, 1, 'monthly', '[{"cost_center":"OPS","weight":70},{"cost_center":"COM","weight":30}]'::jsonb);
  perform pg_temp.pay('e016', 99, 'nubank', 100, 6, 'boleto', 0);
  perform pg_temp.mk_entry('e017', 'payable', 'Folha de pagamento (4 mês(es) atrás)', null, 'Salários', 'itau', 1845000, 132, 125, 125, 1, 'monthly', '[{"cost_center":"ADM","weight":40},{"cost_center":"OPS","weight":40},{"cost_center":"COM","weight":20}]'::jsonb);
  perform pg_temp.pay('e017', 99, 'itau', 100, 0, 'transfer', 0);
  perform pg_temp.mk_entry('e018', 'payable', 'Encargos e benefícios (4m)', null, 'Encargos e benefícios', 'itau', 618040, 130, 125, 123, 1, 'monthly', '[{"cost_center":"ADM","weight":50},{"cost_center":"OPS","weight":50}]'::jsonb);
  perform pg_temp.pay('e018', 99, 'itau', 100, 0, 'boleto', 0);
  perform pg_temp.mk_entry('e019', 'payable', 'Honorários contábeis (4m)', 'Contabilidade Exata', 'Administrativas', 'itau', 115000, 134, 128, 128, 1, 'monthly', '[{"cost_center":"ADM","weight":1}]'::jsonb);
  perform pg_temp.pay('e019', 99, 'itau', 100, 0, 'boleto', 0);
  perform pg_temp.mk_entry('e020', 'payable', 'Campanha de marketing digital (4m)', 'Agência Pixel Marketing', 'Marketing', 'nubank', 310000, 140, 132, 131, 1, 'monthly', '[{"cost_center":"MKT","weight":80},{"cost_center":"COM","weight":20}]'::jsonb);
  perform pg_temp.pay('e020', 99, 'nubank', 100, 1, 'pix', 0);
  perform pg_temp.mk_entry('e021', 'payable', 'Material e insumos (4m)', 'Papelaria Pontual', 'Fornecedores', 'caixa', 90070, 138, 135, 131, 1, 'monthly', null);
  perform pg_temp.pay('e021', 99, 'nubank', 100, 1, 'pix', 0);
  perform pg_temp.xfer('t022', 'itau', 'caixa', 300000, 142, 'Reforço do caixa da matriz');
  perform pg_temp.adj('a023', 'itau', -8990, 'fee', 'Tarifa mensal de manutenção da conta', 121);
  perform pg_temp.adj('a024', 'reserva', 31245, 'interest', 'Rendimento mensal da reserva', 122);
  perform pg_temp.mk_entry('e025', 'receivable', 'Consultoria mensal de processos #31', 'Gama Consultoria Empresarial', 'Serviços', 'itau', 600000, 100, 100, 88, 1, 'monthly', '[{"cost_center":"COM","weight":60},{"cost_center":"OPS","weight":40}]'::jsonb);
  perform pg_temp.pay('e025', 99, 'nubank', 100, 5, 'pix', 0);
  perform pg_temp.mk_entry('e026', 'receivable', 'Consultoria mensal de processos #32', 'Gama Consultoria Empresarial', 'Serviços', 'itau', 1330000, 110, 110, 92, 1, 'monthly', '[{"cost_center":"OPS","weight":70},{"cost_center":"COM","weight":30}]'::jsonb);
  perform pg_temp.pay('e026', 99, 'nubank', 100, 3, 'pix', 0);
  perform pg_temp.mk_entry('e027', 'receivable', 'Consultoria mensal de processos #33', 'Gama Consultoria Empresarial', 'Serviços', 'itau', 1480050, 106, 106, 84, 3, 'monthly', '[{"cost_center":"COM","weight":100}]'::jsonb);
  perform pg_temp.pay('e027', 1, 'itau', 50, 0, 'pix', 0);
  perform pg_temp.mk_entry('e028', 'receivable', 'Atendimento corporativo #34', 'Épsilon Clínica Integrada', 'Serviços', 'itau', 1390050, 102, 102, 77, 1, 'monthly', '[{"cost_center":"OPS","weight":70},{"cost_center":"COM","weight":30}]'::jsonb);
  perform pg_temp.pay('e028', 99, 'itau', 100, 1, 'pix', 0);
  perform pg_temp.mk_entry('e029', 'payable', 'Folha de pagamento (3 mês(es) atrás)', null, 'Salários', 'itau', 1845000, 102, 95, 95, 1, 'monthly', '[{"cost_center":"ADM","weight":40},{"cost_center":"OPS","weight":40},{"cost_center":"COM","weight":20}]'::jsonb);
  perform pg_temp.pay('e029', 99, 'itau', 100, 0, 'transfer', 0);
  perform pg_temp.mk_entry('e030', 'payable', 'Encargos e benefícios (3m)', null, 'Encargos e benefícios', 'itau', 618040, 100, 95, 93, 1, 'monthly', '[{"cost_center":"ADM","weight":50},{"cost_center":"OPS","weight":50}]'::jsonb);
  perform pg_temp.pay('e030', 99, 'itau', 100, 0, 'boleto', 0);
  perform pg_temp.mk_entry('e031', 'payable', 'Honorários contábeis (3m)', 'Contabilidade Exata', 'Administrativas', 'itau', 115000, 104, 98, 98, 1, 'monthly', '[{"cost_center":"ADM","weight":1}]'::jsonb);
  perform pg_temp.pay('e031', 99, 'itau', 100, 0, 'boleto', 0);
  perform pg_temp.mk_entry('e032', 'payable', 'Campanha de marketing digital (3m)', 'Agência Pixel Marketing', 'Marketing', 'nubank', 340000, 110, 102, 101, 1, 'monthly', '[{"cost_center":"MKT","weight":80},{"cost_center":"COM","weight":20}]'::jsonb);
  perform pg_temp.pay('e032', 99, 'nubank', 100, 0, 'pix', 0);
  perform pg_temp.mk_entry('e033', 'payable', 'Material e insumos (3m)', 'Transportes Rápido', 'Fornecedores', 'caixa', 240070, 108, 105, 101, 2, 'monthly', null);
  perform pg_temp.pay('e033', 99, 'nubank', 100, 1, 'pix', 0);
  perform pg_temp.xfer('t034', 'itau', 'caixa', 300000, 112, 'Reforço do caixa da matriz');
  perform pg_temp.adj('a035', 'itau', -8990, 'fee', 'Tarifa mensal de manutenção da conta', 91);
  perform pg_temp.adj('a036', 'reserva', 31245, 'interest', 'Rendimento mensal da reserva', 92);
  perform pg_temp.mk_entry('e037', 'receivable', 'Treinamento in company #21', 'Zeta Educação Profissional', 'Serviços', 'itau', 1410000, 85, 85, 73, 1, 'monthly', '[{"cost_center":"COM","weight":100}]'::jsonb);
  perform pg_temp.pay('e037', 99, 'nubank', 100, 1, 'pix', 0);
  perform pg_temp.mk_entry('e038', 'receivable', 'Atendimento corporativo #22', 'Épsilon Clínica Integrada', 'Serviços', 'itau', 1100090, 79, 79, 60, 1, 'monthly', '[{"cost_center":"COM","weight":100}]'::jsonb);
  perform pg_temp.pay('e038', 1, 'itau', 50, 2, 'pix', 0);
  perform pg_temp.pay('e038', 99, 'itau', 100, 13, 'pix', 3);
  perform pg_temp.mk_entry('e039', 'receivable', 'Treinamento in company #23', 'Zeta Educação Profissional', 'Serviços', 'itau', 860000, 73, 73, 47, 1, 'monthly', '[{"cost_center":"OPS","weight":70},{"cost_center":"COM","weight":30}]'::jsonb);
  perform pg_temp.pay('e039', 99, 'itau', 100, 3, 'transfer', 0);
  perform pg_temp.mk_entry('e040', 'receivable', 'Venda de lote de peças #24', 'Beta Comércio de Peças Ltda', 'Vendas', 'itau', 850090, 78, 78, 52, 1, 'monthly', '[{"cost_center":"COM","weight":100}]'::jsonb);
  perform pg_temp.pay('e040', 99, 'nubank', 100, 2, 'transfer', 0);
  perform pg_temp.mk_entry('e041', 'payable', 'Folha de pagamento (2 mês(es) atrás)', null, 'Salários', 'itau', 1845000, 72, 65, 65, 1, 'monthly', '[{"cost_center":"ADM","weight":40},{"cost_center":"OPS","weight":40},{"cost_center":"COM","weight":20}]'::jsonb);
  perform pg_temp.pay('e041', 99, 'itau', 100, 0, 'transfer', 0);
  perform pg_temp.mk_entry('e042', 'payable', 'Encargos e benefícios (2m)', null, 'Encargos e benefícios', 'itau', 618040, 70, 65, 63, 1, 'monthly', '[{"cost_center":"ADM","weight":50},{"cost_center":"OPS","weight":50}]'::jsonb);
  perform pg_temp.pay('e042', 99, 'itau', 100, 0, 'boleto', 0);
  perform pg_temp.mk_entry('e043', 'payable', 'Honorários contábeis (2m)', 'Contabilidade Exata', 'Administrativas', 'itau', 115000, 74, 68, 68, 1, 'monthly', '[{"cost_center":"ADM","weight":1}]'::jsonb);
  perform pg_temp.pay('e043', 99, 'itau', 100, 0, 'boleto', 0);
  perform pg_temp.mk_entry('e044', 'payable', 'Campanha de marketing digital (2m)', 'Agência Pixel Marketing', 'Marketing', 'nubank', 360000, 80, 72, 71, 1, 'monthly', '[{"cost_center":"MKT","weight":80},{"cost_center":"COM","weight":20}]'::jsonb);
  perform pg_temp.pay('e044', 99, 'nubank', 100, 2, 'pix', 0);
  perform pg_temp.mk_entry('e045', 'payable', 'Material e insumos (2m)', 'Papelaria Pontual', 'Fornecedores', 'caixa', 260070, 78, 75, 71, 1, 'monthly', null);
  perform pg_temp.pay('e045', 99, 'itau', 100, 1, 'pix', 0);
  perform pg_temp.xfer('t046', 'itau', 'caixa', 300000, 82, 'Reforço do caixa da matriz');
  perform pg_temp.adj('a047', 'itau', -8990, 'fee', 'Tarifa mensal de manutenção da conta', 61);
  perform pg_temp.adj('a048', 'reserva', 31245, 'interest', 'Rendimento mensal da reserva', 62);
  perform pg_temp.mk_entry('e049', 'receivable', 'Projeto de implantação — fase #11', 'Alfa Indústria de Embalagens Ltda', 'Serviços', 'itau', 1570000, 50, 50, 27, 1, 'monthly', '[{"cost_center":"COM","weight":60},{"cost_center":"OPS","weight":40}]'::jsonb);
  perform pg_temp.mk_entry('e050', 'receivable', 'Projeto de implantação — fase #12', 'Alfa Indústria de Embalagens Ltda', 'Serviços', 'itau', 1510000, 48, 48, 30, 1, 'monthly', '[{"cost_center":"COM","weight":60},{"cost_center":"OPS","weight":40}]'::jsonb);
  perform pg_temp.pay('e050', 1, 'itau', 50, 2, 'pix', 0);
  perform pg_temp.mk_entry('e051', 'receivable', 'Venda de lote de peças #13', 'Beta Comércio de Peças Ltda', 'Vendas', 'itau', 1660090, 55, 55, 40, 3, 'monthly', '[{"cost_center":"OPS","weight":70},{"cost_center":"COM","weight":30}]'::jsonb);
  perform pg_temp.pay('e051', 99, 'itau', 100, 3, 'boleto', 0);
  perform pg_temp.mk_entry('e052', 'receivable', 'Venda de lote de peças #14', 'Beta Comércio de Peças Ltda', 'Vendas', 'itau', 590050, 40, 40, 23, 1, 'monthly', '[{"cost_center":"COM","weight":100}]'::jsonb);
  perform pg_temp.mk_entry('e053', 'payable', 'Folha de pagamento (1 mês(es) atrás)', null, 'Salários', 'itau', 1845000, 42, 35, 35, 1, 'monthly', '[{"cost_center":"ADM","weight":40},{"cost_center":"OPS","weight":40},{"cost_center":"COM","weight":20}]'::jsonb);
  perform pg_temp.pay('e053', 99, 'itau', 100, 0, 'transfer', 0);
  perform pg_temp.mk_entry('e054', 'payable', 'Encargos e benefícios (1m)', null, 'Encargos e benefícios', 'itau', 618040, 40, 35, 33, 1, 'monthly', '[{"cost_center":"ADM","weight":50},{"cost_center":"OPS","weight":50}]'::jsonb);
  perform pg_temp.pay('e054', 99, 'itau', 100, 0, 'boleto', 0);
  perform pg_temp.mk_entry('e055', 'payable', 'Honorários contábeis (1m)', 'Contabilidade Exata', 'Administrativas', 'itau', 115000, 44, 38, 38, 1, 'monthly', '[{"cost_center":"ADM","weight":1}]'::jsonb);
  perform pg_temp.pay('e055', 99, 'itau', 100, 0, 'boleto', 0);
  perform pg_temp.mk_entry('e056', 'payable', 'Campanha de marketing digital (1m)', 'Agência Pixel Marketing', 'Marketing', 'nubank', 450000, 50, 42, 41, 1, 'monthly', '[{"cost_center":"MKT","weight":80},{"cost_center":"COM","weight":20}]'::jsonb);
  perform pg_temp.pay('e056', 99, 'nubank', 100, 0, 'pix', 0);
  perform pg_temp.mk_entry('e057', 'payable', 'Material e insumos (1m)', 'Papelaria Pontual', 'Logística', 'caixa', 240070, 48, 45, 41, 2, 'monthly', null);
  perform pg_temp.pay('e057', 99, 'itau', 100, 0, 'pix', 0);
  perform pg_temp.xfer('t058', 'itau', 'caixa', 300000, 52, 'Reforço do caixa da matriz');
  perform pg_temp.adj('a059', 'itau', -8990, 'fee', 'Tarifa mensal de manutenção da conta', 31);
  perform pg_temp.adj('a060', 'reserva', 31245, 'interest', 'Rendimento mensal da reserva', 32);
  perform pg_temp.mk_entry('e061', 'receivable', 'Atendimento corporativo #01', 'Épsilon Clínica Integrada', 'Serviços', 'itau', 1280090, 9, 9, -11, 1, 'monthly', '[{"cost_center":"COM","weight":100}]'::jsonb);
  perform pg_temp.pay('e061', 99, 'itau', 100, 1, 'boleto', 0);
  perform pg_temp.mk_entry('e062', 'receivable', 'Consultoria mensal de processos #02', 'Gama Consultoria Empresarial', 'Serviços', 'itau', 870000, 14, 14, -16, 1, 'monthly', '[{"cost_center":"OPS","weight":70},{"cost_center":"COM","weight":30}]'::jsonb);
  perform pg_temp.pay('e062', 99, 'itau', 100, 2, 'pix', 0);
  perform pg_temp.mk_entry('e063', 'receivable', 'Contrato de logística — adicional #03', 'Delta Logística e Transportes', 'Serviços', 'itau', 1570000, 11, 11, -14, 3, 'monthly', '[{"cost_center":"OPS","weight":70},{"cost_center":"COM","weight":30}]'::jsonb);
  perform pg_temp.pay('e063', 99, 'itau', 100, 2, 'boleto', 0);
  perform pg_temp.mk_entry('e064', 'receivable', 'Projeto de implantação — fase #04', 'Alfa Indústria de Embalagens Ltda', 'Serviços', 'itau', 1020090, 8, 8, -11, 1, 'monthly', '[{"cost_center":"OPS","weight":70},{"cost_center":"COM","weight":30}]'::jsonb);
  perform pg_temp.pay('e064', 1, 'nubank', 50, 2, 'pix', 0);
  perform pg_temp.mk_entry('e065', 'payable', 'Folha de pagamento do mês', null, 'Salários', 'itau', 1845000, 12, 5, 5, 1, 'monthly', '[{"cost_center":"ADM","weight":40},{"cost_center":"OPS","weight":40},{"cost_center":"COM","weight":20}]'::jsonb);
  perform pg_temp.pay('e065', 99, 'itau', 100, 0, 'transfer', 0);
  perform pg_temp.mk_entry('e066', 'payable', 'Encargos e benefícios (0m)', null, 'Encargos e benefícios', 'itau', 618040, 10, 5, 3, 1, 'monthly', '[{"cost_center":"ADM","weight":50},{"cost_center":"OPS","weight":50}]'::jsonb);
  perform pg_temp.pay('e066', 99, 'itau', 100, 0, 'boleto', 0);
  perform pg_temp.mk_entry('e067', 'payable', 'Honorários contábeis (0m)', 'Contabilidade Exata', 'Administrativas', 'itau', 115000, 14, 8, 8, 1, 'monthly', '[{"cost_center":"ADM","weight":1}]'::jsonb);
  perform pg_temp.pay('e067', 99, 'itau', 100, 0, 'boleto', 0);
  perform pg_temp.mk_entry('e068', 'payable', 'Campanha de marketing digital (0m)', 'Agência Pixel Marketing', 'Marketing', 'nubank', 330000, 20, 12, 11, 1, 'monthly', '[{"cost_center":"MKT","weight":80},{"cost_center":"COM","weight":20}]'::jsonb);
  perform pg_temp.pay('e068', 99, 'nubank', 100, 0, 'pix', 0);
  perform pg_temp.mk_entry('e069', 'payable', 'Material e insumos (0m)', 'Transportes Rápido', 'Logística', 'caixa', 90070, 18, 15, 11, 2, 'monthly', null);
  perform pg_temp.pay('e069', 99, 'nubank', 100, 0, 'pix', 0);
  perform pg_temp.xfer('t070', 'itau', 'caixa', 300000, 22, 'Reforço do caixa da matriz');
  perform pg_temp.adj('a071', 'itau', -8990, 'fee', 'Tarifa mensal de manutenção da conta', 1);
  perform pg_temp.adj('a072', 'reserva', 31245, 'interest', 'Rendimento mensal da reserva', 2);
  perform pg_temp.xfer('t073', 'itau', 'nubank', 2000000, 96, 'Capital de giro para a conta digital');
  perform pg_temp.xfer('t074', 'itau', 'reserva', 1000000, 70, 'Aporte na reserva de emergência (fora do consolidado)');
  perform pg_temp.mk_entry('equip', 'payable', 'Compra de servidores — 6x', 'CloudSoft Licenças', 'Infraestrutura', 'itau', 7200000, 100, 100, 95, 6, 'monthly', '[{"cost_center":"TEC","weight":1}]'::jsonb);
  perform pg_temp.pay('equip', 99, 'nubank', 100, 0, 'boleto', 0);
  perform pg_temp.mk_entry('grande', 'receivable', 'Contrato anual de implantação — 3x', 'Alfa Indústria de Embalagens Ltda', 'Serviços', 'itau', 4500000, 75, 75, 60, 3, 'monthly', '[{"cost_center":"COM","weight":50},{"cost_center":"OPS","weight":50}]'::jsonb);
  perform pg_temp.pay('grande', 1, 'itau', 100, 2, 'pix', 0);
  perform pg_temp.mk_entry('cancel', 'receivable', 'Proposta aceita e depois cancelada pelo cliente', 'Beta Comércio de Peças Ltda', 'Vendas', 'itau', 890000, 40, 40, 30, 1, 'monthly', null);
  perform pg_temp.cancel('cancel', 'Cliente desistiu antes da entrega; sem cobrança.');
  perform pg_temp.mk_entry('erro', 'payable', 'Pagamento lançado em duplicidade (estornado)', 'Papelaria Pontual', 'Administrativas', 'itau', 234000, 33, 33, 28, 1, 'monthly', null);
  perform pg_temp.pay('erro', 99, 'itau', 100, 0, 'pix', 0);
  perform pg_temp.reverse('erro', 1, 'Pagamento feito duas vezes por engano; valor devolvido pelo fornecedor.');
  perform pg_temp.mk_entry('e075', 'payable', 'Manutenção predial — vencida', 'Transportes Rápido', 'Administrativas', 'itau', 378000, 22, 15, 9, 1, 'monthly', null);
  perform pg_temp.mk_entry('e076', 'receivable', 'Serviço de consultoria — cliente atrasado', 'Épsilon Clínica Integrada', 'Serviços', 'itau', 1260000, 30, 25, 6, 1, 'monthly', null);
  perform pg_temp.mk_entry('parcial', 'payable', 'Licenças anuais de software — parcial', 'CloudSoft Licenças', 'Licenças de software', 'itau', 2100000, 12, 12, 4, 1, 'monthly', '[{"cost_center":"TEC","weight":1}]'::jsonb);
  perform pg_temp.pay('parcial', 99, 'itau', 40, 1, 'pix', 0);
  perform pg_temp.mk_entry('e077', 'payable', 'Seguro empresarial — vence em 3 dias', 'Contabilidade Exata', 'Administrativas', 'itau', 189000, 14, 14, -3, 1, 'monthly', null);
  perform pg_temp.mk_entry('e078', 'receivable', 'Mensalidade extra — vence na semana', 'Zeta Educação Profissional', 'Serviços', 'itau', 940000, 5, 5, -6, 1, 'monthly', null);
  perform pg_temp.mk_entry('e079', 'receivable', 'Projeto de expansão — marco futuro', 'Delta Logística e Transportes', 'Serviços', 'itau', 3800000, 3, -20, -25, 2, 'monthly', '[{"cost_center":"OPS","weight":1}]'::jsonb);
  perform pg_temp.mk_entry('e080', 'payable', 'Impostos e taxas do trimestre', null, 'Administrativas', 'itau', 1482015, 2, 0, -18, 1, 'monthly', null);
  perform pg_temp.mk_rule('Aluguel da sede', 'payable', 'Imobiliária Central', 'Aluguel', 'itau', 650000, 'monthly', 1, 145, 30);
  perform pg_temp.mk_rule('Internet e telefonia', 'payable', 'NetFibra Telecom', 'Tecnologia', 'itau', 38990, 'monthly', 1, 143, 30);
  perform pg_temp.mk_rule('Assinaturas de software (SaaS)', 'payable', 'CloudSoft Licenças', 'Licenças de software', 'nubank', 179000, 'monthly', 1, 140, 30);
  perform pg_temp.mk_rule('Mensalidade — Alfa Indústria', 'receivable', 'Alfa Indústria de Embalagens Ltda', 'Recorrências', 'itau', 1200000, 'monthly', 1, 144, 30);
  perform pg_temp.mk_rule('Contrato de suporte — Beta Comércio', 'receivable', 'Beta Comércio de Peças Ltda', 'Recorrências', 'itau', 850000, 'monthly', 1, 141, 30);
  perform pg_temp.mk_rule('Seguro anual (antecipação trimestral)', 'payable', 'Contabilidade Exata', 'Administrativas', 'itau', 225000, 'quarterly', 1, 130, 30);
  perform pg_temp.gen_rules();
  perform pg_temp.pay_rule('Aluguel da sede', 'itau', 0, 0);
  perform pg_temp.pay_rule('Internet e telefonia', 'itau', 0, 0);
  perform pg_temp.pay_rule('Assinaturas de software (SaaS)', 'nubank', 0, 1);
  perform pg_temp.pay_rule('Mensalidade — Alfa Indústria', 'itau', 1, 0);
  perform pg_temp.pay_rule('Contrato de suporte — Beta Comércio', 'itau', 2, 1);
  perform pg_temp.pay_rule('Seguro anual (antecipação trimestral)', 'itau', 0, 0);
  perform pg_temp.statement_demo();
  perform pg_temp.goal_demo();
  perform public.fin_run_routines('f6f6f6f6-0000-4000-8000-000000000001');
end $ops$;
