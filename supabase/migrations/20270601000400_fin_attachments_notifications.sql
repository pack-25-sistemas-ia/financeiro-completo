-- Gestão Financeira Empresarial — ANEXOS (Storage privado), NOTIFICAÇÕES internas e METAS (parte 5).
-- Comprovantes: arquivo em bucket PRIVADO (caminho «<organização>/<uuid>.<ext>» gerado pelo servidor); metadados aqui; leitura só por URL assinada curta.
-- Notificações: geradas por gatilhos e por rotina idempotente (sem depender de e-mail); nunca carregam valores financeiros.

begin;
set local check_function_bodies = off;

-- ======================================================================= anexos
create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  entity_type text not null check (entity_type in ('entry', 'settlement')),
  entity_id uuid not null,
  original_file_name text not null check (char_length(original_file_name) between 1 and 200),
  storage_path text not null check (storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(pdf|png|jpg)$'),
  mime_type text not null check (mime_type in ('application/pdf', 'image/png', 'image/jpeg')),
  size_bytes integer not null check (size_bytes between 1 and 10485760),
  uploaded_by uuid,
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (id, organization_id),
  unique (storage_path),
  check (split_part(storage_path, '/', 1) = organization_id::text)
);
create index attachments_entity_idx on public.attachments (organization_id, entity_type, entity_id);

create function private.fin_register_attachment_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if (to_jsonb(new) - 'archived_at') is distinct from (to_jsonb(old) - 'archived_at') then
    raise exception 'metadados do anexo são imutáveis (apenas o arquivamento muda)' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger attachment_guard before update on public.attachments for each row execute function private.fin_register_attachment_guard();
create trigger nodel_attachments before delete on public.attachments for each row execute function private.fin_no_delete();

-- O servidor envia o arquivo ao Storage (já validado pelos bytes) e então registra os metadados; o banco confere vínculo e organização.
create function public.fin_register_attachment(p_org uuid, p_entity_type text, p_entity_id uuid, p_name text, p_path text, p_mime text, p_size integer) returns uuid
language plpgsql security definer set search_path = '' as $$
declare new_id uuid; n integer;
begin
  perform private.fin_guard(p_org, 'analyst');
  if p_entity_type = 'entry' then
    if not exists (select 1 from public.financial_entries where id = p_entity_id and organization_id = p_org) then raise exception 'título não encontrado' using errcode = '22023'; end if;
  elsif p_entity_type = 'settlement' then
    if not exists (select 1 from public.settlements where id = p_entity_id and organization_id = p_org) then raise exception 'baixa não encontrada' using errcode = '22023'; end if;
  else
    raise exception 'tipo de anexo inválido' using errcode = '22023';
  end if;
  select count(*) into n from public.attachments where organization_id = p_org and entity_type = p_entity_type and entity_id = p_entity_id and archived_at is null;
  if n >= 20 then raise exception 'limite de 20 anexos por registro' using errcode = '55000'; end if;
  insert into public.attachments (organization_id, entity_type, entity_id, original_file_name, storage_path, mime_type, size_bytes, uploaded_by)
  values (p_org, p_entity_type, p_entity_id, left(regexp_replace(trim(p_name), '[[:cntrl:]]', '', 'g'), 200), p_path, p_mime, p_size, (select auth.uid())) returning attachments.id into new_id;
  return new_id;
exception when check_violation then raise exception 'anexo inválido (tipo, tamanho ou caminho)' using errcode = '22023';
end $$;

create function public.fin_archive_attachment(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.attachments%rowtype;
begin
  select * into a from public.attachments where id = p_id for update;
  if not found then raise exception 'anexo não encontrado' using errcode = '22023'; end if;
  perform private.fin_guard(a.organization_id, 'manager');
  update public.attachments set archived_at = coalesce(archived_at, now()) where id = p_id;
end $$;

-- ======================================================================= notificações
-- Atenção: estas duas tabelas ligam-se SÓ a organization_members (chave composta). Uma segunda chave para organizations criaria um caminho
-- muitos-para-muitos e tornaria ambígua a consulta embutida organization_members → organizations (PostgREST PGRST201) usada pelo Core.
create table public.fin_notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  user_id uuid not null,
  type text not null check (type in ('due_soon', 'overdue', 'receivable_late', 'projected_negative', 'recurring_generated', 'import_done', 'reconciliation_pending', 'processing_failed', 'entry_reversed')),
  title text not null check (char_length(title) between 1 and 120),
  body text not null check (char_length(body) between 1 and 300),
  link text check (link is null or link ~ '^/[a-z0-9/?=&_.-]*$'),
  dedupe_key text not null check (char_length(dedupe_key) between 1 and 120),
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, dedupe_key),
  foreign key (organization_id, user_id) references public.organization_members (organization_id, user_id) on delete cascade
);
create index fin_notifications_user_idx on public.fin_notifications (user_id, organization_id, read_at, created_at desc);

create table public.fin_notification_prefs (
  organization_id uuid not null,
  user_id uuid not null,
  type text not null,
  enabled boolean not null default true,
  primary key (organization_id, user_id, type),
  foreign key (organization_id, user_id) references public.organization_members (organization_id, user_id) on delete cascade
);

create table public.financial_goals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 80),
  metric_type text not null check (metric_type in ('income', 'expense', 'net')),
  target_amount_cents bigint not null check (target_amount_cents between 1 and 99999999999999),
  period_start date not null,
  period_end date not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  check (period_end >= period_start)
);

do $$
declare t text;
begin
  foreach t in array array['attachments', 'financial_goals'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for select to authenticated using (private.fin_can_read(organization_id))', t || '_select', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.audit_trigger(%L, %L)', 'audit_' || t, t, 'organization_id', 'id');
  end loop;
  foreach t in array array['fin_notifications', 'fin_notification_prefs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for select to authenticated using (user_id = (select auth.uid()) and private.fin_can_read(organization_id))', t || '_select', t);
  end loop;
end $$;

-- Metas: gestão escreve direto (sem histórico financeiro; só um alvo gerencial), com MFA no banco.
grant insert (organization_id, name, metric_type, target_amount_cents, period_start, period_end, created_by), update (name, metric_type, target_amount_cents, period_start, period_end), delete on public.financial_goals to authenticated;
create policy goals_insert on public.financial_goals for insert to authenticated with check (private.fin_is_manager(organization_id) and created_by = (select auth.uid()));
create policy goals_update on public.financial_goals for update to authenticated using (private.fin_is_manager(organization_id)) with check (private.fin_is_manager(organization_id));
create policy goals_delete on public.financial_goals for delete to authenticated using (private.fin_is_manager(organization_id));
create policy mfa_insert on public.financial_goals as restrictive for insert to authenticated with check (private.mfa_ok());
create policy mfa_update on public.financial_goals as restrictive for update to authenticated using (private.mfa_ok()) with check (private.mfa_ok());
create policy mfa_delete on public.financial_goals as restrictive for delete to authenticated using (private.mfa_ok());

-- Envia a notificação aos membros dos papéis indicados (respeitando preferências); duplicata (mesma chave) é ignorada.
create function private.fin_notify(p_org uuid, p_type text, p_title text, p_body text, p_link text, p_dedupe text, p_roles public.org_role[], p_only_user uuid default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  insert into public.fin_notifications (organization_id, user_id, type, title, body, link, dedupe_key)
  select m.organization_id, m.user_id, p_type, p_title, p_body, p_link, p_dedupe
  from public.organization_members m
  where m.organization_id = p_org and m.role = any (p_roles) and (p_only_user is null or m.user_id = p_only_user)
    and coalesce((select pr.enabled from public.fin_notification_prefs pr where pr.organization_id = m.organization_id and pr.user_id = m.user_id and pr.type = p_type), true)
  on conflict (user_id, dedupe_key) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function private.fin_notify(uuid, text, text, text, text, text, public.org_role[], uuid) from public;

create function public.fin_mark_notifications_read(p_org uuid, p_ids uuid[] default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  perform private.fin_guard(p_org, 'read');
  update public.fin_notifications set read_at = now() where organization_id = p_org and user_id = (select auth.uid()) and read_at is null and (p_ids is null or id = any (p_ids));
  get diagnostics n = row_count;
  return n;
end $$;

create function public.fin_set_notification_pref(p_org uuid, p_type text, p_enabled boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.fin_guard(p_org, 'read');
  if p_type not in ('due_soon', 'overdue', 'receivable_late', 'projected_negative', 'recurring_generated', 'import_done', 'reconciliation_pending', 'processing_failed', 'entry_reversed') then
    raise exception 'tipo de notificação inválido' using errcode = '22023';
  end if;
  insert into public.fin_notification_prefs (organization_id, user_id, type, enabled) values (p_org, (select auth.uid()), p_type, coalesce(p_enabled, true))
  on conflict (organization_id, user_id, type) do update set enabled = excluded.enabled;
end $$;

-- ---- eventos: estornos, importações e recorrências (gatilhos; texto sem valores)
create function private.fin_trg_notify_reversal() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.reversed_at is not null and old.reversed_at is null then
    perform private.fin_notify(new.organization_id, 'entry_reversed',
      case tg_table_name when 'transfers' then 'Transferência estornada' else 'Baixa estornada' end,
      'Um lançamento foi estornado. Consulte o extrato e o histórico para os detalhes.', '/movimentacoes',
      'rev:' || tg_table_name || ':' || new.id::text, array['owner', 'admin', 'manager']::public.org_role[]);
  end if;
  return null;
end $$;
revoke all on function private.fin_trg_notify_reversal() from public;
create trigger notify_reversal_settlements after update on public.settlements for each row execute function private.fin_trg_notify_reversal();
create trigger notify_reversal_transfers after update on public.transfers for each row execute function private.fin_trg_notify_reversal();

create function private.fin_trg_notify_import() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'completed' and old.status <> 'completed' then
    perform private.fin_notify(new.organization_id, 'import_done', 'Importação finalizada', new.accepted_rows || ' linha(s) importada(s) do arquivo «' || left(new.file_name, 60) || '».', '/importacoes',
      'imp:' || new.id::text, array['owner', 'admin', 'manager', 'member']::public.org_role[], new.created_by);
    if new.rejected_rows > 0 then
      perform private.fin_notify(new.organization_id, 'processing_failed', 'Importação com linhas rejeitadas', new.rejected_rows || ' linha(s) não foram importadas. Baixe o relatório de erros.', '/importacoes',
        'impfail:' || new.id::text, array['owner', 'admin', 'manager', 'member']::public.org_role[], new.created_by);
    end if;
  end if;
  return null;
end $$;
revoke all on function private.fin_trg_notify_import() from public;
create trigger notify_import after update on public.imports for each row execute function private.fin_trg_notify_import();

create function private.fin_trg_notify_recurring() returns trigger language plpgsql security definer set search_path = '' as $$
declare d text; today date := private.fin_today(new.organization_id);
begin
  if new.status = 'generated' then
    select left(description, 80) into d from public.recurring_rules where id = new.recurring_rule_id;
    perform private.fin_notify(new.organization_id, 'recurring_generated', 'Recorrência gerada', 'Novos títulos previstos foram gerados para «' || d || '».', '/recorrencias',
      'rec:' || new.recurring_rule_id::text || ':' || today::text, array['owner', 'admin', 'manager', 'member']::public.org_role[]);
  end if;
  return null;
end $$;
revoke all on function private.fin_trg_notify_recurring() from public;
create trigger notify_recurring after insert on public.recurring_occurrences for each row execute function private.fin_trg_notify_recurring();

-- ---- rotina de alertas por data (idempotente: uma notificação por tipo e por dia)
create function private.fin_generate_notifications(p_org uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare today date := private.fin_today(p_org); alert integer; n integer; made integer := 0; roles public.org_role[] := array['owner', 'admin', 'manager', 'member'];
begin
  select alert_days_before into alert from public.fin_settings where organization_id = p_org;
  alert := coalesce(alert, 3);
  select count(*) into n from public.fin_installments_view v where v.organization_id = p_org and v.entry_type = 'payable' and v.cancelled_at is null and v.archived_at is null and v.pending_cents > 0 and v.due_date between today and today + alert;
  if n > 0 then made := made + private.fin_notify(p_org, 'due_soon', 'Contas a pagar vencendo em breve', n || ' parcela(s) vencem nos próximos ' || alert || ' dia(s).', '/pagar?venc=breve', 'due_soon:' || today::text, roles); end if;
  select count(*) into n from public.fin_installments_view v where v.organization_id = p_org and v.entry_type = 'payable' and v.cancelled_at is null and v.archived_at is null and v.is_overdue;
  if n > 0 then made := made + private.fin_notify(p_org, 'overdue', 'Contas a pagar vencidas', n || ' parcela(s) estão vencidas e pendentes.', '/pagar?venc=vencidas', 'overdue:' || today::text, roles); end if;
  select count(*) into n from public.fin_installments_view v where v.organization_id = p_org and v.entry_type = 'receivable' and v.cancelled_at is null and v.archived_at is null and v.is_overdue;
  if n > 0 then made := made + private.fin_notify(p_org, 'receivable_late', 'Recebimentos atrasados', n || ' parcela(s) a receber estão atrasadas.', '/receber?venc=vencidas', 'late:' || today::text, roles); end if;
  select count(*) into n from public.bank_statement_lines l where l.organization_id = p_org and l.reconciliation_status = 'pending' and l.transaction_date < today - 7;
  if n > 0 then made := made + private.fin_notify(p_org, 'reconciliation_pending', 'Conciliação pendente', n || ' linha(s) de extrato com mais de 7 dias seguem sem conciliar.', '/conciliacao', 'recon:' || today::text, roles); end if;
  return made;
end $$;
revoke all on function private.fin_generate_notifications(uuid) from public;

-- Execução agendada (pg_cron, quando disponível) e sob demanda (o app chama ao abrir o painel). Ambas idempotentes; sem processo permanente.
create function private.fin_run_scheduled() returns integer
language plpgsql security definer set search_path = '' as $$
declare o record; total integer := 0;
begin
  for o in select id from public.organizations loop
    total := total + private.fin_generate_recurring(o.id) + private.fin_generate_notifications(o.id);
  end loop;
  return total;
end $$;
revoke all on function private.fin_run_scheduled() from public;

create function public.fin_run_routines(p_org uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare gen integer; nt integer;
begin
  perform private.fin_guard(p_org, 'analyst');
  gen := private.fin_generate_recurring(p_org);
  nt := private.fin_generate_notifications(p_org);
  return jsonb_build_object('recurring_generated', gen, 'notifications_created', nt);
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.fin_register_attachment(uuid, text, uuid, text, text, text, integer)', 'public.fin_archive_attachment(uuid)',
    'public.fin_mark_notifications_read(uuid, uuid[])', 'public.fin_set_notification_pref(uuid, text, boolean)', 'public.fin_run_routines(uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- ======================================================================= Storage privado (só se o schema storage existir: Supabase real/local)
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('fin-attachments', 'fin-attachments', false, 10485760, array['application/pdf', 'image/png', 'image/jpeg'])
    on conflict (id) do update set public = false, file_size_limit = 10485760, allowed_mime_types = array['application/pdf', 'image/png', 'image/jpeg'];

    -- primeiro segmento do caminho = id da organização; analista+ grava, qualquer membro lê; ninguém altera nem apaga pelo cliente.
    execute $f$create or replace function private.fin_storage_org(p_name text) returns uuid language sql immutable set search_path = '' as
      $b$ select case when split_part(p_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then split_part(p_name, '/', 1)::uuid end $b$ $f$;
    execute 'revoke all on function private.fin_storage_org(text) from public';
    execute 'grant execute on function private.fin_storage_org(text) to authenticated';
    execute 'drop policy if exists fin_att_insert on storage.objects';
    execute 'drop policy if exists fin_att_select on storage.objects';
    execute $p$create policy fin_att_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'fin-attachments' and private.fin_storage_org(objects.name) is not null and private.fin_is_analyst(private.fin_storage_org(objects.name)) and private.mfa_ok())$p$;
    execute $p$create policy fin_att_select on storage.objects for select to authenticated
      using (bucket_id = 'fin-attachments' and private.fin_storage_org(objects.name) is not null and private.fin_can_read(private.fin_storage_org(objects.name)))$p$;
  end if;
end $$;

commit;
