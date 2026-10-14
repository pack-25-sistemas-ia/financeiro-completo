-- Exportações: só gestão/administração registram; ficam na auditoria sem valores; outra empresa e perfis sem permissão não conseguem.

\set as_oa 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a0","aal":"aal2","email":"oa@t.invalid"}'', true); set local role authenticated;'
\set as_ma 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a1","aal":"aal1","email":"ma@t.invalid"}'', true); set local role authenticated;'
\set as_na 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a2","aal":"aal1","email":"na@t.invalid"}'', true); set local role authenticated;'
\set as_va 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a3","aal":"aal1","email":"va@t.invalid"}'', true); set local role authenticated;'
\set as_ob 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000b0","aal":"aal2","email":"ob@t.invalid"}'', true); set local role authenticated;'

begin;

create function test.errmsg(q text) returns text language plpgsql as $$ begin execute q; return null; exception when others then return sqlerrm; end $$;
create function test.t(k text) returns uuid language sql as $$ select current_setting('t.' || k)::uuid $$;
grant execute on all functions in schema test to anon, authenticated;

insert into auth.users (id, email) values
  ('ffffffff-0000-4000-8000-0000000000a0', 'oa@t.invalid'), ('ffffffff-0000-4000-8000-0000000000a1', 'ma@t.invalid'), ('ffffffff-0000-4000-8000-0000000000a2', 'na@t.invalid'),
  ('ffffffff-0000-4000-8000-0000000000a3', 'va@t.invalid'), ('ffffffff-0000-4000-8000-0000000000b0', 'ob@t.invalid');

:as_oa
do $$
declare org uuid;
begin
  org := public.create_organization('Empresa Exporta', 'empresa-exp');
  insert into public.organization_members (organization_id, user_id, role) values
    (org, 'ffffffff-0000-4000-8000-0000000000a1', 'manager'), (org, 'ffffffff-0000-4000-8000-0000000000a2', 'member'), (org, 'ffffffff-0000-4000-8000-0000000000a3', 'viewer');
  perform set_config('t.org', org::text, true);
end $$;
reset role;
:as_ob
do $$ begin perform public.create_organization('Empresa B', 'empresa-b'); end $$;
reset role;

:as_ma
do $$
begin
  perform public.fin_log_export(test.t('org'), 'contas_pagar', 42);
  perform public.fin_log_export(test.t('org'), 'fluxo_realizado', 0);
  assert test.errmsg(format($q$select public.fin_log_export(%L, 'Nome Inválido!', 1)$q$, test.t('org'))) like '%relatório inválido%', 'nome do relatório validado';
  assert test.errmsg(format($q$select public.fin_log_export(%L, 'ab', 1)$q$, test.t('org'))) like '%relatório inválido%', 'nome curto demais';
end $$;
reset role;
:as_na
do $$ begin assert test.errmsg(format($q$select public.fin_log_export(%L, 'contas_pagar', 1)$q$, test.t('org'))) like '%sem permissão%', 'analista não exporta'; end $$;
reset role;
:as_va
do $$ begin assert test.errmsg(format($q$select public.fin_log_export(%L, 'contas_pagar', 1)$q$, test.t('org'))) like '%sem permissão%', 'consulta não exporta'; end $$;
reset role;
:as_ob
do $$ begin assert test.errmsg(format($q$select public.fin_log_export(%L, 'contas_pagar', 1)$q$, test.t('org'))) like '%sem permissão%', 'outra empresa não registra em A'; end $$;
reset role;
:as_oa
do $$
begin
  assert (select count(*) from public.audit_log where organization_id = test.t('org') and action = 'export') = 2, 'duas exportações auditadas';
  assert (select changes ->> 'rows' from public.audit_log where entity = 'contas_pagar' and action = 'export') = '42', 'só o número de linhas é guardado';
  assert (select count(*) from public.audit_log where action = 'export' and changes::text ~ '[0-9]{4,}') = 0, 'nenhum valor financeiro na trilha';
  assert test.errmsg($q$update public.audit_log set action = 'x'$q$) is not null, 'auditoria não é editável';
  raise notice 'PASS: exportações — só gestão registra, trilha sem valores, validação do nome, isolamento';
end $$;
reset role;

rollback;
select 'PASS 67_fin_export_log' as result;
