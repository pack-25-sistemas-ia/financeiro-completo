-- Gestão Financeira Empresarial — REGISTRO DE EXPORTAÇÕES (parte 7).
-- Exportar dados financeiros é uma saída de informação: só gestão/administração, e cada exportação fica na auditoria (quem, qual relatório, quantas linhas — nunca os valores).

begin;

create function public.fin_log_export(p_org uuid, p_report text, p_rows integer) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.fin_guard(p_org, 'manager');
  if p_report is null or p_report !~ '^[a-z_]{3,40}$' then raise exception 'relatório inválido' using errcode = '22023'; end if;
  insert into public.audit_log (organization_id, actor_id, action, entity, entity_id, changes)
  values (p_org, (select auth.uid()), 'export', p_report, null, jsonb_build_object('rows', greatest(coalesce(p_rows, 0), 0)));
end $$;
revoke all on function public.fin_log_export(uuid, text, integer) from public, anon;
grant execute on function public.fin_log_export(uuid, text, integer) to authenticated;

commit;
