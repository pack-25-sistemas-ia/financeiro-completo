-- Gestão Financeira Empresarial — VISÕES DE LEITURA e RECORRÊNCIAS (parte 3).
-- As visões são security_invoker: a RLS de quem consulta continua valendo. Recorrência gera TÍTULOS PREVISTOS (nunca baixa nem movimento).

begin;
set local check_function_bodies = off;

-- ======================================================================= visão de parcelas enriquecida (nomes para listagens)
create or replace view public.fin_installments_view with (security_invoker = true) as
select i.id as installment_id, i.organization_id, i.entry_id, e.entry_type, i.installment_number, i.total_installments, i.amount_cents, i.due_date,
       coalesce(p.paid, 0)::bigint as paid_cents, (i.amount_cents - coalesce(p.paid, 0))::bigint as pending_cents,
       e.counterparty_id, e.category_id, e.competence_date, e.description, e.cancelled_at, e.archived_at,
       case when e.cancelled_at is not null then 'cancelled' when coalesce(p.paid, 0) = 0 then 'open'
            when coalesce(p.paid, 0) < i.amount_cents then 'partial' else 'paid' end as status,
       (e.cancelled_at is null and i.amount_cents > coalesce(p.paid, 0) and i.due_date < (now() at time zone s.timezone)::date) as is_overdue,
       cp.name as counterparty_name, cat.name as category_name, e.expected_account_id, e.issue_date, e.recurring_rule_id,
       p.last_paid_at
from public.financial_installments i
join public.financial_entries e on e.id = i.entry_id
join public.fin_settings s on s.organization_id = i.organization_id
left join public.counterparties cp on cp.id = e.counterparty_id
left join public.financial_categories cat on cat.id = e.category_id
left join lateral (select sum(st.amount_cents) as paid, max(st.settled_at) as last_paid_at from public.settlements st where st.installment_id = i.id and st.reversed_at is null) p on true;

-- Extrato: cada movimento do livro com sua origem legível.
create view public.fin_movements_view with (security_invoker = true) as
select m.id as movement_id, m.organization_id, m.account_id, a.name as account_name, m.movement_type, m.amount_cents, m.effective_at, m.description,
       m.settlement_id, m.transfer_id, m.adjustment_id, m.reverses_movement_id,
       exists (select 1 from public.account_movements r where r.reverses_movement_id = m.id) as is_reversed,
       e.id as entry_id, e.entry_type, e.description as entry_description, e.category_id, cat.name as category_name,
       e.counterparty_id, cp.name as counterparty_name, i.installment_number, i.total_installments
from public.account_movements m
join public.financial_accounts a on a.id = m.account_id
left join public.settlements s on s.id = m.settlement_id
left join public.financial_installments i on i.id = s.installment_id
left join public.financial_entries e on e.id = i.entry_id
left join public.financial_categories cat on cat.id = e.category_id
left join public.counterparties cp on cp.id = e.counterparty_id;

grant select on public.fin_installments_view, public.fin_movements_view to authenticated;
revoke all on public.fin_movements_view from anon;

-- ======================================================================= regras de recorrência
create type public.fin_frequency as enum ('weekly', 'monthly', 'quarterly', 'annual');

create table public.recurring_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  description text not null check (char_length(description) between 2 and 200),
  entry_type public.fin_entry_type not null,
  category_id uuid,
  counterparty_id uuid,
  expected_account_id uuid,
  amount_cents bigint not null check (amount_cents between 1 and 99999999999999),
  frequency public.fin_frequency not null,
  interval_count integer not null default 1 check (interval_count between 1 and 12),
  starts_on date not null,
  ends_on date,
  lead_days integer not null default 30 check (lead_days between 0 and 365),
  next_index integer not null default 0 check (next_index >= 0),
  active boolean not null default true,
  ended_at timestamptz,
  notes text check (notes is null or char_length(notes) <= 500),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (category_id, organization_id) references public.financial_categories (id, organization_id),
  foreign key (counterparty_id, organization_id) references public.counterparties (id, organization_id),
  foreign key (expected_account_id, organization_id) references public.financial_accounts (id, organization_id),
  check (ends_on is null or ends_on >= starts_on)
);
create index recurring_rules_org_idx on public.recurring_rules (organization_id, active);

create table public.recurring_occurrences (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  recurring_rule_id uuid not null,
  occurrence_index integer not null check (occurrence_index >= 0),
  scheduled_date date not null,
  status text not null check (status in ('generated', 'skipped')),
  generated_entry_id uuid,
  created_at timestamptz not null default now(),
  -- a mesma ocorrência nunca é gerada duas vezes (reprocessamento e execuções simultâneas são seguros)
  unique (recurring_rule_id, occurrence_index),
  unique (recurring_rule_id, scheduled_date),
  foreign key (recurring_rule_id, organization_id) references public.recurring_rules (id, organization_id),
  foreign key (generated_entry_id, organization_id) references public.financial_entries (id, organization_id),
  check ((status = 'generated') = (generated_entry_id is not null))
);

alter table public.financial_entries add constraint financial_entries_rule_fk
  foreign key (recurring_rule_id, organization_id) references public.recurring_rules (id, organization_id);

do $$
declare t text;
begin
  foreach t in array array['recurring_rules', 'recurring_occurrences'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for select to authenticated using (private.fin_can_read(organization_id))', t || '_select', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.audit_trigger(%L, %L)', 'audit_' || t, t, 'organization_id', 'id');
  end loop;
end $$;
create trigger upd_recurring_rules before update on public.recurring_rules for each row execute function private.set_updated_at();
create trigger append_recurring_occurrences before update or delete on public.recurring_occurrences for each row execute function private.fin_append_only();
create trigger nodel_recurring_rules before delete on public.recurring_rules for each row execute function private.fin_no_delete();

-- Data da n-ésima ocorrência, sempre a partir da data inicial (sem acumular ajuste de fim de mês).
create function private.fin_rule_due(r public.recurring_rules, idx integer) returns date
language sql immutable set search_path = '' as $$
  select case r.frequency
    when 'weekly' then (r.starts_on + (7 * r.interval_count * idx))
    when 'monthly' then (r.starts_on + make_interval(months => r.interval_count * idx))::date
    when 'quarterly' then (r.starts_on + make_interval(months => 3 * r.interval_count * idx))::date
    when 'annual' then (r.starts_on + make_interval(months => 12 * r.interval_count * idx))::date
  end;
$$;
revoke all on function private.fin_rule_due(public.recurring_rules, integer) from public;

create function public.fin_create_recurring_rule(p_org uuid, p_type public.fin_entry_type, p_description text, p_counterparty uuid, p_category uuid, p_expected_account uuid,
  p_amount bigint, p_frequency public.fin_frequency, p_interval integer, p_starts_on date, p_ends_on date, p_lead_days integer default 30, p_notes text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare id uuid;
begin
  perform private.fin_guard(p_org, 'analyst');
  if p_amount is null or p_amount < 1 or p_amount > 99999999999999 then raise exception 'valor deve ser positivo e não pode passar de R$ 999.999.999.999,99' using errcode = '22023'; end if;
  if p_starts_on is null then raise exception 'informe a data de início' using errcode = '22023'; end if;
  if p_ends_on is not null and p_ends_on < p_starts_on then raise exception 'o término não pode ser anterior ao início' using errcode = '22023'; end if;
  perform private.fin_validate_refs(p_org, p_type, p_counterparty, p_category, p_expected_account);
  insert into public.recurring_rules (organization_id, description, entry_type, category_id, counterparty_id, expected_account_id, amount_cents, frequency, interval_count, starts_on, ends_on, lead_days, notes, created_by)
  values (p_org, trim(p_description), p_type, p_category, p_counterparty, p_expected_account, p_amount, p_frequency, coalesce(p_interval, 1), p_starts_on, p_ends_on, coalesce(p_lead_days, 30), nullif(trim(p_notes), ''), (select auth.uid()))
  returning recurring_rules.id into id;
  return id;
end $$;

-- Altera dados que valem para as PRÓXIMAS ocorrências; o que já foi gerado permanece como está.
create function public.fin_update_recurring_rule(p_id uuid, p_description text, p_counterparty uuid, p_category uuid, p_expected_account uuid, p_amount bigint, p_ends_on date, p_lead_days integer, p_notes text) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.recurring_rules%rowtype;
begin
  select * into r from public.recurring_rules where id = p_id for update;
  if not found then raise exception 'regra não encontrada' using errcode = '22023'; end if;
  perform private.fin_guard(r.organization_id, 'analyst');
  if r.ended_at is not null then raise exception 'regra encerrada não pode ser alterada' using errcode = '55000'; end if;
  if p_amount is null or p_amount < 1 or p_amount > 99999999999999 then raise exception 'valor deve ser positivo e não pode passar de R$ 999.999.999.999,99' using errcode = '22023'; end if;
  if p_ends_on is not null and p_ends_on < r.starts_on then raise exception 'o término não pode ser anterior ao início' using errcode = '22023'; end if;
  perform private.fin_validate_refs(r.organization_id, r.entry_type, p_counterparty, p_category, p_expected_account);
  update public.recurring_rules set description = trim(p_description), counterparty_id = p_counterparty, category_id = p_category, expected_account_id = p_expected_account,
    amount_cents = p_amount, ends_on = p_ends_on, lead_days = coalesce(p_lead_days, lead_days), notes = nullif(trim(p_notes), '') where id = p_id;
end $$;

create function public.fin_pause_recurring_rule(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.recurring_rules%rowtype;
begin
  select * into r from public.recurring_rules where id = p_id for update;
  if not found then raise exception 'regra não encontrada' using errcode = '22023'; end if;
  perform private.fin_guard(r.organization_id, 'analyst');
  if r.ended_at is not null then raise exception 'regra encerrada' using errcode = '55000'; end if;
  update public.recurring_rules set active = false where id = p_id;
end $$;

-- Ao reativar, as ocorrências cujo vencimento já passou durante a pausa são REGISTRADAS como puladas (histórico), não geradas.
create function public.fin_resume_recurring_rule(p_id uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare r public.recurring_rules%rowtype; today date; due date; skipped integer := 0;
begin
  select * into r from public.recurring_rules where id = p_id for update;
  if not found then raise exception 'regra não encontrada' using errcode = '22023'; end if;
  perform private.fin_guard(r.organization_id, 'analyst');
  if r.ended_at is not null then raise exception 'regra encerrada' using errcode = '55000'; end if;
  today := private.fin_today(r.organization_id);
  loop
    due := private.fin_rule_due(r, r.next_index);
    exit when due >= today or (r.ends_on is not null and due > r.ends_on) or skipped >= 600;
    insert into public.recurring_occurrences (organization_id, recurring_rule_id, occurrence_index, scheduled_date, status) values (r.organization_id, r.id, r.next_index, due, 'skipped');
    r.next_index := r.next_index + 1; skipped := skipped + 1;
  end loop;
  update public.recurring_rules set active = true, next_index = r.next_index where id = p_id;
  return skipped;
end $$;

create function public.fin_end_recurring_rule(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.recurring_rules%rowtype;
begin
  select * into r from public.recurring_rules where id = p_id for update;
  if not found then raise exception 'regra não encontrada' using errcode = '22023'; end if;
  perform private.fin_guard(r.organization_id, 'analyst');
  update public.recurring_rules set active = false, ended_at = coalesce(ended_at, now()) where id = p_id;
end $$;

-- Gera os TÍTULOS PREVISTOS das ocorrências que vencem até hoje + antecedência da regra. Idempotente e segura contra execuções simultâneas.
create function private.fin_generate_recurring(p_org uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare r public.recurring_rules%rowtype; today date; due date; made integer := 0; per_rule integer; e uuid; n integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('fin_recurring:' || p_org::text, 0));
  today := private.fin_today(p_org);
  for r in select * from public.recurring_rules where organization_id = p_org and active and ended_at is null order by created_at for update loop
    per_rule := 0;
    loop
      due := private.fin_rule_due(r, r.next_index);
      exit when due > today + r.lead_days or (r.ends_on is not null and due > r.ends_on) or per_rule >= 120;
      if not exists (select 1 from public.recurring_occurrences where recurring_rule_id = r.id and (occurrence_index = r.next_index or scheduled_date = due)) then
        insert into public.financial_entries (organization_id, entry_type, description, counterparty_id, category_id, expected_account_id, amount_cents, issue_date, due_date, competence_date, notes, idempotency_key, recurring_rule_id, created_by)
        values (p_org, r.entry_type, r.description, r.counterparty_id, r.category_id, r.expected_account_id, r.amount_cents, least(due, today), due, due, r.notes, 'rec:' || r.id::text || ':' || r.next_index, r.id, r.created_by)
        returning id into e;
        insert into public.financial_installments (organization_id, entry_id, installment_number, total_installments, amount_cents, due_date) values (p_org, e, 1, 1, r.amount_cents, due);
        insert into public.recurring_occurrences (organization_id, recurring_rule_id, occurrence_index, scheduled_date, status, generated_entry_id) values (p_org, r.id, r.next_index, due, 'generated', e);
        made := made + 1;
      end if;
      r.next_index := r.next_index + 1; per_rule := per_rule + 1;
    end loop;
    update public.recurring_rules set next_index = r.next_index where id = r.id and next_index <> r.next_index;
    -- regra com término definido e todas as ocorrências geradas: encerra
    if r.ends_on is not null and private.fin_rule_due(r, r.next_index) > r.ends_on then
      update public.recurring_rules set active = false, ended_at = now() where id = r.id;
    end if;
  end loop;
  return made;
end $$;
revoke all on function private.fin_generate_recurring(uuid) from public;

create function public.fin_generate_recurring(p_org uuid) returns integer
language plpgsql security definer set search_path = '' as $$
begin
  perform private.fin_guard(p_org, 'analyst');
  return private.fin_generate_recurring(p_org);
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.fin_create_recurring_rule(uuid, public.fin_entry_type, text, uuid, uuid, uuid, bigint, public.fin_frequency, integer, date, date, integer, text)',
    'public.fin_update_recurring_rule(uuid, text, uuid, uuid, uuid, bigint, date, integer, text)', 'public.fin_pause_recurring_rule(uuid)',
    'public.fin_resume_recurring_rule(uuid)', 'public.fin_end_recurring_rule(uuid)', 'public.fin_generate_recurring(uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

commit;
