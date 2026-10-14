-- Gestão Financeira Empresarial — ESQUEMA (parte 1): tabelas, helpers de papel, RLS e privilégios.
-- Três conceitos separados (docs/FINANCIAL_MODEL.md): título/parcela (previsto) → baixa (settlements) → movimento (account_movements).
-- Dinheiro em centavos (bigint). Fonte de verdade do saldo: saldo inicial da conta + soma de account_movements (livro imutável).
-- Escrita de dinheiro SÓ por funções SECURITY DEFINER (parte 2). Catálogos simples (categorias, centros, contrapartes) por RLS com privilégios por coluna.

begin;
set local check_function_bodies = off;

create type public.fin_account_type as enum ('checking', 'digital', 'cash', 'savings', 'other');
create type public.fin_nature as enum ('income', 'expense');
create type public.fin_entry_type as enum ('payable', 'receivable');
create type public.fin_counterparty_kind as enum ('customer', 'supplier', 'both');
create type public.fin_movement_type as enum ('settlement', 'settlement_reversal', 'transfer_out', 'transfer_in', 'transfer_reversal', 'adjustment');
create type public.fin_adjustment_kind as enum ('manual', 'fee', 'interest', 'correction');

-- ======================================================================= helpers de autorização
-- Perfis: owner/admin = Administrador · manager = Gestor financeiro · member = Analista · viewer = Consulta.
create function private.fin_role(org uuid) returns public.org_role
language sql stable security definer set search_path = '' as $$
  select m.role from public.organization_members m where m.organization_id = org and m.user_id = (select auth.uid());
$$;
create function private.fin_can_read(org uuid) returns boolean
language sql stable security definer set search_path = '' as $$ select private.fin_role(org) is not null; $$;
create function private.fin_is_analyst(org uuid) returns boolean
language sql stable security definer set search_path = '' as $$ select coalesce(private.fin_role(org) in ('owner', 'admin', 'manager', 'member'), false); $$;
create function private.fin_is_manager(org uuid) returns boolean
language sql stable security definer set search_path = '' as $$ select coalesce(private.fin_role(org) in ('owner', 'admin', 'manager'), false); $$;
create function private.fin_is_admin(org uuid) returns boolean
language sql stable security definer set search_path = '' as $$ select coalesce(private.fin_role(org) in ('owner', 'admin'), false); $$;

do $$
declare f text;
begin
  foreach f in array array['private.fin_role(uuid)', 'private.fin_can_read(uuid)', 'private.fin_is_analyst(uuid)', 'private.fin_is_manager(uuid)', 'private.fin_is_admin(uuid)'] loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- ======================================================================= configurações financeiras da organização
create table public.fin_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  timezone text not null default 'America/Sao_Paulo' check (char_length(timezone) between 3 and 60),
  currency text not null default 'BRL' check (currency = 'BRL'),
  alert_days_before integer not null default 3 check (alert_days_before between 0 and 60),
  proj_cons_delay_days integer not null default 7 check (proj_cons_delay_days between 0 and 120),
  proj_cons_cut_bps integer not null default 1000 check (proj_cons_cut_bps between 0 and 10000),
  proj_opt_advance_days integer not null default 3 check (proj_opt_advance_days between 0 and 120),
  proj_opt_gain_bps integer not null default 500 check (proj_opt_gain_bps between 0 and 10000),
  updated_at timestamptz not null default now()
);

-- ======================================================================= contas financeiras
create table public.financial_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 80),
  account_type public.fin_account_type not null,
  institution_name text check (institution_name is null or char_length(institution_name) <= 80),
  opening_balance_cents bigint not null default 0 check (opening_balance_cents between -99999999999999 and 99999999999999),
  opening_balance_date date not null,
  currency text not null default 'BRL' check (currency = 'BRL'),
  include_in_consolidated boolean not null default true,
  allow_negative boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (id, organization_id),
  unique (organization_id, name)
);
create index financial_accounts_org_idx on public.financial_accounts (organization_id, active);

-- Toda correção do saldo inicial deixa rastro (quem, quando, antes/depois, motivo). Append-only.
create table public.account_opening_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  account_id uuid not null,
  old_cents bigint,
  new_cents bigint not null,
  old_date date,
  new_date date not null,
  reason text not null check (char_length(reason) between 5 and 300),
  changed_by uuid,
  changed_at timestamptz not null default now(),
  foreign key (account_id, organization_id) references public.financial_accounts (id, organization_id)
);

-- ======================================================================= classificação
create table public.financial_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  parent_id uuid,
  name text not null check (char_length(name) between 2 and 80),
  nature public.fin_nature not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (parent_id, organization_id) references public.financial_categories (id, organization_id)
);
create unique index financial_categories_name_uniq on public.financial_categories
  (organization_id, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));

create table public.cost_centers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 80),
  code text not null check (code ~ '^[A-Za-z0-9._-]{1,20}$'),
  description text check (description is null or char_length(description) <= 300),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, code),
  unique (organization_id, name)
);

-- Contrapartes: dados pessoais (LGPD) — nome, documento, contato. Só leitura por membros da organização.
create table public.counterparties (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  kind public.fin_counterparty_kind not null,
  name text not null check (char_length(name) between 2 and 120),
  legal_name text check (legal_name is null or char_length(legal_name) <= 160),
  document_number text check (document_number is null or document_number ~ '^[0-9]{11}$|^[0-9]{14}$'),
  email text check (email is null or (email = lower(email) and char_length(email) <= 254 and email ~ '^[^@\s]+@[^@\s]+$')),
  phone text check (phone is null or char_length(phone) <= 30),
  notes text check (notes is null or char_length(notes) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (id, organization_id)
);
create unique index counterparties_doc_uniq on public.counterparties (organization_id, document_number) where document_number is not null and archived_at is null;
create index counterparties_org_idx on public.counterparties (organization_id, kind, name);

-- ======================================================================= títulos e parcelas (PREVISTO)
create table public.financial_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  entry_type public.fin_entry_type not null,
  description text not null check (char_length(description) between 2 and 200),
  counterparty_id uuid,
  category_id uuid,
  expected_account_id uuid,
  amount_cents bigint not null check (amount_cents between 1 and 99999999999999),
  currency text not null default 'BRL' check (currency = 'BRL'),
  issue_date date not null,
  due_date date not null,                    -- vencimento da 1ª parcela (derivado do plano; mantido para ordenação)
  competence_date date not null,
  notes text check (notes is null or char_length(notes) <= 1000),
  idempotency_key text check (idempotency_key is null or char_length(idempotency_key) between 8 and 100),
  recurring_rule_id uuid,
  cancelled_at timestamptz,
  cancel_reason text check (cancel_reason is null or char_length(cancel_reason) between 5 and 300),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (id, organization_id),
  foreign key (counterparty_id, organization_id) references public.counterparties (id, organization_id),
  foreign key (category_id, organization_id) references public.financial_categories (id, organization_id),
  foreign key (expected_account_id, organization_id) references public.financial_accounts (id, organization_id),
  check ((cancelled_at is null) = (cancel_reason is null))
);
create unique index financial_entries_idem_uniq on public.financial_entries (organization_id, idempotency_key) where idempotency_key is not null;
create index financial_entries_org_idx on public.financial_entries (organization_id, entry_type, due_date);
create index financial_entries_cp_idx on public.financial_entries (organization_id, counterparty_id);

create table public.financial_installments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  entry_id uuid not null,
  installment_number integer not null check (installment_number >= 1),
  total_installments integer not null check (total_installments between 1 and 360),
  amount_cents bigint not null check (amount_cents between 1 and 99999999999999),
  due_date date not null,
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (entry_id, installment_number),
  check (installment_number <= total_installments),
  foreign key (entry_id, organization_id) references public.financial_entries (id, organization_id)
);
create index financial_installments_due_idx on public.financial_installments (organization_id, due_date);

-- Rateio por centro de custo: soma exata do título (invariante verificada na parte 2).
create table public.financial_allocations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  entry_id uuid not null,
  cost_center_id uuid not null,
  amount_cents bigint not null check (amount_cents between 1 and 99999999999999),
  created_at timestamptz not null default now(),
  unique (entry_id, cost_center_id),
  foreign key (entry_id, organization_id) references public.financial_entries (id, organization_id),
  foreign key (cost_center_id, organization_id) references public.cost_centers (id, organization_id)
);

-- ======================================================================= baixas (LIQUIDAÇÃO) e movimentos (EFETIVO)
create table public.settlements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  installment_id uuid not null,
  account_id uuid not null,
  amount_cents bigint not null check (amount_cents between 1 and 99999999999999),
  settled_at timestamptz not null,
  settlement_method text not null default 'other' check (settlement_method in ('pix', 'transfer', 'boleto', 'card', 'cash', 'check', 'other')),
  external_reference text check (external_reference is null or char_length(external_reference) <= 120),
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 100),
  created_by uuid,
  created_at timestamptz not null default now(),
  reversed_at timestamptz,
  reversed_by uuid,
  reversal_reason text check (reversal_reason is null or char_length(reversal_reason) between 5 and 300),
  unique (id, organization_id),
  unique (organization_id, idempotency_key),
  foreign key (installment_id, organization_id) references public.financial_installments (id, organization_id),
  foreign key (account_id, organization_id) references public.financial_accounts (id, organization_id),
  check ((reversed_at is null) = (reversal_reason is null))
);
create index settlements_inst_idx on public.settlements (installment_id) where reversed_at is null;
create index settlements_acc_idx on public.settlements (organization_id, account_id, settled_at);

create table public.transfers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source_account_id uuid not null,
  destination_account_id uuid not null,
  amount_cents bigint not null check (amount_cents between 1 and 99999999999999),
  transferred_at timestamptz not null,
  description text check (description is null or char_length(description) <= 200),
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 100),
  status text not null default 'posted' check (status in ('posted', 'reversed')),
  created_by uuid,
  created_at timestamptz not null default now(),
  reversed_at timestamptz,
  reversed_by uuid,
  reversal_reason text check (reversal_reason is null or char_length(reversal_reason) between 5 and 300),
  unique (id, organization_id),
  unique (organization_id, idempotency_key),
  check (source_account_id <> destination_account_id),
  foreign key (source_account_id, organization_id) references public.financial_accounts (id, organization_id),
  foreign key (destination_account_id, organization_id) references public.financial_accounts (id, organization_id),
  check ((status = 'reversed') = (reversed_at is not null))
);

-- Ajustes de saldo (tarifa, juros, correção). Ficam FORA de receita/despesa operacional; exigem motivo.
create table public.balance_adjustments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  account_id uuid not null,
  amount_cents bigint not null check (amount_cents <> 0 and amount_cents between -99999999999999 and 99999999999999),
  kind public.fin_adjustment_kind not null,
  reason text not null check (char_length(reason) between 5 and 300),
  occurred_at timestamptz not null,
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 100),
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, idempotency_key),
  foreign key (account_id, organization_id) references public.financial_accounts (id, organization_id)
);

-- LIVRO de movimentos efetivos. Sinal: entrada > 0, saída < 0. Imutável (parte 2): correção só por movimento compensatório.
create table public.account_movements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  account_id uuid not null,
  movement_type public.fin_movement_type not null,
  amount_cents bigint not null check (amount_cents <> 0 and amount_cents between -99999999999999 and 99999999999999),
  effective_at timestamptz not null,
  settlement_id uuid,
  transfer_id uuid,
  adjustment_id uuid,
  reverses_movement_id uuid,
  description text check (description is null or char_length(description) <= 200),
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (account_id, organization_id) references public.financial_accounts (id, organization_id),
  foreign key (settlement_id, organization_id) references public.settlements (id, organization_id),
  foreign key (transfer_id, organization_id) references public.transfers (id, organization_id),
  foreign key (adjustment_id, organization_id) references public.balance_adjustments (id, organization_id),
  foreign key (reverses_movement_id, organization_id) references public.account_movements (id, organization_id),
  check (num_nonnulls(settlement_id, transfer_id, adjustment_id) = 1),
  check ((movement_type in ('settlement', 'settlement_reversal')) = (settlement_id is not null)),
  check ((movement_type in ('transfer_out', 'transfer_in', 'transfer_reversal')) = (transfer_id is not null)),
  check ((movement_type = 'adjustment') = (adjustment_id is not null)),
  check ((movement_type in ('settlement_reversal', 'transfer_reversal')) = (reverses_movement_id is not null)),
  check (movement_type <> 'transfer_out' or amount_cents < 0),
  check (movement_type <> 'transfer_in' or amount_cents > 0)
);
-- Um estorno por movimento; um movimento original por baixa e por perna de transferência.
create unique index movements_reverses_uniq on public.account_movements (reverses_movement_id) where reverses_movement_id is not null;
create unique index movements_settlement_uniq on public.account_movements (settlement_id) where movement_type = 'settlement';
create unique index movements_transfer_out_uniq on public.account_movements (transfer_id) where movement_type = 'transfer_out';
create unique index movements_transfer_in_uniq on public.account_movements (transfer_id) where movement_type = 'transfer_in';
create unique index movements_adjustment_uniq on public.account_movements (adjustment_id);
create index movements_acc_idx on public.account_movements (organization_id, account_id, effective_at);

-- ======================================================================= RLS e privilégios
do $$
declare t text;
begin
  foreach t in array array['fin_settings', 'financial_accounts', 'account_opening_history', 'financial_categories', 'cost_centers', 'counterparties',
    'financial_entries', 'financial_installments', 'financial_allocations', 'settlements', 'transfers', 'balance_adjustments', 'account_movements'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for select to authenticated using (private.fin_can_read(organization_id))', t || '_select', t);
  end loop;
end $$;

-- Catálogos: escrita direta por RLS + privilégio por coluna (natureza da categoria não é editável).
grant insert (organization_id, parent_id, name, nature), update (name, active, parent_id) on public.financial_categories to authenticated;
create policy categories_insert on public.financial_categories for insert to authenticated with check (private.fin_is_manager(organization_id));
create policy categories_update on public.financial_categories for update to authenticated using (private.fin_is_manager(organization_id)) with check (private.fin_is_manager(organization_id));

grant insert (organization_id, name, code, description), update (name, code, description, active) on public.cost_centers to authenticated;
create policy cost_centers_insert on public.cost_centers for insert to authenticated with check (private.fin_is_manager(organization_id));
create policy cost_centers_update on public.cost_centers for update to authenticated using (private.fin_is_manager(organization_id)) with check (private.fin_is_manager(organization_id));

grant insert (organization_id, kind, name, legal_name, document_number, email, phone, notes),
      update (kind, name, legal_name, document_number, email, phone, notes, archived_at) on public.counterparties to authenticated;
create policy counterparties_insert on public.counterparties for insert to authenticated with check (private.fin_is_analyst(organization_id));
create policy counterparties_update on public.counterparties for update to authenticated using (private.fin_is_analyst(organization_id)) with check (private.fin_is_analyst(organization_id));

-- MFA no banco para quem é owner/admin (mesma regra do Core): sem AAL2 não escreve, nem pela API REST direta.
do $$
declare t text;
begin
  foreach t in array array['financial_categories', 'cost_centers', 'counterparties'] loop
    execute format('create policy mfa_insert on public.%I as restrictive for insert to authenticated with check (private.mfa_ok())', t);
    execute format('create policy mfa_update on public.%I as restrictive for update to authenticated using (private.mfa_ok()) with check (private.mfa_ok())', t);
  end loop;
end $$;

commit;
