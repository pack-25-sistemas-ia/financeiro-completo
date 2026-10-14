-- Gestão Financeira Empresarial — MOTOR (parte 2): invariantes, imutabilidade, funções transacionais e visões.
-- Toda função confere sessão, MFA (owner/admin), papel e vínculo da organização DENTRO dela: o servidor do app nunca decide sozinho.
-- Erros: 22023 parâmetro inválido · 42501 sem permissão · 55000 estado não permite · 23505 duplicidade · 23514 invariante violada.

begin;
set local check_function_bodies = off;

-- ======================================================================= utilidades
create function private.fin_today(p_org uuid) returns date
language sql stable security definer set search_path = '' as $$
  select (now() at time zone coalesce((select s.timezone from public.fin_settings s where s.organization_id = p_org), 'America/Sao_Paulo'))::date;
$$;

create function private.fin_brl(p_cents bigint) returns text
language sql immutable set search_path = '' as $$
  select case when p_cents < 0 then '-' else '' end || 'R$ ' || (abs(p_cents) / 100)::text || ',' || lpad((abs(p_cents) % 100)::text, 2, '0');
$$;

-- Distribuição exata pelo método do maior resto: a soma devolvida é SEMPRE p_total; empate vai ao menor índice.
create function private.fin_distribute(p_total bigint, p_weights bigint[]) returns bigint[]
language plpgsql immutable set search_path = '' as $$
declare n integer := coalesce(cardinality(p_weights), 0); s numeric := 0; res bigint[] := '{}'; rem numeric[] := '{}'; i integer; left_ bigint; best integer; w bigint;
begin
  if n < 1 or p_total is null or p_total < 0 then raise exception 'distribuição inválida' using errcode = '22023'; end if;
  foreach w in array p_weights loop
    if w is null or w <= 0 then raise exception 'peso de distribuição deve ser positivo' using errcode = '22023'; end if;
    s := s + w;
  end loop;
  for i in 1..n loop
    res[i] := floor(p_total::numeric * p_weights[i] / s)::bigint;
    rem[i] := p_total::numeric * p_weights[i] - res[i]::numeric * s;
  end loop;
  left_ := p_total - (select sum(x) from unnest(res) x);
  while left_ > 0 loop
    best := 1;
    for i in 2..n loop if rem[i] > rem[best] then best := i; end if; end loop;
    res[best] := res[best] + 1; rem[best] := -1; left_ := left_ - 1;
  end loop;
  return res;
end $$;

create function private.fin_guard(p_org uuid, p_level text) returns void
language plpgsql stable security definer set search_path = '' as $$
declare ok boolean;
begin
  if (select auth.uid()) is null then raise exception 'sessão inválida' using errcode = '28000'; end if;
  if not private.mfa_ok() then raise exception 'verificação em duas etapas necessária' using errcode = '42501'; end if;
  ok := case p_level when 'admin' then private.fin_is_admin(p_org) when 'manager' then private.fin_is_manager(p_org)
                     when 'analyst' then private.fin_is_analyst(p_org) else private.fin_can_read(p_org) end;
  if not ok then raise exception 'sem permissão' using errcode = '42501'; end if;
end $$;

-- ======================================================================= padrões por organização
create function private.fin_bootstrap_org(org uuid) returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.fin_settings (organization_id) values (org) on conflict do nothing;
  if not exists (select 1 from public.financial_categories where organization_id = org) then
    insert into public.financial_categories (organization_id, name, nature) values
      (org, 'Vendas', 'income'), (org, 'Serviços', 'income'), (org, 'Recorrências', 'income'), (org, 'Outras receitas', 'income'),
      (org, 'Pessoal', 'expense'), (org, 'Marketing', 'expense'), (org, 'Tecnologia', 'expense'), (org, 'Aluguel', 'expense'),
      (org, 'Logística', 'expense'), (org, 'Fornecedores', 'expense'), (org, 'Administrativas', 'expense'), (org, 'Outras despesas', 'expense');
  end if;
end $$;
revoke all on function private.fin_bootstrap_org(uuid) from public;
create function private.fin_on_org_created() returns trigger language plpgsql security definer set search_path = '' as $$
begin perform private.fin_bootstrap_org(new.id); return null; end $$;
revoke all on function private.fin_on_org_created() from public;
create trigger fin_on_org_created after insert on public.organizations for each row execute function private.fin_on_org_created();
select private.fin_bootstrap_org(id) from public.organizations;

-- ======================================================================= triggers: updated_at e auditoria (só metadados, sem valores)
do $$
declare t text;
begin
  foreach t in array array['financial_accounts', 'counterparties', 'financial_entries', 'fin_settings'] loop
    execute format('create trigger %I before update on public.%I for each row execute function private.set_updated_at()', 'upd_' || t, t);
  end loop;
  foreach t in array array['financial_accounts', 'financial_categories', 'cost_centers', 'counterparties', 'financial_entries', 'financial_installments',
    'financial_allocations', 'settlements', 'transfers', 'balance_adjustments', 'account_opening_history', 'fin_settings'] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.audit_trigger(%L, %L)',
      'audit_' || t, t, case t when 'fin_settings' then 'organization_id' else 'organization_id' end, case t when 'fin_settings' then 'organization_id' else 'id' end);
  end loop;
end $$;

-- ======================================================================= imutabilidade (vale até para o dono do schema)
create function private.fin_no_delete() returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'registros financeiros não podem ser apagados (histórico preservado): %', tg_table_name using errcode = '23514'; end $$;
create function private.fin_append_only() returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'registro imutável: % (corrija por estorno ou lançamento compensatório)', tg_table_name using errcode = '23514'; end $$;
do $$
declare t text;
begin
  foreach t in array array['financial_accounts', 'financial_entries', 'settlements', 'transfers'] loop
    execute format('create trigger %I before delete on public.%I for each row execute function private.fin_no_delete()', 'nodel_' || t, t);
  end loop;
  foreach t in array array['account_movements', 'balance_adjustments', 'account_opening_history'] loop
    execute format('create trigger %I before update or delete on public.%I for each row execute function private.fin_append_only()', 'append_' || t, t);
  end loop;
end $$;

-- Baixa: só a transição única «não estornada → estornada» é permitida; nada mais muda.
create function private.fin_settlement_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if old.reversed_at is not null then raise exception 'baixa já estornada é definitiva' using errcode = '23514'; end if;
  if new.reversed_at is null or (to_jsonb(new) - 'reversed_at' - 'reversed_by' - 'reversal_reason') is distinct from (to_jsonb(old) - 'reversed_at' - 'reversed_by' - 'reversal_reason') then
    raise exception 'baixa é imutável: estorne e lance novamente' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger settlement_guard before update on public.settlements for each row execute function private.fin_settlement_guard();

create function private.fin_transfer_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if old.status = 'reversed' then raise exception 'transferência estornada é definitiva' using errcode = '23514'; end if;
  if new.status <> 'reversed' or (to_jsonb(new) - 'status' - 'reversed_at' - 'reversed_by' - 'reversal_reason') is distinct from (to_jsonb(old) - 'status' - 'reversed_at' - 'reversed_by' - 'reversal_reason') then
    raise exception 'transferência é imutável: estorne e lance novamente' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger transfer_guard before update on public.transfers for each row execute function private.fin_transfer_guard();

-- Saldo inicial só muda pela função fin_set_opening_balance (que registra o histórico). Valor do título só muda sem baixas.
create function private.fin_account_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if (new.opening_balance_cents, new.opening_balance_date) is distinct from (old.opening_balance_cents, old.opening_balance_date)
     and coalesce(current_setting('fin.opening_ok', true), '') <> '1' then
    raise exception 'saldo inicial só pode ser corrigido pela função própria, com motivo e auditoria' using errcode = '23514';
  end if;
  if new.organization_id <> old.organization_id then raise exception 'conta não muda de organização' using errcode = '23514'; end if;
  return new;
end $$;
create trigger account_guard before update on public.financial_accounts for each row execute function private.fin_account_guard();

create function private.fin_entry_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.organization_id <> old.organization_id or new.entry_type <> old.entry_type then
    raise exception 'tipo e organização do título são imutáveis' using errcode = '23514';
  end if;
  if new.amount_cents <> old.amount_cents and exists (
       select 1 from public.settlements s join public.financial_installments i on i.id = s.installment_id where i.entry_id = old.id) then
    raise exception 'título com baixas (mesmo estornadas) não pode mudar de valor' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger entry_guard before update on public.financial_entries for each row execute function private.fin_entry_guard();

create function private.fin_installment_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if (new.entry_id, new.organization_id, new.installment_number, new.total_installments, new.amount_cents)
     is distinct from (old.entry_id, old.organization_id, old.installment_number, old.total_installments, old.amount_cents) then
    raise exception 'parcela só muda de vencimento; para refazer o plano use a função de replanejamento' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger installment_guard before update on public.financial_installments for each row execute function private.fin_installment_guard();

-- ======================================================================= invariantes de soma (parcelas = título; rateio = título)
create function private.fin_check_entry(p_entry uuid) returns void language plpgsql security definer set search_path = '' as $$
declare r record; a record;
begin
  select e.amount_cents as amt, count(i.id) as n, coalesce(sum(i.amount_cents), 0) as s, coalesce(min(i.total_installments), 0) as mn, coalesce(max(i.total_installments), 0) as mx
    into r from public.financial_entries e left join public.financial_installments i on i.entry_id = e.id where e.id = p_entry group by e.id, e.amount_cents;
  if not found then return; end if;
  if r.n = 0 or r.s <> r.amt or r.mn <> r.mx or r.n <> r.mn then
    raise exception 'parcelas não fecham com o valor do título (título %, soma %, valor %)', p_entry, r.s, r.amt using errcode = '23514';
  end if;
  select count(*) as n, coalesce(sum(amount_cents), 0) as s into a from public.financial_allocations where entry_id = p_entry;
  if a.n > 0 and a.s <> r.amt then
    raise exception 'rateio por centro de custo não fecha com o valor do título (soma %, valor %)', a.s, r.amt using errcode = '23514';
  end if;
end $$;
revoke all on function private.fin_check_entry(uuid) from public;

create function private.fin_check_entry_trg() returns trigger language plpgsql security definer set search_path = '' as $$
declare j jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
begin
  perform private.fin_check_entry(((case when tg_table_name = 'financial_entries' then j ->> 'id' else j ->> 'entry_id' end))::uuid);
  return null;
end $$;
revoke all on function private.fin_check_entry_trg() from public;
create constraint trigger chk_entry_sums_e after insert or update of amount_cents on public.financial_entries deferrable initially deferred for each row execute function private.fin_check_entry_trg();
create constraint trigger chk_entry_sums_i after insert or update or delete on public.financial_installments deferrable initially deferred for each row execute function private.fin_check_entry_trg();
create constraint trigger chk_entry_sums_a after insert or update or delete on public.financial_allocations deferrable initially deferred for each row execute function private.fin_check_entry_trg();

-- ======================================================================= categorias: natureza do pai, ciclos e profundidade
create function private.fin_category_guard() returns trigger language plpgsql security definer set search_path = '' as $$
declare cur uuid; depth integer := 1; pn public.fin_nature;
begin
  if tg_op = 'UPDATE' and new.nature <> old.nature then raise exception 'natureza da categoria não muda' using errcode = '23514'; end if;
  if new.parent_id is null then return new; end if;
  if new.parent_id = new.id then raise exception 'categoria não pode ser pai de si mesma' using errcode = '23514'; end if;
  select nature into pn from public.financial_categories where id = new.parent_id and organization_id = new.organization_id;
  if pn is null or pn <> new.nature then raise exception 'subcategoria deve ter a mesma natureza da categoria-pai' using errcode = '23514'; end if;
  cur := new.parent_id;
  while cur is not null loop
    depth := depth + 1;
    if depth > 3 then raise exception 'no máximo 3 níveis de categorias' using errcode = '23514'; end if;
    select parent_id into cur from public.financial_categories where id = cur;
    if cur = new.id then raise exception 'ciclo na hierarquia de categorias' using errcode = '23514'; end if;
  end loop;
  return new;
end $$;
revoke all on function private.fin_category_guard() from public;
create trigger category_guard before insert or update on public.financial_categories for each row execute function private.fin_category_guard();

-- ======================================================================= saldo e lançamento de movimentos (único caminho de escrita no livro)
create function private.fin_balance(p_account uuid, p_at timestamptz default now()) returns bigint
language sql stable security definer set search_path = '' as $$
  select a.opening_balance_cents + coalesce((select sum(m.amount_cents) from public.account_movements m where m.account_id = a.id and m.effective_at <= p_at), 0)
  from public.financial_accounts a where a.id = p_account;
$$;
revoke all on function private.fin_balance(uuid, timestamptz) from public;

create function private.fin_post_movement(p_org uuid, p_account uuid, p_type public.fin_movement_type, p_amount bigint, p_at timestamptz,
  p_settlement uuid, p_transfer uuid, p_adjustment uuid, p_reverses uuid, p_description text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare a public.financial_accounts%rowtype; mid uuid; bal bigint; tz text;
begin
  select * into a from public.financial_accounts where id = p_account and organization_id = p_org for update;
  if not found then raise exception 'conta não encontrada' using errcode = '22023'; end if;
  if not a.active then raise exception 'conta «%» está arquivada', a.name using errcode = '55000'; end if;
  select timezone into tz from public.fin_settings where organization_id = p_org;
  if (p_at at time zone coalesce(tz, 'America/Sao_Paulo'))::date < a.opening_balance_date then
    raise exception 'data anterior ao saldo inicial da conta «%» (%)', a.name, to_char(a.opening_balance_date, 'DD/MM/YYYY') using errcode = '22023';
  end if;
  if p_amount < 0 and not a.allow_negative then
    bal := private.fin_balance(p_account, 'infinity'::timestamptz);
    if bal + p_amount < 0 then raise exception 'saldo insuficiente na conta «%» (saldo %, saída %)', a.name, private.fin_brl(bal), private.fin_brl(-p_amount) using errcode = '55000'; end if;
  end if;
  insert into public.account_movements (organization_id, account_id, movement_type, amount_cents, effective_at, settlement_id, transfer_id, adjustment_id, reverses_movement_id, description)
  values (p_org, p_account, p_type, p_amount, p_at, p_settlement, p_transfer, p_adjustment, p_reverses, p_description) returning id into mid;
  return mid;
end $$;
revoke all on function private.fin_post_movement(uuid, uuid, public.fin_movement_type, bigint, timestamptz, uuid, uuid, uuid, uuid, text) from public;

-- ======================================================================= contas
create function public.fin_create_account(p_org uuid, p_name text, p_type public.fin_account_type, p_institution text, p_opening_cents bigint, p_opening_date date,
  p_include boolean default true, p_allow_negative boolean default true) returns uuid
language plpgsql security definer set search_path = '' as $$
declare id uuid;
begin
  perform private.fin_guard(p_org, 'manager');
  if p_opening_date is null or p_opening_date > private.fin_today(p_org) then raise exception 'data do saldo inicial inválida' using errcode = '22023'; end if;
  if not p_allow_negative and p_opening_cents < 0 then raise exception 'conta sem saldo negativo não pode abrir negativa' using errcode = '22023'; end if;
  insert into public.financial_accounts (organization_id, name, account_type, institution_name, opening_balance_cents, opening_balance_date, include_in_consolidated, allow_negative)
  values (p_org, trim(p_name), p_type, nullif(trim(p_institution), ''), coalesce(p_opening_cents, 0), p_opening_date, coalesce(p_include, true), coalesce(p_allow_negative, true)) returning financial_accounts.id into id;
  insert into public.account_opening_history (organization_id, account_id, new_cents, new_date, reason, changed_by)
  values (p_org, id, coalesce(p_opening_cents, 0), p_opening_date, 'Saldo inicial na criação da conta', (select auth.uid()));
  return id;
exception when unique_violation then raise exception 'já existe uma conta com este nome' using errcode = '23505';
end $$;

create function public.fin_update_account(p_id uuid, p_name text, p_institution text, p_include boolean, p_allow_negative boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.financial_accounts%rowtype;
begin
  select * into a from public.financial_accounts where id = p_id;
  if not found then raise exception 'conta não encontrada' using errcode = '22023'; end if;
  perform private.fin_guard(a.organization_id, 'manager');
  if not p_allow_negative and private.fin_balance(p_id, 'infinity') < 0 then raise exception 'conta com saldo negativo não pode proibir saldo negativo' using errcode = '55000'; end if;
  update public.financial_accounts set name = trim(p_name), institution_name = nullif(trim(p_institution), ''), include_in_consolidated = p_include, allow_negative = p_allow_negative where id = p_id;
exception when unique_violation then raise exception 'já existe uma conta com este nome' using errcode = '23505';
end $$;

create function public.fin_archive_account(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.financial_accounts%rowtype; bal bigint;
begin
  select * into a from public.financial_accounts where id = p_id for update;
  if not found then raise exception 'conta não encontrada' using errcode = '22023'; end if;
  perform private.fin_guard(a.organization_id, 'manager');
  bal := private.fin_balance(p_id, 'infinity');
  if bal <> 0 then raise exception 'conta com saldo %: transfira ou ajuste o saldo antes de arquivar', private.fin_brl(bal) using errcode = '55000'; end if;
  if exists (
    select 1 from public.financial_entries e join public.financial_installments i on i.entry_id = e.id
    where e.expected_account_id = p_id and e.cancelled_at is null and e.archived_at is null
      and i.amount_cents > coalesce((select sum(s.amount_cents) from public.settlements s where s.installment_id = i.id and s.reversed_at is null), 0)
  ) then raise exception 'há títulos em aberto previstos para esta conta: troque a conta prevista antes de arquivar' using errcode = '55000'; end if;
  update public.financial_accounts set active = false, archived_at = now() where id = p_id;
end $$;

create function public.fin_unarchive_account(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.financial_accounts%rowtype;
begin
  select * into a from public.financial_accounts where id = p_id for update;
  if not found then raise exception 'conta não encontrada' using errcode = '22023'; end if;
  perform private.fin_guard(a.organization_id, 'manager');
  update public.financial_accounts set active = true, archived_at = null where id = p_id;
end $$;

-- Correção do saldo inicial: só administrador, com motivo; deixa histórico; recusa se houver movimento anterior à nova data.
create function public.fin_set_opening_balance(p_id uuid, p_cents bigint, p_date date, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.financial_accounts%rowtype; tz text;
begin
  select * into a from public.financial_accounts where id = p_id for update;
  if not found then raise exception 'conta não encontrada' using errcode = '22023'; end if;
  perform private.fin_guard(a.organization_id, 'admin');
  if p_reason is null or char_length(trim(p_reason)) < 5 then raise exception 'informe o motivo da correção' using errcode = '22023'; end if;
  if p_cents is null or p_date is null or p_date > private.fin_today(a.organization_id) then raise exception 'saldo ou data inválidos' using errcode = '22023'; end if;
  if not a.allow_negative and p_cents < 0 then raise exception 'conta sem saldo negativo não pode abrir negativa' using errcode = '22023'; end if;
  select timezone into tz from public.fin_settings where organization_id = a.organization_id;
  if exists (select 1 from public.account_movements m where m.account_id = p_id and (m.effective_at at time zone coalesce(tz, 'America/Sao_Paulo'))::date < p_date) then
    raise exception 'existem movimentos anteriores à nova data do saldo inicial' using errcode = '55000';
  end if;
  insert into public.account_opening_history (organization_id, account_id, old_cents, new_cents, old_date, new_date, reason, changed_by)
  values (a.organization_id, p_id, a.opening_balance_cents, p_cents, a.opening_balance_date, p_date, trim(p_reason), (select auth.uid()));
  perform set_config('fin.opening_ok', '1', true);
  update public.financial_accounts set opening_balance_cents = p_cents, opening_balance_date = p_date where id = p_id;
  perform set_config('fin.opening_ok', '0', true);
end $$;

-- ======================================================================= títulos, parcelas e rateio
create function private.fin_validate_refs(p_org uuid, p_type public.fin_entry_type, p_counterparty uuid, p_category uuid, p_account uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare k public.fin_counterparty_kind; n public.fin_nature; act boolean; arch timestamptz;
begin
  if p_counterparty is not null then
    select kind, archived_at into k, arch from public.counterparties where id = p_counterparty and organization_id = p_org;
    if not found then raise exception 'cliente/fornecedor não encontrado' using errcode = '22023'; end if;
    if arch is not null then raise exception 'cliente/fornecedor arquivado' using errcode = '55000'; end if;
    if (p_type = 'receivable' and k = 'supplier') or (p_type = 'payable' and k = 'customer') then
      raise exception 'contraparte incompatível com o tipo do título' using errcode = '22023';
    end if;
  end if;
  if p_category is not null then
    select nature, active into n, act from public.financial_categories where id = p_category and organization_id = p_org;
    if not found then raise exception 'categoria não encontrada' using errcode = '22023'; end if;
    if not act then raise exception 'categoria desativada' using errcode = '55000'; end if;
    if (p_type = 'receivable' and n <> 'income') or (p_type = 'payable' and n <> 'expense') then
      raise exception 'categoria de natureza incompatível com o título' using errcode = '22023';
    end if;
  end if;
  if p_account is not null then
    select active into act from public.financial_accounts where id = p_account and organization_id = p_org;
    if not found then raise exception 'conta prevista não encontrada' using errcode = '22023'; end if;
    if not act then raise exception 'conta prevista arquivada' using errcode = '55000'; end if;
  end if;
end $$;
revoke all on function private.fin_validate_refs(uuid, public.fin_entry_type, uuid, uuid, uuid) from public;

-- Datas das parcelas: a n-ésima é calculada a partir da 1ª (fim de mês é ajustado: 31/jan → 28 ou 29/fev → 31/mar).
create function private.fin_due_dates(p_first date, p_n integer, p_freq text, p_custom date[]) returns date[]
language plpgsql immutable set search_path = '' as $$
declare res date[] := '{}'; i integer; step interval;
begin
  if p_custom is not null then
    if cardinality(p_custom) <> p_n then raise exception 'número de datas diferente do número de parcelas' using errcode = '22023'; end if;
    for i in 1..p_n loop
      if p_custom[i] is null or (i > 1 and p_custom[i] < p_custom[i - 1]) then raise exception 'datas das parcelas devem estar em ordem' using errcode = '22023'; end if;
    end loop;
    return p_custom;
  end if;
  step := case p_freq when 'weekly' then interval '7 days' when 'monthly' then interval '1 month' when 'quarterly' then interval '3 months' when 'annual' then interval '1 year'
                      else null end;
  if step is null then raise exception 'frequência inválida' using errcode = '22023'; end if;
  for i in 1..p_n loop res[i] := (p_first + step * (i - 1))::date; end loop;
  return res;
end $$;

create function private.fin_apply_allocations(p_entry uuid, p_org uuid, p_amount bigint, p_alloc jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare ids uuid[] := '{}'; ws bigint[] := '{}'; el jsonb; shares bigint[]; i integer; cc uuid; w bigint;
begin
  delete from public.financial_allocations where entry_id = p_entry;
  if p_alloc is null or jsonb_typeof(p_alloc) <> 'array' or jsonb_array_length(p_alloc) = 0 then return; end if;
  if jsonb_array_length(p_alloc) > 50 then raise exception 'rateio com centros demais' using errcode = '22023'; end if;
  for el in select * from jsonb_array_elements(p_alloc) loop
    cc := (el ->> 'cost_center_id')::uuid; w := (el ->> 'weight')::bigint;
    if cc is null or w is null or w <= 0 or w > 1000000000 then raise exception 'rateio inválido: informe centro de custo e peso positivo' using errcode = '22023'; end if;
    if cc = any (ids) then raise exception 'centro de custo repetido no rateio' using errcode = '22023'; end if;
    if not exists (select 1 from public.cost_centers where id = cc and organization_id = p_org and active) then raise exception 'centro de custo inexistente ou desativado' using errcode = '22023'; end if;
    ids := ids || cc; ws := ws || w;
  end loop;
  shares := private.fin_distribute(p_amount, ws);
  for i in 1..cardinality(ids) loop
    if shares[i] > 0 then insert into public.financial_allocations (organization_id, entry_id, cost_center_id, amount_cents) values (p_org, p_entry, ids[i], shares[i]); end if;
  end loop;
end $$;
revoke all on function private.fin_apply_allocations(uuid, uuid, bigint, jsonb) from public;

create function public.fin_create_entry(p_org uuid, p_type public.fin_entry_type, p_description text, p_counterparty uuid, p_category uuid, p_expected_account uuid,
  p_amount bigint, p_issue date, p_competence date, p_first_due date, p_installments integer default 1, p_frequency text default 'monthly',
  p_notes text default null, p_idempotency_key text default null, p_allocations jsonb default null, p_custom_dues date[] default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare id uuid; parts bigint[]; dues date[]; i integer; ex public.financial_entries%rowtype; n integer := coalesce(p_installments, 1);
begin
  perform private.fin_guard(p_org, 'analyst');
  if p_idempotency_key is not null then
    perform pg_advisory_xact_lock(hashtextextended(p_org::text || p_idempotency_key, 0));
    select * into ex from public.financial_entries where organization_id = p_org and idempotency_key = p_idempotency_key;
    if found then
      if ex.entry_type = p_type and ex.amount_cents = p_amount and ex.description = trim(p_description) then return ex.id; end if;
      raise exception 'chave de idempotência já usada com outros dados' using errcode = '23505';
    end if;
  end if;
  if p_amount is null or p_amount < 1 or p_amount > 99999999999999 then raise exception 'valor deve ser positivo e não pode passar de R$ 999.999.999.999,99' using errcode = '22023'; end if;
  if n < 1 or n > 360 then raise exception 'número de parcelas deve ficar entre 1 e 360' using errcode = '22023'; end if;
  if p_issue is null or p_competence is null or p_first_due is null then raise exception 'informe emissão, competência e vencimento' using errcode = '22023'; end if;
  if p_first_due < p_issue then raise exception 'vencimento anterior à emissão' using errcode = '22023'; end if;
  perform private.fin_validate_refs(p_org, p_type, p_counterparty, p_category, p_expected_account);
  dues := private.fin_due_dates(p_first_due, n, coalesce(p_frequency, 'monthly'), p_custom_dues);
  parts := private.fin_distribute(p_amount, array_fill(1::bigint, array[n]));
  insert into public.financial_entries (organization_id, entry_type, description, counterparty_id, category_id, expected_account_id, amount_cents, issue_date, due_date, competence_date, notes, idempotency_key, created_by)
  values (p_org, p_type, trim(p_description), p_counterparty, p_category, p_expected_account, p_amount, p_issue, dues[1], p_competence, nullif(trim(p_notes), ''), p_idempotency_key, (select auth.uid()))
  returning financial_entries.id into id;
  for i in 1..n loop
    insert into public.financial_installments (organization_id, entry_id, installment_number, total_installments, amount_cents, due_date) values (p_org, id, i, n, parts[i], dues[i]);
  end loop;
  perform private.fin_apply_allocations(id, p_org, p_amount, p_allocations);
  perform private.fin_check_entry(id);
  return id;
end $$;

create function public.fin_update_entry(p_id uuid, p_description text, p_counterparty uuid, p_category uuid, p_expected_account uuid, p_competence date, p_notes text) returns void
language plpgsql security definer set search_path = '' as $$
declare e public.financial_entries%rowtype;
begin
  select * into e from public.financial_entries where id = p_id for update;
  if not found then raise exception 'título não encontrado' using errcode = '22023'; end if;
  perform private.fin_guard(e.organization_id, 'analyst');
  if e.cancelled_at is not null then raise exception 'título cancelado não pode ser editado' using errcode = '55000'; end if;
  perform private.fin_validate_refs(e.organization_id, e.entry_type, p_counterparty, p_category, p_expected_account);
  update public.financial_entries set description = trim(p_description), counterparty_id = p_counterparty, category_id = p_category,
    expected_account_id = p_expected_account, competence_date = p_competence, notes = nullif(trim(p_notes), '') where id = p_id;
end $$;

create function public.fin_set_allocations(p_entry uuid, p_allocations jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare e public.financial_entries%rowtype;
begin
  select * into e from public.financial_entries where id = p_entry for update;
  if not found then raise exception 'título não encontrado' using errcode = '22023'; end if;
  perform private.fin_guard(e.organization_id, 'analyst');
  if e.cancelled_at is not null then raise exception 'título cancelado não pode ser reclassificado' using errcode = '55000'; end if;
  perform private.fin_apply_allocations(p_entry, e.organization_id, e.amount_cents, p_allocations);
  perform private.fin_check_entry(p_entry);
end $$;

create function public.fin_reschedule_installment(p_installment uuid, p_due date) returns void
language plpgsql security definer set search_path = '' as $$
declare i public.financial_installments%rowtype; e public.financial_entries%rowtype; paid bigint;
begin
  select * into i from public.financial_installments where id = p_installment for update;
  if not found then raise exception 'parcela não encontrada' using errcode = '22023'; end if;
  perform private.fin_guard(i.organization_id, 'analyst');
  select * into e from public.financial_entries where id = i.entry_id for update;
  if e.cancelled_at is not null then raise exception 'título cancelado' using errcode = '55000'; end if;
  select coalesce(sum(amount_cents), 0) into paid from public.settlements where installment_id = i.id and reversed_at is null;
  if paid >= i.amount_cents then raise exception 'parcela já quitada não pode mudar de vencimento' using errcode = '55000'; end if;
  if p_due is null or p_due < e.issue_date then raise exception 'vencimento anterior à emissão' using errcode = '22023'; end if;
  update public.financial_installments set due_date = p_due where id = i.id;
  update public.financial_entries set due_date = (select min(due_date) from public.financial_installments where entry_id = e.id) where id = e.id;
end $$;

-- Refaz o plano de parcelas SÓ de título sem nenhuma baixa (nem estornada): o histórico de baixas nunca é reescrito.
create function public.fin_replan_entry(p_id uuid, p_amount bigint, p_installments integer, p_first_due date, p_frequency text default 'monthly', p_custom_dues date[] default null) returns void
language plpgsql security definer set search_path = '' as $$
declare e public.financial_entries%rowtype; parts bigint[]; dues date[]; i integer; weights jsonb; n integer := coalesce(p_installments, 1);
begin
  select * into e from public.financial_entries where id = p_id for update;
  if not found then raise exception 'título não encontrado' using errcode = '22023'; end if;
  perform private.fin_guard(e.organization_id, 'manager');
  if e.cancelled_at is not null then raise exception 'título cancelado' using errcode = '55000'; end if;
  if exists (select 1 from public.settlements s join public.financial_installments x on x.id = s.installment_id where x.entry_id = p_id) then
    raise exception 'título já tem baixas (mesmo estornadas): cancele-o e lance outro' using errcode = '55000';
  end if;
  if p_amount is null or p_amount < 1 or p_amount > 99999999999999 or n < 1 or n > 360 or p_first_due is null or p_first_due < e.issue_date then
    raise exception 'plano de parcelas inválido' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('cost_center_id', cost_center_id, 'weight', amount_cents)), '[]'::jsonb) into weights from public.financial_allocations where entry_id = p_id;
  dues := private.fin_due_dates(p_first_due, n, coalesce(p_frequency, 'monthly'), p_custom_dues);
  parts := private.fin_distribute(p_amount, array_fill(1::bigint, array[n]));
  delete from public.financial_allocations where entry_id = p_id;
  delete from public.financial_installments where entry_id = p_id;
  update public.financial_entries set amount_cents = p_amount, due_date = dues[1] where id = p_id;
  for i in 1..n loop
    insert into public.financial_installments (organization_id, entry_id, installment_number, total_installments, amount_cents, due_date) values (e.organization_id, p_id, i, n, parts[i], dues[i]);
  end loop;
  perform private.fin_apply_allocations(p_id, e.organization_id, p_amount, weights);
  perform private.fin_check_entry(p_id);
end $$;

create function public.fin_cancel_entry(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare e public.financial_entries%rowtype;
begin
  select * into e from public.financial_entries where id = p_id for update;
  if not found then raise exception 'título não encontrado' using errcode = '22023'; end if;
  perform private.fin_guard(e.organization_id, 'manager');
  if e.cancelled_at is not null then raise exception 'título já cancelado' using errcode = '55000'; end if;
  if p_reason is null or char_length(trim(p_reason)) < 5 then raise exception 'informe o motivo do cancelamento' using errcode = '22023'; end if;
  if exists (select 1 from public.settlements s join public.financial_installments x on x.id = s.installment_id where x.entry_id = p_id and s.reversed_at is null) then
    raise exception 'título com baixas ativas: estorne as baixas antes de cancelar' using errcode = '55000';
  end if;
  update public.financial_entries set cancelled_at = now(), cancel_reason = trim(p_reason) where id = p_id;
end $$;

create function public.fin_archive_entry(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare e public.financial_entries%rowtype; pend bigint;
begin
  select * into e from public.financial_entries where id = p_id for update;
  if not found then raise exception 'título não encontrado' using errcode = '22023'; end if;
  perform private.fin_guard(e.organization_id, 'manager');
  select sum(i.amount_cents) - coalesce(sum((select sum(s.amount_cents) from public.settlements s where s.installment_id = i.id and s.reversed_at is null)), 0)
    into pend from public.financial_installments i where i.entry_id = p_id;
  if e.cancelled_at is null and pend > 0 then raise exception 'só é possível arquivar título quitado ou cancelado' using errcode = '55000'; end if;
  update public.financial_entries set archived_at = now() where id = p_id and archived_at is null;
end $$;

-- ======================================================================= baixa (pagamento/recebimento) e estorno
create function public.fin_settle_installment(p_installment uuid, p_account uuid, p_amount bigint, p_settled_at timestamptz, p_method text, p_reference text, p_key text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare i public.financial_installments%rowtype; e public.financial_entries%rowtype; org uuid; paid bigint; sid uuid; ex public.settlements%rowtype; signed bigint;
begin
  select organization_id into org from public.financial_installments where id = p_installment;
  if org is null then raise exception 'parcela não encontrada' using errcode = '22023'; end if;
  perform private.fin_guard(org, 'manager');
  -- trava a parcela: baixas concorrentes da mesma parcela passam uma de cada vez
  select * into i from public.financial_installments where id = p_installment for update;
  select * into e from public.financial_entries where id = i.entry_id;
  -- idempotência: com a parcela travada, a repetição enxerga a baixa já confirmada
  select * into ex from public.settlements where organization_id = org and idempotency_key = p_key;
  if found then
    if ex.installment_id = p_installment and ex.account_id = p_account and ex.amount_cents = p_amount then return ex.id; end if;
    raise exception 'chave de idempotência já usada com outros dados' using errcode = '23505';
  end if;
  if p_key is null or char_length(p_key) < 8 then raise exception 'chave de idempotência obrigatória (mín. 8 caracteres)' using errcode = '22023'; end if;
  if e.cancelled_at is not null then raise exception 'título cancelado' using errcode = '55000'; end if;
  if e.archived_at is not null then raise exception 'título arquivado' using errcode = '55000'; end if;
  if p_amount is null or p_amount < 1 then raise exception 'valor da baixa deve ser positivo' using errcode = '22023'; end if;
  if p_settled_at is null or p_settled_at > now() + interval '5 minutes' then raise exception 'data da baixa não pode ser futura' using errcode = '22023'; end if;
  if p_method is null or p_method not in ('pix', 'transfer', 'boleto', 'card', 'cash', 'check', 'other') then raise exception 'forma de pagamento inválida' using errcode = '22023'; end if;
  select coalesce(sum(amount_cents), 0) into paid from public.settlements where installment_id = i.id and reversed_at is null;
  if p_amount > i.amount_cents - paid then
    raise exception 'valor % excede o pendente da parcela (%)', private.fin_brl(p_amount), private.fin_brl(i.amount_cents - paid) using errcode = '55000';
  end if;
  -- trava a conta ANTES de gravar a baixa: a chave estrangeira da baixa tomaria um lock fraco e a subida para lock forte geraria impasse entre baixas simultâneas
  perform 1 from public.financial_accounts where id = p_account and organization_id = org for update;
  if not found then raise exception 'conta de destino inválida' using errcode = '22023'; end if;
  insert into public.settlements (organization_id, installment_id, account_id, amount_cents, settled_at, settlement_method, external_reference, idempotency_key, created_by)
  values (org, i.id, p_account, p_amount, p_settled_at, p_method, nullif(trim(p_reference), ''), p_key, (select auth.uid())) returning id into sid;
  signed := case e.entry_type when 'receivable' then p_amount else -p_amount end;
  perform private.fin_post_movement(org, p_account, 'settlement', signed, p_settled_at, sid, null, null, null, left(e.description, 200));
  return sid;
exception when foreign_key_violation then raise exception 'conta de destino inválida' using errcode = '22023';
end $$;

create function public.fin_reverse_settlement(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.settlements%rowtype; m public.account_movements%rowtype;
begin
  select * into s from public.settlements where id = p_id for update;
  if not found then raise exception 'baixa não encontrada' using errcode = '22023'; end if;
  perform private.fin_guard(s.organization_id, 'manager');
  if s.reversed_at is not null then raise exception 'baixa já estornada' using errcode = '55000'; end if;
  if p_reason is null or char_length(trim(p_reason)) < 5 then raise exception 'informe o motivo do estorno' using errcode = '22023'; end if;
  select * into m from public.account_movements where settlement_id = p_id and movement_type = 'settlement';
  perform private.fin_post_movement(s.organization_id, s.account_id, 'settlement_reversal', -m.amount_cents, now(), p_id, null, null, m.id, 'Estorno de baixa');
  update public.settlements set reversed_at = now(), reversed_by = (select auth.uid()), reversal_reason = trim(p_reason) where id = p_id;
end $$;

-- ======================================================================= transferências e ajustes
create function public.fin_create_transfer(p_org uuid, p_source uuid, p_destination uuid, p_amount bigint, p_at timestamptz, p_description text, p_key text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare tid uuid; ex public.transfers%rowtype; cnt integer;
begin
  perform private.fin_guard(p_org, 'manager');
  if p_source is null or p_destination is null or p_source = p_destination then raise exception 'origem e destino devem ser contas diferentes' using errcode = '22023'; end if;
  -- trava as duas contas em ordem fixa (evita impasse entre A→B e B→A simultâneas)
  select count(*) into cnt from (select id from public.financial_accounts where organization_id = p_org and id in (p_source, p_destination) order by id for update) x;
  if cnt <> 2 then raise exception 'contas devem existir e pertencer à organização' using errcode = '22023'; end if;
  select * into ex from public.transfers where organization_id = p_org and idempotency_key = p_key;
  if found then
    if ex.source_account_id = p_source and ex.destination_account_id = p_destination and ex.amount_cents = p_amount then return ex.id; end if;
    raise exception 'chave de idempotência já usada com outros dados' using errcode = '23505';
  end if;
  if p_key is null or char_length(p_key) < 8 then raise exception 'chave de idempotência obrigatória (mín. 8 caracteres)' using errcode = '22023'; end if;
  if p_amount is null or p_amount < 1 then raise exception 'valor da transferência deve ser positivo' using errcode = '22023'; end if;
  if p_at is null or p_at > now() + interval '5 minutes' then raise exception 'data da transferência não pode ser futura' using errcode = '22023'; end if;
  insert into public.transfers (organization_id, source_account_id, destination_account_id, amount_cents, transferred_at, description, idempotency_key, created_by)
  values (p_org, p_source, p_destination, p_amount, p_at, nullif(trim(p_description), ''), p_key, (select auth.uid())) returning id into tid;
  perform private.fin_post_movement(p_org, p_source, 'transfer_out', -p_amount, p_at, null, tid, null, null, 'Transferência enviada');
  perform private.fin_post_movement(p_org, p_destination, 'transfer_in', p_amount, p_at, null, tid, null, null, 'Transferência recebida');
  return tid;
end $$;

create function public.fin_reverse_transfer(p_id uuid, p_reason text) returns void
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
  -- devolve primeiro o dinheiro que saiu do destino (se ele não pode ficar negativo, a operação falha inteira)
  perform private.fin_post_movement(t.organization_id, t.destination_account_id, 'transfer_reversal', -mi.amount_cents, now(), null, p_id, null, mi.id, 'Estorno de transferência');
  perform private.fin_post_movement(t.organization_id, t.source_account_id, 'transfer_reversal', -mo.amount_cents, now(), null, p_id, null, mo.id, 'Estorno de transferência');
  update public.transfers set status = 'reversed', reversed_at = now(), reversed_by = (select auth.uid()), reversal_reason = trim(p_reason) where id = p_id;
end $$;

create function public.fin_create_adjustment(p_org uuid, p_account uuid, p_amount bigint, p_kind public.fin_adjustment_kind, p_reason text, p_at timestamptz, p_key text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare aid uuid; ex public.balance_adjustments%rowtype;
begin
  perform private.fin_guard(p_org, 'manager');
  perform 1 from public.financial_accounts where id = p_account and organization_id = p_org for update;
  if not found then raise exception 'conta não encontrada' using errcode = '22023'; end if;
  select * into ex from public.balance_adjustments where organization_id = p_org and idempotency_key = p_key;
  if found then
    if ex.account_id = p_account and ex.amount_cents = p_amount then return ex.id; end if;
    raise exception 'chave de idempotência já usada com outros dados' using errcode = '23505';
  end if;
  if p_key is null or char_length(p_key) < 8 then raise exception 'chave de idempotência obrigatória (mín. 8 caracteres)' using errcode = '22023'; end if;
  if p_amount is null or p_amount = 0 then raise exception 'valor do ajuste não pode ser zero' using errcode = '22023'; end if;
  if p_reason is null or char_length(trim(p_reason)) < 5 then raise exception 'informe o motivo do ajuste' using errcode = '22023'; end if;
  if p_at is null or p_at > now() + interval '5 minutes' then raise exception 'data do ajuste não pode ser futura' using errcode = '22023'; end if;
  insert into public.balance_adjustments (organization_id, account_id, amount_cents, kind, reason, occurred_at, idempotency_key, created_by)
  values (p_org, p_account, p_amount, p_kind, trim(p_reason), p_at, p_key, (select auth.uid())) returning id into aid;
  perform private.fin_post_movement(p_org, p_account, 'adjustment', p_amount, p_at, null, null, aid, null, left(trim(p_reason), 200));
  return aid;
end $$;

-- ======================================================================= visões (security_invoker: a RLS de quem consulta continua valendo)
create view public.fin_installments_view with (security_invoker = true) as
select i.id as installment_id, i.organization_id, i.entry_id, e.entry_type, i.installment_number, i.total_installments, i.amount_cents, i.due_date,
       coalesce(p.paid, 0)::bigint as paid_cents, (i.amount_cents - coalesce(p.paid, 0))::bigint as pending_cents,
       e.counterparty_id, e.category_id, e.competence_date, e.description, e.cancelled_at, e.archived_at,
       case when e.cancelled_at is not null then 'cancelled' when coalesce(p.paid, 0) = 0 then 'open'
            when coalesce(p.paid, 0) < i.amount_cents then 'partial' else 'paid' end as status,
       (e.cancelled_at is null and i.amount_cents > coalesce(p.paid, 0) and i.due_date < (now() at time zone s.timezone)::date) as is_overdue
from public.financial_installments i
join public.financial_entries e on e.id = i.entry_id
join public.fin_settings s on s.organization_id = i.organization_id
left join lateral (select sum(st.amount_cents) as paid from public.settlements st where st.installment_id = i.id and st.reversed_at is null) p on true;

create view public.fin_account_balances with (security_invoker = true) as
select a.id as account_id, a.organization_id, a.name, a.account_type, a.include_in_consolidated, a.active, a.opening_balance_cents,
       coalesce(m.total, 0)::bigint as movements_cents, (a.opening_balance_cents + coalesce(m.total, 0))::bigint as balance_cents
from public.financial_accounts a
left join lateral (select sum(x.amount_cents) as total from public.account_movements x where x.account_id = a.id) m on true;

grant select on public.fin_installments_view, public.fin_account_balances to authenticated;
revoke all on public.fin_installments_view, public.fin_account_balances from anon;

-- ======================================================================= privilégios das funções públicas
do $$
declare f text;
begin
  foreach f in array array[
    'public.fin_create_account(uuid, text, public.fin_account_type, text, bigint, date, boolean, boolean)', 'public.fin_update_account(uuid, text, text, boolean, boolean)',
    'public.fin_archive_account(uuid)', 'public.fin_unarchive_account(uuid)', 'public.fin_set_opening_balance(uuid, bigint, date, text)',
    'public.fin_create_entry(uuid, public.fin_entry_type, text, uuid, uuid, uuid, bigint, date, date, date, integer, text, text, text, jsonb, date[])',
    'public.fin_update_entry(uuid, text, uuid, uuid, uuid, date, text)', 'public.fin_set_allocations(uuid, jsonb)', 'public.fin_reschedule_installment(uuid, date)',
    'public.fin_replan_entry(uuid, bigint, integer, date, text, date[])', 'public.fin_cancel_entry(uuid, text)', 'public.fin_archive_entry(uuid)',
    'public.fin_settle_installment(uuid, uuid, bigint, timestamptz, text, text, text)', 'public.fin_reverse_settlement(uuid, text)',
    'public.fin_create_transfer(uuid, uuid, uuid, bigint, timestamptz, text, text)', 'public.fin_reverse_transfer(uuid, text)',
    'public.fin_create_adjustment(uuid, uuid, bigint, public.fin_adjustment_kind, text, timestamptz, text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  foreach f in array array['private.fin_today(uuid)', 'private.fin_guard(uuid, text)', 'private.fin_brl(bigint)', 'private.fin_distribute(bigint, bigint[])', 'private.fin_due_dates(date, integer, text, date[])'] loop
    execute format('revoke all on function %s from public', f);
  end loop;
end $$;

-- Configurações financeiras: só o administrador altera (fuso, antecedência de alertas, parâmetros dos cenários de projeção).
grant update (timezone, alert_days_before, proj_cons_delay_days, proj_cons_cut_bps, proj_opt_advance_days, proj_opt_gain_bps) on public.fin_settings to authenticated;
create policy fin_settings_update on public.fin_settings for update to authenticated using (private.fin_is_admin(organization_id)) with check (private.fin_is_admin(organization_id));
create policy mfa_update on public.fin_settings as restrictive for update to authenticated using (private.mfa_ok()) with check (private.mfa_ok());

commit;
