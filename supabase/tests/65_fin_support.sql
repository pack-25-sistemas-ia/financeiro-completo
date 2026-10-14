-- Anexos (metadados e isolamento), notificações (eventos e rotina por data, sem duplicar) e metas.
-- O envio ao Storage em si é validado nos testes E2E contra o Supabase real; aqui valida-se o que o banco decide.

\set as_oa 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a0","aal":"aal2","email":"oa@t.invalid"}'', true); set local role authenticated;'
\set as_ma 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a1","aal":"aal1","email":"ma@t.invalid"}'', true); set local role authenticated;'
\set as_na 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a2","aal":"aal1","email":"na@t.invalid"}'', true); set local role authenticated;'
\set as_va 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a3","aal":"aal1","email":"va@t.invalid"}'', true); set local role authenticated;'
\set as_ob 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000b0","aal":"aal2","email":"ob@t.invalid"}'', true); set local role authenticated;'

begin;

create function test.errmsg(q text) returns text language plpgsql as $$ begin execute q; return null; exception when others then return sqlerrm; end $$;
create function test.t(k text) returns uuid language sql as $$ select current_setting('t.' || k)::uuid $$;
create function test.today() returns date language sql as $$ select (now() at time zone 'America/Sao_Paulo')::date $$;
create function test.path(org uuid, ext text default 'pdf') returns text language sql as $$ select org::text || '/' || gen_random_uuid()::text || '.' || ext $$;
grant execute on all functions in schema test to anon, authenticated;

insert into auth.users (id, email) values
  ('ffffffff-0000-4000-8000-0000000000a0', 'oa@t.invalid'), ('ffffffff-0000-4000-8000-0000000000a1', 'ma@t.invalid'), ('ffffffff-0000-4000-8000-0000000000a2', 'na@t.invalid'),
  ('ffffffff-0000-4000-8000-0000000000a3', 'va@t.invalid'), ('ffffffff-0000-4000-8000-0000000000b0', 'ob@t.invalid');

:as_oa
do $$
declare org uuid; e uuid; i uuid; s uuid;
begin
  org := public.create_organization('Empresa Apoio', 'empresa-apoio');
  insert into public.organization_members (organization_id, user_id, role) values
    (org, 'ffffffff-0000-4000-8000-0000000000a1', 'manager'), (org, 'ffffffff-0000-4000-8000-0000000000a2', 'member'), (org, 'ffffffff-0000-4000-8000-0000000000a3', 'viewer');
  perform set_config('t.org', org::text, true);
  perform set_config('t.banco', public.fin_create_account(org, 'Banco', 'checking', null, 1000000, test.today() - 90)::text, true);
  e := public.fin_create_entry(org, 'payable', 'Nota fiscal de serviço', null, null, null, 100000, test.today() - 20, test.today() - 20, test.today() - 5, 1);
  select id into i from public.financial_installments where entry_id = e;
  s := public.fin_settle_installment(i, test.t('banco'), 100000, now(), 'pix', null, 'sup-settle-0001');
  perform set_config('t.entry', e::text, true); perform set_config('t.settle', s::text, true);
end $$;
reset role;
:as_ob
do $$ begin perform set_config('t.orgb', public.create_organization('Empresa B', 'empresa-b')::text, true); end $$;
reset role;

-- ===================================================================== anexos
:as_na
do $$
declare org uuid := test.t('org'); a uuid; k integer;
begin
  a := public.fin_register_attachment(org, 'entry', test.t('entry'), E'comprovante\n.pdf', test.path(org), 'application/pdf', 20480);
  perform set_config('t.att', a::text, true);
  assert (select original_file_name from public.attachments where id = a) = 'comprovante.pdf', 'caracteres de controle removidos do nome';
  perform public.fin_register_attachment(org, 'settlement', test.t('settle'), 'recibo.png', test.path(org, 'png'), 'image/png', 1000);
  assert test.errmsg(format($q$select public.fin_register_attachment(%L, 'entry', %L, 'x.pdf', %L, 'application/pdf', 100)$q$, org, test.t('entry'), test.path(test.t('orgb')))) like '%anexo inválido%', 'caminho de outra organização recusado';
  assert test.errmsg(format($q$select public.fin_register_attachment(%L, 'entry', %L, 'x.pdf', %L, 'application/pdf', 100)$q$, org, test.t('entry'), 'caminho-livre.pdf')) like '%anexo inválido%', 'caminho fora do padrão recusado';
  assert test.errmsg(format($q$select public.fin_register_attachment(%L, 'entry', %L, 'x.exe', %L, 'application/x-msdownload', 100)$q$, org, test.t('entry'), test.path(org))) like '%anexo inválido%', 'tipo não permitido recusado';
  assert test.errmsg(format($q$select public.fin_register_attachment(%L, 'entry', %L, 'x.pdf', %L, 'application/pdf', 10485761)$q$, org, test.t('entry'), test.path(org))) like '%anexo inválido%', 'acima de 10 MB recusado';
  assert test.errmsg(format($q$select public.fin_register_attachment(%L, 'entry', %L, 'x.pdf', %L, 'application/pdf', 0)$q$, org, test.t('entry'), test.path(org))) like '%anexo inválido%', 'arquivo vazio recusado';
  assert test.errmsg(format($q$select public.fin_register_attachment(%L, 'entry', gen_random_uuid(), 'x.pdf', %L, 'application/pdf', 100)$q$, org, test.path(org))) like '%título não encontrado%', 'título inexistente';
  assert test.errmsg(format($q$select public.fin_register_attachment(%L, 'contrato', %L, 'x.pdf', %L, 'application/pdf', 100)$q$, org, test.t('entry'), test.path(org))) like '%tipo de anexo%', 'tipo de entidade inválido';
  for k in 2..20 loop
    perform public.fin_register_attachment(org, 'entry', test.t('entry'), 'doc' || k || '.pdf', test.path(org), 'application/pdf', 100);
  end loop;
  assert test.errmsg(format($q$select public.fin_register_attachment(%L, 'entry', %L, 'excedente.pdf', %L, 'application/pdf', 100)$q$, org, test.t('entry'), test.path(org))) like '%limite de 20%', 'limite de 20 anexos por registro';
  assert test.errmsg(format($q$select public.fin_archive_attachment(%L)$q$, a)) like '%sem permissão%', 'analista não arquiva anexo';
end $$;
reset role;
:as_va
do $$
declare org uuid := test.t('org');
begin
  assert test.errmsg(format($q$select public.fin_register_attachment(%L, 'entry', %L, 'x.pdf', %L, 'application/pdf', 100)$q$, org, test.t('entry'), test.path(org))) like '%sem permissão%', 'consulta não anexa';
  assert (select count(*) from public.attachments) = 21, 'consulta lê os metadados';
end $$;
reset role;
:as_ob
do $$
begin
  assert (select count(*) from public.attachments) = 0, 'B não enxerga anexos de A';
  assert test.errmsg(format($q$select public.fin_register_attachment(%L, 'entry', %L, 'x.pdf', %L, 'application/pdf', 100)$q$, test.t('org'), test.t('entry'), test.path(test.t('org')))) like '%sem permissão%', 'B não anexa em A';
  assert test.errmsg(format($q$select public.fin_register_attachment(%L, 'entry', %L, 'x.pdf', %L, 'application/pdf', 100)$q$, test.t('orgb'), test.t('entry'), test.path(test.t('orgb')))) like '%título não encontrado%', 'B não anexa a título de A pelo próprio org';
  assert test.errmsg(format($q$select public.fin_archive_attachment(%L)$q$, test.t('att'))) like '%sem permissão%', 'B não arquiva anexo de A';
end $$;
reset role;
:as_ma
do $$
begin
  perform public.fin_archive_attachment(test.t('att'));
  assert (select archived_at is not null from public.attachments where id = test.t('att')), 'gestor arquiva (sem apagar)';
  assert test.errmsg(format($q$update public.attachments set original_file_name = 'outro' where id = %L$q$, test.t('att'))) is not null, 'escrita direta negada';
end $$;
reset role;
do $$
begin
  assert test.errmsg($q$update public.attachments set original_file_name = 'adulterado'$q$) like '%imutáveis%', 'metadados imutáveis até para o dono';
  assert test.errmsg($q$delete from public.attachments$q$) like '%não podem ser apagados%', 'anexo não é apagado';
  assert test.errmsg($q$update public.attachments set storage_path = (select organization_id::text || '/' || gen_random_uuid()::text || '.pdf' from public.attachments limit 1)$q$) like '%imutáveis%', 'caminho imutável';
  raise notice 'PASS: anexos — vínculo, organização, tipo, tamanho, limite, nome sanitizado, arquivar sem apagar, imutabilidade, isolamento';
end $$;

-- ===================================================================== notificações
:as_ma
do $$
declare org uuid := test.t('org');
begin
  -- estorno gera aviso para administração/gestão (não para analista nem consulta) e sem valores
  perform public.fin_reverse_settlement(test.t('settle'), 'baixa lançada na conta errada');
end $$;
reset role;
:as_oa
do $$
begin
  assert (select count(*) from public.fin_notifications where type = 'entry_reversed') = 1, 'dono recebe o aviso de estorno';
  assert (select body !~ '[0-9]{3}' and title !~ 'R\$' from public.fin_notifications where type = 'entry_reversed'), 'aviso sem valores financeiros';
  assert (select link from public.fin_notifications where type = 'entry_reversed') = '/movimentacoes', 'aviso com link para o registro';
  assert (select count(*) from public.fin_notifications) = (select count(*) from public.fin_notifications where user_id = 'ffffffff-0000-4000-8000-0000000000a0'), 'cada usuário vê só as próprias';
end $$;
reset role;
:as_na
do $$ begin assert (select count(*) from public.fin_notifications where type = 'entry_reversed') = 0, 'analista não recebe aviso de estorno'; end $$;
reset role;
:as_va
do $$ begin assert (select count(*) from public.fin_notifications) = 0, 'consulta não recebe avisos operacionais'; end $$;
reset role;
:as_ob
do $$ begin assert (select count(*) from public.fin_notifications) = 0, 'B não vê avisos de A'; end $$;
reset role;

-- rotina por data: vencendo, vencida (pagar), atrasada (receber); idempotente; respeita preferências
:as_ma
do $$
declare org uuid := test.t('org'); r jsonb;
begin
  perform public.fin_create_entry(org, 'payable', 'Vence amanhã', null, null, null, 5000, test.today() - 2, test.today() - 2, test.today() + 1, 1);
  perform public.fin_create_entry(org, 'payable', 'Vencida há 3 dias', null, null, null, 7000, test.today() - 10, test.today() - 10, test.today() - 3, 1);
  perform public.fin_create_entry(org, 'receivable', 'Cliente atrasado', null, null, null, 9000, test.today() - 10, test.today() - 10, test.today() - 4, 1);
  r := public.fin_run_routines(org);
  assert (r ->> 'notifications_created')::integer > 0, 'rotina cria avisos';
  assert (select count(*) from public.fin_notifications where user_id = 'ffffffff-0000-4000-8000-0000000000a1' and type = 'due_soon') = 1, 'gestor: 1 aviso de vencimento próximo';
  assert (select body from public.fin_notifications where user_id = 'ffffffff-0000-4000-8000-0000000000a1' and type = 'overdue') like '2 parcela(s)%', 'gestor: aviso de vencidas (2 parcelas: a vencida há 3 dias e a nota estornada, que voltou a ficar pendente)';
  assert (select count(*) from public.fin_notifications where user_id = 'ffffffff-0000-4000-8000-0000000000a1' and type = 'receivable_late') = 1, 'gestor: aviso de recebimento atrasado';
  r := public.fin_run_routines(org);
  assert (r ->> 'notifications_created')::integer = 0 and (r ->> 'recurring_generated')::integer = 0, 'segunda execução no mesmo dia não duplica nada';
  -- preferência: desligar um tipo
  perform public.fin_set_notification_pref(org, 'overdue', false);
  assert test.errmsg(format($q$select public.fin_set_notification_pref(%L, 'inventado', true)$q$, org)) like '%tipo de notificação inválido%', 'tipo inválido';
  -- marcar como lida
  assert public.fin_mark_notifications_read(org, null) >= 3, 'marca todas como lidas';
  assert (select count(*) from public.fin_notifications where user_id = 'ffffffff-0000-4000-8000-0000000000a1' and read_at is null) = 0, 'nenhuma não lida';
  assert public.fin_mark_notifications_read(org, null) = 0, 'idempotente';
  assert test.errmsg($q$update public.fin_notifications set read_at = null$q$) is not null, 'escrita direta negada';
end $$;
reset role;
:as_va
do $$
begin
  assert test.errmsg(format($q$select public.fin_run_routines(%L)$q$, test.t('org'))) like '%sem permissão%', 'consulta não dispara a rotina';
  perform public.fin_set_notification_pref(test.t('org'), 'due_soon', false);
  assert (select count(*) from public.fin_notification_prefs) = 1, 'consulta guarda a própria preferência';
end $$;
reset role;
:as_ob
do $$
begin
  assert test.errmsg(format($q$select public.fin_run_routines(%L)$q$, test.t('org'))) like '%sem permissão%', 'B não dispara a rotina de A';
  assert (select count(*) from public.fin_notification_prefs) = 0, 'B não vê preferências de A';
end $$;
reset role;
-- a mesma rotina agendada (pg_cron) cobre todas as organizações e não duplica
do $$
declare n integer;
begin
  n := private.fin_run_scheduled();
  assert private.fin_run_scheduled() = 0, 'rotina agendada é idempotente';
  assert (select count(*) from public.fin_notifications where link !~ '^/[a-z0-9/?=&_.-]*$') = 0, 'links só internos';
  raise notice 'PASS: notificações — estorno só para quem deve, sem valores, rotina por data idempotente, preferências, leitura, isolamento';
end $$;

-- ===================================================================== metas
:as_ma
do $$
declare org uuid := test.t('org'); g uuid;
begin
  insert into public.financial_goals (organization_id, name, metric_type, target_amount_cents, period_start, period_end, created_by)
  values (org, 'Receita do trimestre', 'income', 5000000, test.today() - 30, test.today() + 60, 'ffffffff-0000-4000-8000-0000000000a1') returning id into g;
  update public.financial_goals set target_amount_cents = 6000000 where id = g;
  assert (select target_amount_cents from public.financial_goals where id = g) = 6000000, 'gestor cria e edita meta';
  assert test.errmsg(format($q$insert into public.financial_goals (organization_id, name, metric_type, target_amount_cents, period_start, period_end, created_by) values (%L, 'Meta em nome de outro', 'income', 100, test.today(), test.today(), 'ffffffff-0000-4000-8000-0000000000a0')$q$, org)) is not null, 'meta não pode ser criada em nome de outro usuário';
  assert test.errmsg(format($q$insert into public.financial_goals (organization_id, name, metric_type, target_amount_cents, period_start, period_end, created_by) values (%L, 'Período invertido', 'income', 100, test.today(), test.today() - 1, 'ffffffff-0000-4000-8000-0000000000a1')$q$, org)) is not null, 'período invertido';
  assert test.errmsg(format($q$insert into public.financial_goals (organization_id, name, metric_type, target_amount_cents, period_start, period_end, created_by) values (%L, 'Valor zero', 'income', 0, test.today(), test.today(), 'ffffffff-0000-4000-8000-0000000000a1')$q$, org)) is not null, 'valor zero';
  perform set_config('t.goal', g::text, true);
end $$;
reset role;
:as_na
do $$
declare org uuid := test.t('org');
begin
  assert test.errmsg(format($q$insert into public.financial_goals (organization_id, name, metric_type, target_amount_cents, period_start, period_end, created_by) values (%L, 'Meta do analista', 'income', 100, test.today(), test.today(), 'ffffffff-0000-4000-8000-0000000000a2')$q$, org)) is not null, 'analista não cria meta';
  assert test.affected(format($q$delete from public.financial_goals where id = %L$q$, test.t('goal'))) = 0, 'analista não apaga meta';
  assert (select count(*) from public.financial_goals) = 1, 'analista lê metas';
end $$;
reset role;
:as_ob
do $$
begin
  assert (select count(*) from public.financial_goals) = 0, 'B não vê metas de A';
  assert test.affected(format($q$delete from public.financial_goals where id = %L$q$, test.t('goal'))) = 0, 'B não apaga meta de A';
  raise notice 'PASS: metas — gestão escreve, analista e outra empresa não, validações';
end $$;
reset role;

rollback;
select 'PASS 65_fin_support' as result;
