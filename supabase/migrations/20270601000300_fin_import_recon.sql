-- Gestão Financeira Empresarial — IMPORTAÇÃO (CSV), EXTRATO e CONCILIAÇÃO MANUAL (parte 4).
-- O arquivo é lido no servidor do app; o banco guarda a prévia (import_rows), valida de novo cada linha, detecta duplicidade
-- (arquivo repetido e linha repetida) e só cria algo quando o usuário CONFIRMA (fin_commit_import). Extrato nunca baixa título sozinho.

begin;
set local check_function_bodies = off;

create type public.fin_import_kind as enum ('payables', 'receivables', 'customers', 'suppliers', 'statement', 'history');

create table public.imports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  kind public.fin_import_kind not null,
  file_name text not null check (char_length(file_name) between 1 and 200),
  source text not null default 'csv' check (source in ('csv')),
  file_hash text not null check (file_hash ~ '^[0-9a-f]{64}$'),
  account_id uuid,
  status text not null default 'previewed' check (status in ('previewed', 'completed', 'cancelled')),
  total_rows integer not null default 0,
  valid_rows integer not null default 0,
  duplicate_rows integer not null default 0,
  error_rows integer not null default 0,
  accepted_rows integer not null default 0,
  rejected_rows integer not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (id, organization_id),
  foreign key (account_id, organization_id) references public.financial_accounts (id, organization_id),
  check ((status = 'completed') = (completed_at is not null))
);
-- o mesmo arquivo (por conteúdo) não é importado duas vezes para o mesmo tipo/conta
create unique index imports_file_done_uniq on public.imports (organization_id, kind, coalesce(account_id, '00000000-0000-0000-0000-000000000000'::uuid), file_hash) where status = 'completed';

create table public.import_rows (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  import_id uuid not null,
  kind public.fin_import_kind not null,
  row_number integer not null check (row_number >= 1),
  source_reference text check (source_reference is null or char_length(source_reference) <= 120),
  normalized_hash text not null check (normalized_hash ~ '^[0-9a-f]{64}$'),
  parsed_data jsonb not null,
  status text not null check (status in ('valid', 'duplicate', 'error', 'imported', 'rejected')),
  error_message text check (error_message is null or char_length(error_message) <= 300),
  created_entity_id uuid,
  unique (import_id, row_number),
  foreign key (import_id, organization_id) references public.imports (id, organization_id)
);
-- uma linha só vira «importada» uma vez por organização e tipo (impede duplicar entre arquivos diferentes)
create unique index import_rows_imported_uniq on public.import_rows (organization_id, kind, normalized_hash) where status = 'imported';

create table public.bank_statement_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  account_id uuid not null,
  import_id uuid,
  external_reference text check (external_reference is null or char_length(external_reference) <= 120),
  transaction_date date not null,
  amount_cents bigint not null check (amount_cents <> 0 and amount_cents between -99999999999999 and 99999999999999),
  description text not null check (char_length(description) between 1 and 300),
  normalized_hash text not null check (normalized_hash ~ '^[0-9a-f]{64}$'),
  reconciliation_status text not null default 'pending' check (reconciliation_status in ('pending', 'reconciled', 'divergent', 'ignored')),
  ignore_reason text check (ignore_reason is null or char_length(ignore_reason) between 5 and 300),
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, account_id, normalized_hash),
  foreign key (account_id, organization_id) references public.financial_accounts (id, organization_id),
  foreign key (import_id, organization_id) references public.imports (id, organization_id),
  check ((reconciliation_status = 'ignored') = (ignore_reason is not null))
);
create index bank_statement_lines_idx on public.bank_statement_lines (organization_id, account_id, transaction_date);

create table public.reconciliation_matches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  account_id uuid not null,
  statement_line_id uuid not null,
  movement_id uuid not null,
  matched_amount_cents bigint not null,
  difference_cents bigint not null,
  note text check (note is null or char_length(note) <= 300),
  status text not null default 'active' check (status in ('active', 'undone')),
  matched_by uuid,
  matched_at timestamptz not null default now(),
  undone_by uuid,
  undone_at timestamptz,
  undo_reason text check (undo_reason is null or char_length(undo_reason) between 5 and 300),
  unique (id, organization_id),
  foreign key (account_id, organization_id) references public.financial_accounts (id, organization_id),
  foreign key (statement_line_id, organization_id) references public.bank_statement_lines (id, organization_id),
  foreign key (movement_id, organization_id) references public.account_movements (id, organization_id),
  check ((status = 'undone') = (undone_at is not null))
);
-- um vínculo ATIVO por linha de extrato e por movimento: nada é conciliado duas vezes
create unique index recon_active_line_uniq on public.reconciliation_matches (statement_line_id) where status = 'active';
create unique index recon_active_move_uniq on public.reconciliation_matches (movement_id) where status = 'active';

do $$
declare t text;
begin
  foreach t in array array['imports', 'import_rows', 'bank_statement_lines', 'reconciliation_matches'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for select to authenticated using (private.fin_can_read(organization_id))', t || '_select', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.audit_trigger(%L, %L)', 'audit_' || t, t, 'organization_id', 'id');
  end loop;
end $$;
create trigger nodel_imports before delete on public.imports for each row execute function private.fin_no_delete();
create trigger nodel_bank_statement_lines before delete on public.bank_statement_lines for each row execute function private.fin_no_delete();
create trigger nodel_reconciliation_matches before delete on public.reconciliation_matches for each row execute function private.fin_no_delete();

-- Linha de extrato: só o estado de conciliação muda, e só pelas funções deste módulo.
create function private.fin_statement_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if (to_jsonb(new) - 'reconciliation_status' - 'ignore_reason') is distinct from (to_jsonb(old) - 'reconciliation_status' - 'ignore_reason') then
    raise exception 'linha de extrato é imutável (apenas o estado de conciliação muda)' using errcode = '23514';
  end if;
  if coalesce(current_setting('fin.recon_ok', true), '') <> '1' then
    raise exception 'o estado de conciliação só muda pelas funções de conciliação' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger statement_guard before update on public.bank_statement_lines for each row execute function private.fin_statement_guard();

-- Vínculo: só pode ser desfeito (uma vez); nunca editado ou apagado.
create function private.fin_match_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if old.status = 'undone' or new.status <> 'undone'
     or (to_jsonb(new) - 'status' - 'undone_by' - 'undone_at' - 'undo_reason') is distinct from (to_jsonb(old) - 'status' - 'undone_by' - 'undone_at' - 'undo_reason') then
    raise exception 'vínculo de conciliação só pode ser desfeito, com motivo' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger match_guard before update on public.reconciliation_matches for each row execute function private.fin_match_guard();

-- Linhas já importadas não mudam de dado; só status/entidade criada.
create function private.fin_import_row_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if (to_jsonb(new) - 'status' - 'error_message' - 'created_entity_id') is distinct from (to_jsonb(old) - 'status' - 'error_message' - 'created_entity_id') then
    raise exception 'dados da linha importada são imutáveis' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger import_row_guard before update on public.import_rows for each row execute function private.fin_import_row_guard();

-- ======================================================================= validação de linha por tipo (o banco decide; o app só pré-formata)
create function private.fin_import_validate(p_kind public.fin_import_kind, d jsonb) returns text
language plpgsql immutable set search_path = '' as $$
declare amt bigint; t text;
begin
  if jsonb_typeof(d) <> 'object' then return 'linha inválida'; end if;
  if p_kind in ('payables', 'receivables') then
    if char_length(coalesce(d ->> 'description', '')) not between 2 and 200 then return 'descrição deve ter de 2 a 200 caracteres'; end if;
    if coalesce(d ->> 'amount_cents', '') !~ '^[0-9]{1,14}$' or (d ->> 'amount_cents')::bigint not between 1 and 99999999999999 then return 'valor inválido (deve ser positivo)'; end if;
    begin
      if (d ->> 'due_date')::date < (d ->> 'issue_date')::date then return 'vencimento anterior à emissão'; end if;
      perform coalesce(d ->> 'competence_date', d ->> 'due_date')::date;
    exception when others then return 'data inválida (use AAAA-MM-DD)'; end;
  elsif p_kind in ('customers', 'suppliers') then
    if char_length(coalesce(d ->> 'name', '')) not between 2 and 120 then return 'nome deve ter de 2 a 120 caracteres'; end if;
    if d ->> 'document_number' is not null and d ->> 'document_number' !~ '^[0-9]{11}$|^[0-9]{14}$' then return 'CPF/CNPJ inválido (11 ou 14 dígitos)'; end if;
    if d ->> 'email' is not null and (d ->> 'email' <> lower(d ->> 'email') or d ->> 'email' !~ '^[^@\s]+@[^@\s]+$' or char_length(d ->> 'email') > 254) then return 'e-mail inválido'; end if;
  elsif p_kind in ('statement', 'history') then
    if char_length(coalesce(d ->> 'description', '')) not between 1 and 300 then return 'descrição obrigatória (até 300 caracteres)'; end if;
    if coalesce(d ->> 'amount_cents', '') !~ '^-?[0-9]{1,14}$' then return 'valor inválido'; end if;
    amt := (d ->> 'amount_cents')::bigint;
    if amt = 0 or abs(amt) > 99999999999999 then return 'valor não pode ser zero nem passar do limite'; end if;
    begin perform (d ->> 'date')::date; exception when others then return 'data inválida (use AAAA-MM-DD)'; end;
  end if;
  return null;
end $$;
revoke all on function private.fin_import_validate(public.fin_import_kind, jsonb) from public;

-- ======================================================================= criar a PRÉVIA da importação
create function public.fin_create_import(p_org uuid, p_kind public.fin_import_kind, p_file_name text, p_file_hash text, p_account uuid, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare imp uuid; ex public.imports%rowtype; el jsonb; rn integer; h text; msg text; st text; seen text[] := '{}'; total integer := 0; nv integer := 0; nd integer := 0; ne integer := 0; n integer;
begin
  perform private.fin_guard(p_org, case when p_kind = 'history' then 'manager' else 'analyst' end);
  if p_file_hash is null or p_file_hash !~ '^[0-9a-f]{64}$' then raise exception 'impressão digital do arquivo inválida' using errcode = '22023'; end if;
  if p_file_name is null or char_length(trim(p_file_name)) not between 1 and 200 then raise exception 'nome do arquivo inválido' using errcode = '22023'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) not between 1 and 5000 then raise exception 'o arquivo deve ter de 1 a 5.000 linhas' using errcode = '22023'; end if;
  if p_kind in ('statement', 'history') then
    if p_account is null or not exists (select 1 from public.financial_accounts where id = p_account and organization_id = p_org and active) then
      raise exception 'selecione uma conta ativa para este tipo de importação' using errcode = '22023';
    end if;
  elsif p_account is not null then
    raise exception 'este tipo de importação não usa conta' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('fin_import:' || p_org::text || p_file_hash, 0));
  select * into ex from public.imports where organization_id = p_org and kind = p_kind and file_hash = p_file_hash
    and coalesce(account_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(p_account, '00000000-0000-0000-0000-000000000000'::uuid) and status = 'completed';
  if found then return jsonb_build_object('duplicate_file', true, 'import_id', ex.id, 'status', ex.status); end if;
  update public.imports set status = 'cancelled' where organization_id = p_org and kind = p_kind and file_hash = p_file_hash and status = 'previewed'
    and coalesce(account_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(p_account, '00000000-0000-0000-0000-000000000000'::uuid);
  insert into public.imports (organization_id, kind, file_name, file_hash, account_id, created_by) values (p_org, p_kind, trim(p_file_name), p_file_hash, p_account, (select auth.uid())) returning id into imp;
  for el in select * from jsonb_array_elements(p_rows) loop
    rn := (el ->> 'row_number')::integer; h := el ->> 'hash';
    if rn is null or rn < 1 or h is null or h !~ '^[0-9a-f]{64}$' or jsonb_typeof(el -> 'data') is distinct from 'object' then raise exception 'linha % do pacote inválida', coalesce(rn, 0) using errcode = '22023'; end if;
    total := total + 1;
    msg := coalesce(nullif(el ->> 'parse_error', ''), private.fin_import_validate(p_kind, el -> 'data'));
    if msg is not null then st := 'error'; ne := ne + 1;
    elsif h = any (seen) or (p_kind <> 'statement' and exists (select 1 from public.import_rows r where r.organization_id = p_org and r.kind = p_kind and r.normalized_hash = h and r.status = 'imported'))
          or (p_kind = 'statement' and exists (select 1 from public.bank_statement_lines l where l.organization_id = p_org and l.account_id = p_account and l.normalized_hash = h)) then
      st := 'duplicate'; msg := 'linha repetida (já existe ou aparece de novo no arquivo)'; nd := nd + 1;
    else st := 'valid'; nv := nv + 1; end if;
    seen := seen || h;
    insert into public.import_rows (organization_id, import_id, kind, row_number, source_reference, normalized_hash, parsed_data, status, error_message)
    values (p_org, imp, p_kind, rn, nullif(left(el ->> 'reference', 120), ''), h, el -> 'data', st, left(msg, 300));
  end loop;
  update public.imports set total_rows = total, valid_rows = nv, duplicate_rows = nd, error_rows = ne where id = imp;
  return jsonb_build_object('duplicate_file', false, 'import_id', imp, 'status', 'previewed', 'total', total, 'valid', nv, 'duplicates', nd, 'errors', ne);
end $$;

-- ======================================================================= CONFIRMAR: cria os registros das linhas válidas (atômico por importação)
create function private.fin_find_counterparty(p_org uuid, p_name text, p_kind public.fin_counterparty_kind) returns uuid
language plpgsql security definer set search_path = '' as $$
declare c public.counterparties%rowtype;
begin
  if p_name is null or char_length(trim(p_name)) < 2 then return null; end if;
  select * into c from public.counterparties where organization_id = p_org and lower(name) = lower(trim(p_name)) and archived_at is null order by created_at limit 1;
  if found then
    if c.kind <> 'both' and c.kind <> p_kind then raise exception 'contraparte «%» já existe com o tipo oposto', c.name using errcode = '22023'; end if;
    return c.id;
  end if;
  insert into public.counterparties (organization_id, kind, name) values (p_org, p_kind, trim(p_name)) returning id into c.id;
  return c.id;
end $$;
revoke all on function private.fin_find_counterparty(uuid, text, public.fin_counterparty_kind) from public;

create function private.fin_find_category(p_org uuid, p_name text, p_nature public.fin_nature) returns uuid
language plpgsql security definer set search_path = '' as $$
declare cid uuid;
begin
  if p_name is null or btrim(p_name) = '' then return null; end if;
  select id into cid from public.financial_categories where organization_id = p_org and lower(name) = lower(trim(p_name)) and nature = p_nature and active order by parent_id nulls first limit 1;
  if cid is null then raise exception 'categoria «%» não encontrada', trim(p_name) using errcode = '22023'; end if;
  return cid;
end $$;
revoke all on function private.fin_find_category(uuid, text, public.fin_nature) from public;

create function public.fin_commit_import(p_import uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare imp public.imports%rowtype; r public.import_rows%rowtype; d jsonb; ok integer := 0; bad integer := 0; made uuid; amt bigint; due date; iss date; comp date; etype public.fin_entry_type; cp uuid; cat uuid; tz text; at_ timestamptz; sid uuid;
begin
  select * into imp from public.imports where id = p_import for update;
  if not found then raise exception 'importação não encontrada' using errcode = '22023'; end if;
  perform private.fin_guard(imp.organization_id, case when imp.kind = 'history' then 'manager' else 'analyst' end);
  if imp.status <> 'previewed' then raise exception 'importação já foi processada ou cancelada' using errcode = '55000'; end if;
  select timezone into tz from public.fin_settings where organization_id = imp.organization_id;
  for r in select * from public.import_rows where import_id = p_import and status = 'valid' order by row_number loop
    d := r.parsed_data;
    begin
      if imp.kind in ('payables', 'receivables') then
        etype := (case imp.kind when 'payables' then 'payable' else 'receivable' end)::public.fin_entry_type;
        amt := (d ->> 'amount_cents')::bigint; due := (d ->> 'due_date')::date; iss := (d ->> 'issue_date')::date; comp := coalesce(d ->> 'competence_date', d ->> 'due_date')::date;
        cp := private.fin_find_counterparty(imp.organization_id, d ->> 'counterparty_name', (case etype when 'payable' then 'supplier' else 'customer' end)::public.fin_counterparty_kind);
        cat := private.fin_find_category(imp.organization_id, d ->> 'category_name', (case etype when 'payable' then 'expense' else 'income' end)::public.fin_nature);
        insert into public.financial_entries (organization_id, entry_type, description, counterparty_id, category_id, amount_cents, issue_date, due_date, competence_date, notes, idempotency_key, created_by)
        values (imp.organization_id, etype, trim(d ->> 'description'), cp, cat, amt, iss, due, comp, nullif(left(d ->> 'notes', 1000), ''), 'imp:' || imp.id::text || ':' || r.row_number, (select auth.uid())) returning id into made;
        insert into public.financial_installments (organization_id, entry_id, installment_number, total_installments, amount_cents, due_date) values (imp.organization_id, made, 1, 1, amt, due);
      elsif imp.kind in ('customers', 'suppliers') then
        insert into public.counterparties (organization_id, kind, name, legal_name, document_number, email, phone, notes)
        values (imp.organization_id, (case imp.kind when 'customers' then 'customer' else 'supplier' end)::public.fin_counterparty_kind, trim(d ->> 'name'), nullif(trim(d ->> 'legal_name'), ''), d ->> 'document_number', d ->> 'email', nullif(left(d ->> 'phone', 30), ''), nullif(left(d ->> 'notes', 500), ''))
        returning id into made;
      elsif imp.kind = 'statement' then
        insert into public.bank_statement_lines (organization_id, account_id, import_id, external_reference, transaction_date, amount_cents, description, normalized_hash)
        values (imp.organization_id, imp.account_id, imp.id, nullif(left(d ->> 'external_reference', 120), ''), (d ->> 'date')::date, (d ->> 'amount_cents')::bigint, left(trim(d ->> 'description'), 300), r.normalized_hash) returning id into made;
      elsif imp.kind = 'history' then
        amt := (d ->> 'amount_cents')::bigint; due := (d ->> 'date')::date;
        etype := (case when amt > 0 then 'receivable' else 'payable' end)::public.fin_entry_type;
        if due > private.fin_today(imp.organization_id) then raise exception 'movimento histórico não pode estar no futuro' using errcode = '22023'; end if;
        cp := private.fin_find_counterparty(imp.organization_id, d ->> 'counterparty_name', (case etype when 'payable' then 'supplier' else 'customer' end)::public.fin_counterparty_kind);
        cat := private.fin_find_category(imp.organization_id, d ->> 'category_name', (case etype when 'payable' then 'expense' else 'income' end)::public.fin_nature);
        insert into public.financial_entries (organization_id, entry_type, description, counterparty_id, category_id, amount_cents, issue_date, due_date, competence_date, idempotency_key, created_by)
        values (imp.organization_id, etype, left(trim(d ->> 'description'), 200), cp, cat, abs(amt), due, due, due, 'imp:' || imp.id::text || ':' || r.row_number, (select auth.uid())) returning id into made;
        insert into public.financial_installments (organization_id, entry_id, installment_number, total_installments, amount_cents, due_date) values (imp.organization_id, made, 1, 1, abs(amt), due);
        at_ := (due + time '12:00') at time zone coalesce(tz, 'America/Sao_Paulo');
        insert into public.settlements (organization_id, installment_id, account_id, amount_cents, settled_at, settlement_method, external_reference, idempotency_key, created_by)
        select imp.organization_id, i.id, imp.account_id, abs(amt), at_, 'other', nullif(left(d ->> 'external_reference', 120), ''), 'imp:' || imp.id::text || ':' || r.row_number, (select auth.uid())
        from public.financial_installments i where i.entry_id = made returning id into sid;
        perform private.fin_post_movement(imp.organization_id, imp.account_id, 'settlement', amt, at_, sid, null, null, null, left(trim(d ->> 'description'), 200));
      end if;
      update public.import_rows set status = 'imported', created_entity_id = made where id = r.id;
      ok := ok + 1;
    exception when others then
      update public.import_rows set status = 'rejected', error_message = left(sqlerrm, 300) where id = r.id;
      bad := bad + 1;
    end;
  end loop;
  update public.imports set status = 'completed', completed_at = now(), accepted_rows = ok, rejected_rows = bad + error_rows + duplicate_rows where id = p_import;
  return jsonb_build_object('accepted', ok, 'rejected', bad + imp.error_rows + imp.duplicate_rows, 'failed_on_commit', bad);
end $$;

create function public.fin_cancel_import(p_import uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare imp public.imports%rowtype;
begin
  select * into imp from public.imports where id = p_import for update;
  if not found then raise exception 'importação não encontrada' using errcode = '22023'; end if;
  perform private.fin_guard(imp.organization_id, 'analyst');
  if imp.status <> 'previewed' then raise exception 'só é possível cancelar uma prévia pendente' using errcode = '55000'; end if;
  update public.imports set status = 'cancelled' where id = p_import;
end $$;

-- ======================================================================= conciliação manual
create function public.fin_reconcile(p_line uuid, p_movement uuid, p_note text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare l public.bank_statement_lines%rowtype; m public.account_movements%rowtype; mid uuid; diff bigint;
begin
  select * into l from public.bank_statement_lines where id = p_line for update;
  if not found then raise exception 'linha de extrato não encontrada' using errcode = '22023'; end if;
  perform private.fin_guard(l.organization_id, 'analyst');
  select * into m from public.account_movements where id = p_movement and organization_id = l.organization_id for update;
  if not found then raise exception 'movimento não encontrado' using errcode = '22023'; end if;
  if m.account_id <> l.account_id then raise exception 'movimento e extrato são de contas diferentes' using errcode = '22023'; end if;
  if l.reconciliation_status <> 'pending' then raise exception 'a linha do extrato não está pendente' using errcode = '55000'; end if;
  if exists (select 1 from public.reconciliation_matches where movement_id = p_movement and status = 'active') then raise exception 'movimento já conciliado com outra linha' using errcode = '55000'; end if;
  if sign(m.amount_cents) <> sign(l.amount_cents) then raise exception 'entrada e saída não podem ser conciliadas entre si' using errcode = '22023'; end if;
  diff := l.amount_cents - m.amount_cents;
  if diff <> 0 and (p_note is null or char_length(trim(p_note)) < 5) then raise exception 'valores diferentes (diferença %): informe a justificativa', private.fin_brl(diff) using errcode = '22023'; end if;
  insert into public.reconciliation_matches (organization_id, account_id, statement_line_id, movement_id, matched_amount_cents, difference_cents, note, matched_by)
  values (l.organization_id, l.account_id, p_line, p_movement, m.amount_cents, diff, nullif(trim(p_note), ''), (select auth.uid())) returning id into mid;
  perform set_config('fin.recon_ok', '1', true);
  update public.bank_statement_lines set reconciliation_status = case when diff = 0 then 'reconciled' else 'divergent' end where id = p_line;
  perform set_config('fin.recon_ok', '0', true);
  return mid;
end $$;

create function public.fin_undo_reconciliation(p_match uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare x public.reconciliation_matches%rowtype;
begin
  select * into x from public.reconciliation_matches where id = p_match for update;
  if not found then raise exception 'vínculo não encontrado' using errcode = '22023'; end if;
  perform private.fin_guard(x.organization_id, 'manager');
  if x.status <> 'active' then raise exception 'vínculo já foi desfeito' using errcode = '55000'; end if;
  if p_reason is null or char_length(trim(p_reason)) < 5 then raise exception 'informe o motivo' using errcode = '22023'; end if;
  update public.reconciliation_matches set status = 'undone', undone_by = (select auth.uid()), undone_at = now(), undo_reason = trim(p_reason) where id = p_match;
  perform set_config('fin.recon_ok', '1', true);
  update public.bank_statement_lines set reconciliation_status = 'pending' where id = x.statement_line_id;
  perform set_config('fin.recon_ok', '0', true);
end $$;

create function public.fin_ignore_statement_line(p_line uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare l public.bank_statement_lines%rowtype;
begin
  select * into l from public.bank_statement_lines where id = p_line for update;
  if not found then raise exception 'linha de extrato não encontrada' using errcode = '22023'; end if;
  perform private.fin_guard(l.organization_id, 'analyst');
  if l.reconciliation_status <> 'pending' then raise exception 'só linhas pendentes podem ser ignoradas' using errcode = '55000'; end if;
  if p_reason is null or char_length(trim(p_reason)) < 5 then raise exception 'informe a justificativa para ignorar' using errcode = '22023'; end if;
  perform set_config('fin.recon_ok', '1', true);
  update public.bank_statement_lines set reconciliation_status = 'ignored', ignore_reason = trim(p_reason) where id = p_line;
  perform set_config('fin.recon_ok', '0', true);
end $$;

create function public.fin_unignore_statement_line(p_line uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare l public.bank_statement_lines%rowtype;
begin
  select * into l from public.bank_statement_lines where id = p_line for update;
  if not found then raise exception 'linha de extrato não encontrada' using errcode = '22023'; end if;
  perform private.fin_guard(l.organization_id, 'manager');
  if l.reconciliation_status <> 'ignored' then raise exception 'a linha não está ignorada' using errcode = '55000'; end if;
  perform set_config('fin.recon_ok', '1', true);
  update public.bank_statement_lines set reconciliation_status = 'pending', ignore_reason = null where id = p_line;
  perform set_config('fin.recon_ok', '0', true);
end $$;

-- Sugestões (NUNCA confirmadas sozinhas): mesmo sinal, valor igual ou diferente, data dentro da tolerância, referência externa.
-- «ambíguo» = há mais de um candidato de valor igual para a linha, ou a mesma linha concorre pelo movimento. Executa com a RLS de quem chama.
create function public.fin_suggest_matches(p_org uuid, p_account uuid, p_tolerance_days integer default 3)
returns table (line_id uuid, movement_id uuid, score integer, date_diff integer, amount_equal boolean, ambiguous boolean, reasons text[])
language sql stable set search_path = '' as $$
  with lines as (
    select l.* from public.bank_statement_lines l where l.organization_id = p_org and l.account_id = p_account and l.reconciliation_status = 'pending'
  ), moves as (
    select m.id, m.amount_cents, (m.effective_at at time zone coalesce((select timezone from public.fin_settings where organization_id = p_org), 'America/Sao_Paulo'))::date as eff_date,
           s.external_reference as ext_ref, m.description
    from public.account_movements m left join public.settlements s on s.id = m.settlement_id
    where m.organization_id = p_org and m.account_id = p_account
      and not exists (select 1 from public.reconciliation_matches x where x.movement_id = m.id and x.status = 'active')
  ), cand as (
    select l.id as lid, m.id as mid, (l.amount_cents = m.amount_cents) as eq, abs(l.transaction_date - m.eff_date) as dd,
           (l.external_reference is not null and l.external_reference = m.ext_ref) as ref_eq
    from lines l join moves m on sign(l.amount_cents) = sign(m.amount_cents) and abs(l.transaction_date - m.eff_date) <= greatest(p_tolerance_days, 0)
    where l.amount_cents = m.amount_cents or (l.external_reference is not null and l.external_reference = m.ext_ref)
  )
  select c.lid, c.mid,
         (case when c.eq then 70 else 20 end + case when c.ref_eq then 30 else 0 end + greatest(10 - 3 * c.dd, 0))::integer,
         c.dd::integer, c.eq,
         ((select count(*) from cand c2 where c2.lid = c.lid and c2.eq) > 1 or (select count(*) from cand c3 where c3.mid = c.mid) > 1),
         array_remove(array[case when c.eq then 'valor igual' else 'valor diferente' end, case when c.ref_eq then 'mesma referência' end, case when c.dd = 0 then 'mesma data' else c.dd || ' dia(s) de diferença' end], null)
  from cand c order by 3 desc, c.lid, c.mid;
$$;

-- Resumo: saldo do sistema × total do extrato × diferenças no período (datas inclusivas).
create function public.fin_reconciliation_summary(p_org uuid, p_account uuid, p_from date, p_to date) returns jsonb
language plpgsql stable set search_path = '' as $$
declare tz text; sys_balance bigint; mv_net bigint; st_total bigint; res jsonb;
begin
  if not private.fin_can_read(p_org) then raise exception 'sem permissão' using errcode = '42501'; end if;
  select coalesce(timezone, 'America/Sao_Paulo') into tz from public.fin_settings where organization_id = p_org;
  select a.opening_balance_cents + coalesce(sum(m.amount_cents), 0) into sys_balance
    from public.financial_accounts a left join public.account_movements m on m.account_id = a.id and (m.effective_at at time zone tz)::date <= p_to
    where a.id = p_account and a.organization_id = p_org group by a.id;
  select coalesce(sum(m.amount_cents), 0) into mv_net from public.account_movements m where m.organization_id = p_org and m.account_id = p_account and (m.effective_at at time zone tz)::date between p_from and p_to;
  select coalesce(sum(l.amount_cents), 0) into st_total from public.bank_statement_lines l where l.organization_id = p_org and l.account_id = p_account and l.transaction_date between p_from and p_to;
  select jsonb_build_object(
    'system_balance_cents', sys_balance,
    'movements_net_cents', mv_net,
    'statement_total_cents', st_total,
    'difference_cents', mv_net - st_total,
    'lines_pending', (select count(*) from public.bank_statement_lines l where l.organization_id = p_org and l.account_id = p_account and l.transaction_date between p_from and p_to and l.reconciliation_status = 'pending'),
    'lines_pending_cents', (select coalesce(sum(l.amount_cents), 0) from public.bank_statement_lines l where l.organization_id = p_org and l.account_id = p_account and l.transaction_date between p_from and p_to and l.reconciliation_status = 'pending'),
    'lines_reconciled', (select count(*) from public.bank_statement_lines l where l.organization_id = p_org and l.account_id = p_account and l.transaction_date between p_from and p_to and l.reconciliation_status = 'reconciled'),
    'lines_divergent', (select count(*) from public.bank_statement_lines l where l.organization_id = p_org and l.account_id = p_account and l.transaction_date between p_from and p_to and l.reconciliation_status = 'divergent'),
    'divergence_cents', (select coalesce(sum(x.difference_cents), 0) from public.reconciliation_matches x join public.bank_statement_lines l on l.id = x.statement_line_id
                          where x.organization_id = p_org and x.account_id = p_account and x.status = 'active' and l.transaction_date between p_from and p_to),
    'lines_ignored', (select count(*) from public.bank_statement_lines l where l.organization_id = p_org and l.account_id = p_account and l.transaction_date between p_from and p_to and l.reconciliation_status = 'ignored'),
    'movements_unreconciled', (select count(*) from public.account_movements m where m.organization_id = p_org and m.account_id = p_account and (m.effective_at at time zone tz)::date between p_from and p_to
                                and not exists (select 1 from public.reconciliation_matches x where x.movement_id = m.id and x.status = 'active')),
    'movements_unreconciled_cents', (select coalesce(sum(m.amount_cents), 0) from public.account_movements m where m.organization_id = p_org and m.account_id = p_account and (m.effective_at at time zone tz)::date between p_from and p_to
                                and not exists (select 1 from public.reconciliation_matches x where x.movement_id = m.id and x.status = 'active'))
  ) into res;
  return res;
end $$;

-- Extrato com marca de conciliação.
create or replace view public.fin_movements_view with (security_invoker = true) as
select m.id as movement_id, m.organization_id, m.account_id, a.name as account_name, m.movement_type, m.amount_cents, m.effective_at, m.description,
       m.settlement_id, m.transfer_id, m.adjustment_id, m.reverses_movement_id,
       exists (select 1 from public.account_movements r where r.reverses_movement_id = m.id) as is_reversed,
       e.id as entry_id, e.entry_type, e.description as entry_description, e.category_id, cat.name as category_name,
       e.counterparty_id, cp.name as counterparty_name, i.installment_number, i.total_installments,
       (select x.id from public.reconciliation_matches x where x.movement_id = m.id and x.status = 'active') as reconciliation_match_id
from public.account_movements m
join public.financial_accounts a on a.id = m.account_id
left join public.settlements s on s.id = m.settlement_id
left join public.financial_installments i on i.id = s.installment_id
left join public.financial_entries e on e.id = i.entry_id
left join public.financial_categories cat on cat.id = e.category_id
left join public.counterparties cp on cp.id = e.counterparty_id;
grant select on public.fin_movements_view to authenticated;

-- ======================================================================= estorno de movimento CONCILIADO: só administrador
create or replace function public.fin_reverse_settlement(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.settlements%rowtype; m public.account_movements%rowtype;
begin
  select * into s from public.settlements where id = p_id for update;
  if not found then raise exception 'baixa não encontrada' using errcode = '22023'; end if;
  perform private.fin_guard(s.organization_id, 'manager');
  if s.reversed_at is not null then raise exception 'baixa já estornada' using errcode = '55000'; end if;
  if p_reason is null or char_length(trim(p_reason)) < 5 then raise exception 'informe o motivo do estorno' using errcode = '22023'; end if;
  select * into m from public.account_movements where settlement_id = p_id and movement_type = 'settlement';
  if exists (select 1 from public.reconciliation_matches x where x.movement_id = m.id and x.status = 'active') and not private.fin_is_admin(s.organization_id) then
    raise exception 'movimentação conciliada: só o administrador pode estornar (desfaça a conciliação antes)' using errcode = '42501';
  end if;
  perform private.fin_post_movement(s.organization_id, s.account_id, 'settlement_reversal', -m.amount_cents, now(), p_id, null, null, m.id, 'Estorno de baixa');
  update public.settlements set reversed_at = now(), reversed_by = (select auth.uid()), reversal_reason = trim(p_reason) where id = p_id;
end $$;

create or replace function public.fin_reverse_transfer(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare t public.transfers%rowtype; mo public.account_movements%rowtype; mi public.account_movements%rowtype;
begin
  select * into t from public.transfers where id = p_id for update;
  if not found then raise exception 'transferência não encontrada' using errcode = '22023'; end if;
  perform private.fin_guard(t.organization_id, 'manager');
  if t.status = 'reversed' then raise exception 'transferência já estornada' using errcode = '55000'; end if;
  if p_reason is null or char_length(trim(p_reason)) < 5 then raise exception 'informe o motivo do estorno' using errcode = '22023'; end if;
  perform 1 from public.financial_accounts where id in (t.source_account_id, t.destination_account_id) order by id for update;
  select * into mo from public.account_movements where transfer_id = p_id and movement_type = 'transfer_out';
  select * into mi from public.account_movements where transfer_id = p_id and movement_type = 'transfer_in';
  if exists (select 1 from public.reconciliation_matches x where x.movement_id in (mo.id, mi.id) and x.status = 'active') and not private.fin_is_admin(t.organization_id) then
    raise exception 'movimentação conciliada: só o administrador pode estornar (desfaça a conciliação antes)' using errcode = '42501';
  end if;
  perform private.fin_post_movement(t.organization_id, t.destination_account_id, 'transfer_reversal', -mi.amount_cents, now(), null, p_id, null, mi.id, 'Estorno de transferência');
  perform private.fin_post_movement(t.organization_id, t.source_account_id, 'transfer_reversal', -mo.amount_cents, now(), null, p_id, null, mo.id, 'Estorno de transferência');
  update public.transfers set status = 'reversed', reversed_at = now(), reversed_by = (select auth.uid()), reversal_reason = trim(p_reason) where id = p_id;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.fin_create_import(uuid, public.fin_import_kind, text, text, uuid, jsonb)', 'public.fin_commit_import(uuid)', 'public.fin_cancel_import(uuid)',
    'public.fin_reconcile(uuid, uuid, text)', 'public.fin_undo_reconciliation(uuid, text)', 'public.fin_ignore_statement_line(uuid, text)', 'public.fin_unignore_statement_line(uuid)',
    'public.fin_suggest_matches(uuid, uuid, integer)', 'public.fin_reconciliation_summary(uuid, uuid, date, date)',
    'public.fin_reverse_settlement(uuid, text)', 'public.fin_reverse_transfer(uuid, text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

commit;
