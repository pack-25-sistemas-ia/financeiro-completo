-- Gestão Financeira Empresarial — MÉTRICAS, FLUXO DE CAIXA e RELATÓRIOS (parte 6). Fórmulas: docs/METRICS.md e docs/CASHFLOW_RULES.md.
-- Tudo calculado no banco, com guarda de papel e filtro de organização em cada consulta. Caixa = movimentos efetivos; competência = data do título.
-- Parâmetro p_today (padrão: hoje no fuso da organização) existe para tornar os cálculos reproduzíveis nos testes.

begin;
set local check_function_bodies = off;

-- ======================================================================= utilidades
-- Divisão inteira com arredondamento «meio para o par» (igual a divideRound do TypeScript).
create function private.fin_round_div(a bigint, b bigint) returns bigint
language plpgsql immutable set search_path = '' as $$
declare q bigint; r bigint;
begin
  if b is null or b <= 0 or a is null then return null; end if;
  q := a / b; r := a % b;
  if abs(r) * 2 > b or (abs(r) * 2 = b and q % 2 <> 0) then q := q + sign(a)::bigint; end if;
  return q;
end $$;
revoke all on function private.fin_round_div(bigint, bigint) from public;

-- Categoria e descendentes (até 3 níveis), para filtrar «categoria + subcategorias».
create function private.fin_category_ids(p_org uuid, p_cat uuid) returns uuid[]
language sql stable security definer set search_path = '' as $$
  select case when p_cat is null then null else coalesce((
    select array_agg(c.id) from public.financial_categories c
    where c.organization_id = p_org and (c.id = p_cat or c.parent_id = p_cat or c.parent_id in (select x.id from public.financial_categories x where x.parent_id = p_cat and x.organization_id = p_org))), '{}'::uuid[]) end;
$$;
revoke all on function private.fin_category_ids(uuid, uuid) from public;

create function private.fin_tz(p_org uuid) returns text
language sql stable security definer set search_path = '' as $$ select coalesce((select timezone from public.fin_settings where organization_id = p_org), 'America/Sao_Paulo') $$;
revoke all on function private.fin_tz(uuid) from public;

-- Saldo consolidado até o fim de um dia (null = agora). Sem filtro de conta soma só as contas incluídas no consolidado.
create function private.fin_balance_asof(p_org uuid, p_account uuid, p_day date) returns bigint
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(a.opening_balance_cents) filter (where p_day is null or a.opening_balance_date <= p_day), 0)::bigint
       + coalesce(sum((select coalesce(sum(m.amount_cents), 0) from public.account_movements m
                       where m.account_id = a.id and (p_day is null or (m.effective_at at time zone private.fin_tz(p_org))::date <= p_day))), 0)::bigint
  from public.financial_accounts a
  where a.organization_id = p_org and ((p_account is null and a.include_in_consolidated) or a.id = p_account);
$$;
revoke all on function private.fin_balance_asof(uuid, uuid, date) from public;

-- Movimentos de baixa (e seus estornos) no período, já com filtros e, se pedido, ponderados pelo rateio do centro de custo.
create function private.fin_realized(p_org uuid, p_from date, p_to date, p_account uuid, p_cats uuid[], p_cost_center uuid, p_counterparty uuid)
returns table (d date, account_id uuid, entry_id uuid, entry_type public.fin_entry_type, category_id uuid, counterparty_id uuid, amount_cents bigint, settlement_id uuid, movement_type public.fin_movement_type, settlement_active boolean)
language sql stable security definer set search_path = '' as $$
  select (m.effective_at at time zone private.fin_tz(p_org))::date, m.account_id, e.id, e.entry_type, e.category_id, e.counterparty_id,
         case when p_cost_center is null then m.amount_cents else round(m.amount_cents::numeric * al.amount_cents / e.amount_cents)::bigint end,
         m.settlement_id, m.movement_type, (s.reversed_at is null)
  from public.account_movements m
  join public.settlements s on s.id = m.settlement_id
  join public.financial_installments i on i.id = s.installment_id
  join public.financial_entries e on e.id = i.entry_id
  left join public.financial_allocations al on al.entry_id = e.id and al.cost_center_id = p_cost_center
  where m.organization_id = p_org and m.movement_type in ('settlement', 'settlement_reversal')
    and (m.effective_at at time zone private.fin_tz(p_org))::date between p_from and p_to
    and (p_account is null or m.account_id = p_account)
    and (p_cats is null or e.category_id = any (p_cats))
    and (p_counterparty is null or e.counterparty_id = p_counterparty)
    and (p_cost_center is null or al.id is not null);
$$;
revoke all on function private.fin_realized(uuid, date, date, uuid, uuid[], uuid, uuid) from public;

-- Parcelas com saldo pendente (não canceladas, não arquivadas), já com filtros.
create function private.fin_pending(p_org uuid, p_account uuid, p_cats uuid[], p_cost_center uuid, p_counterparty uuid)
returns table (installment_id uuid, entry_id uuid, entry_type public.fin_entry_type, due_date date, amount_cents bigint, paid_cents bigint, pending_cents bigint, category_id uuid, counterparty_id uuid, expected_account_id uuid)
language sql stable security definer set search_path = '' as $$
  select v.installment_id, v.entry_id, v.entry_type, v.due_date, v.amount_cents, v.paid_cents,
         case when p_cost_center is null then v.pending_cents else round(v.pending_cents::numeric * al.amount_cents / e.amount_cents)::bigint end,
         v.category_id, v.counterparty_id, v.expected_account_id
  from public.fin_installments_view v
  join public.financial_entries e on e.id = v.entry_id
  left join public.financial_allocations al on al.entry_id = e.id and al.cost_center_id = p_cost_center
  where v.organization_id = p_org and v.cancelled_at is null and v.archived_at is null and v.pending_cents > 0
    and (p_account is null or v.expected_account_id = p_account)
    and (p_cats is null or v.category_id = any (p_cats))
    and (p_counterparty is null or v.counterparty_id = p_counterparty)
    and (p_cost_center is null or al.id is not null);
$$;
revoke all on function private.fin_pending(uuid, uuid, uuid[], uuid, uuid) from public;

-- Previsto no período (por vencimento), para «previsto × realizado».
create function private.fin_planned(p_org uuid, p_from date, p_to date, p_account uuid, p_cats uuid[], p_cost_center uuid, p_counterparty uuid)
returns table (due_date date, entry_type public.fin_entry_type, amount_cents bigint)
language sql stable security definer set search_path = '' as $$
  select i.due_date, e.entry_type, case when p_cost_center is null then i.amount_cents else round(i.amount_cents::numeric * al.amount_cents / e.amount_cents)::bigint end
  from public.financial_installments i
  join public.financial_entries e on e.id = i.entry_id
  left join public.financial_allocations al on al.entry_id = e.id and al.cost_center_id = p_cost_center
  where i.organization_id = p_org and e.cancelled_at is null and i.due_date between p_from and p_to
    and (p_account is null or e.expected_account_id = p_account)
    and (p_cats is null or e.category_id = any (p_cats))
    and (p_counterparty is null or e.counterparty_id = p_counterparty)
    and (p_cost_center is null or al.id is not null);
$$;
revoke all on function private.fin_planned(uuid, date, date, uuid, uuid[], uuid, uuid) from public;

-- ======================================================================= projeção de caixa (base · conservador · otimista)
-- Saldo projetado(d) = saldo atual + recebimentos previstos − pagamentos previstos; usa só o PENDENTE (nada é contado duas vezes).
-- Vencidos entram na data de referência. Recorrências ainda não geradas dentro da janela entram como previstas.
create function private.fin_projection(p_org uuid, p_today date, p_days integer, p_gran text, p_scenario text, p_account uuid)
returns table (period date, inflow_cents bigint, outflow_cents bigint, net_cents bigint, balance_cents bigint)
language plpgsql stable security definer set search_path = '' as $$
declare s public.fin_settings%rowtype; start_bal bigint; last_day date := p_today + p_days; first_b date; last_b date; step interval;
begin
  select * into s from public.fin_settings where organization_id = p_org;
  start_bal := private.fin_balance_asof(p_org, p_account, null);
  first_b := case p_gran when 'week' then date_trunc('week', p_today)::date when 'month' then date_trunc('month', p_today)::date else p_today end;
  step := case p_gran when 'week' then interval '1 week' when 'month' then interval '1 month' else interval '1 day' end;
  return query
  with items as (
    select greatest(v.due_date, p_today) as base_date, v.entry_type, v.pending_cents as amt
    from public.fin_installments_view v
    where v.organization_id = p_org and v.cancelled_at is null and v.archived_at is null and v.pending_cents > 0 and (p_account is null or v.expected_account_id = p_account)
    union all
    select greatest(due, p_today), r.entry_type, r.amount_cents
    from public.recurring_rules r
    cross join lateral (select private.fin_rule_due(r, gi) as due from generate_series(r.next_index, r.next_index + 399) gi) o
    where r.organization_id = p_org and r.active and r.ended_at is null and (p_account is null or r.expected_account_id = p_account)
      and o.due <= last_day and (r.ends_on is null or o.due <= r.ends_on)
  ), adj as (
    select case when p_scenario = 'conservative' and entry_type = 'receivable' then base_date + s.proj_cons_delay_days
                when p_scenario = 'optimistic' and entry_type = 'receivable' then greatest(base_date - s.proj_opt_advance_days, p_today)
                else base_date end as dt,
           entry_type,
           case when p_scenario = 'conservative' and entry_type = 'receivable' then amt - private.fin_round_div(amt * s.proj_cons_cut_bps, 10000)
                when p_scenario = 'optimistic' and entry_type = 'receivable' then amt + private.fin_round_div(amt * s.proj_opt_gain_bps, 10000)
                else amt end as amt
    from items
  ), bucketed as (
    select case p_gran when 'week' then date_trunc('week', dt)::date when 'month' then date_trunc('month', dt)::date else dt end as b,
           coalesce(sum(amt) filter (where entry_type = 'receivable'), 0)::bigint as inflow, coalesce(sum(amt) filter (where entry_type = 'payable'), 0)::bigint as outflow
    from adj where dt <= last_day group by 1
  ), grid as (
    select g::date as b from generate_series(first_b::timestamp, last_day::timestamp, step) g
  ), joined as (
    select grid.b, coalesce(bk.inflow, 0)::bigint as inflow, coalesce(bk.outflow, 0)::bigint as outflow from grid left join bucketed bk on bk.b = grid.b
  )
  select j.b, j.inflow, j.outflow, (j.inflow - j.outflow)::bigint, (start_bal + sum(j.inflow - j.outflow) over (order by j.b))::bigint from joined j order by j.b;
end $$;
revoke all on function private.fin_projection(uuid, date, integer, text, text, uuid) from public;

create function public.fin_cashflow_projection(p_org uuid, p_days integer default 30, p_gran text default 'day', p_scenario text default 'base', p_account uuid default null, p_today date default null)
returns table (period date, inflow_cents bigint, outflow_cents bigint, net_cents bigint, balance_cents bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.fin_guard(p_org, 'read');
  if p_days is null or p_days not between 1 and 365 then raise exception 'janela de projeção deve ficar entre 1 e 365 dias' using errcode = '22023'; end if;
  if p_gran not in ('day', 'week', 'month') then raise exception 'granularidade inválida' using errcode = '22023'; end if;
  if p_scenario not in ('base', 'conservative', 'optimistic') then raise exception 'cenário inválido' using errcode = '22023'; end if;
  return query select * from private.fin_projection(p_org, coalesce(p_today, private.fin_today(p_org)), p_days, p_gran, p_scenario, p_account);
end $$;

-- ======================================================================= fluxo de caixa REALIZADO
create function public.fin_cashflow_opening(p_org uuid, p_from date, p_account uuid default null) returns bigint
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.fin_guard(p_org, 'read');
  return private.fin_balance_asof(p_org, p_account, p_from - 1);
end $$;

-- Saldo final = saldo inicial + entradas − saídas ± transferências ± ajustes. Entradas/saídas são operacionais (baixas, já líquidas de estornos).
create function public.fin_cashflow_realized(p_org uuid, p_from date, p_to date, p_gran text default 'day', p_account uuid default null)
returns table (period date, inflow_cents bigint, outflow_cents bigint, transfers_net_cents bigint, adjustments_net_cents bigint, net_cents bigint, closing_balance_cents bigint)
language plpgsql stable security definer set search_path = '' as $$
declare opening bigint; tz text := private.fin_tz(p_org);
begin
  perform private.fin_guard(p_org, 'read');
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 3660 then raise exception 'período inválido' using errcode = '22023'; end if;
  if p_gran not in ('day', 'week', 'month') then raise exception 'granularidade inválida' using errcode = '22023'; end if;
  opening := private.fin_balance_asof(p_org, p_account, p_from - 1);
  return query
  with mv as (
    select (m.effective_at at time zone tz)::date as d, m.amount_cents, m.movement_type, e.entry_type
    from public.account_movements m
    join public.financial_accounts a on a.id = m.account_id
    left join public.settlements s on s.id = m.settlement_id
    left join public.financial_installments i on i.id = s.installment_id
    left join public.financial_entries e on e.id = i.entry_id
    where m.organization_id = p_org and (m.effective_at at time zone tz)::date between p_from and p_to
      and ((p_account is null and a.include_in_consolidated) or m.account_id = p_account)
  ), bk as (
    select case p_gran when 'week' then date_trunc('week', d)::date when 'month' then date_trunc('month', d)::date else d end as b,
           coalesce(sum(amount_cents) filter (where movement_type in ('settlement', 'settlement_reversal') and entry_type = 'receivable'), 0)::bigint as inflow,
           coalesce(-sum(amount_cents) filter (where movement_type in ('settlement', 'settlement_reversal') and entry_type = 'payable'), 0)::bigint as outflow,
           coalesce(sum(amount_cents) filter (where movement_type in ('transfer_out', 'transfer_in', 'transfer_reversal')), 0)::bigint as transfers,
           coalesce(sum(amount_cents) filter (where movement_type = 'adjustment'), 0)::bigint as adjustments
    from mv group by 1
  ), grid as (
    select g::date as b from generate_series(case p_gran when 'week' then date_trunc('week', p_from) when 'month' then date_trunc('month', p_from) else p_from::timestamp end,
      p_to::timestamp, case p_gran when 'week' then interval '1 week' when 'month' then interval '1 month' else interval '1 day' end) g
  ), j as (
    select grid.b, coalesce(bk.inflow, 0)::bigint as inflow, coalesce(bk.outflow, 0)::bigint as outflow, coalesce(bk.transfers, 0)::bigint as transfers, coalesce(bk.adjustments, 0)::bigint as adjustments
    from grid left join bk on bk.b = grid.b
  )
  select j.b, j.inflow, j.outflow, j.transfers, j.adjustments, (j.inflow - j.outflow + j.transfers + j.adjustments)::bigint,
         (opening + sum(j.inflow - j.outflow + j.transfers + j.adjustments) over (order by j.b))::bigint
  from j order by j.b;
end $$;

-- ======================================================================= KPIs do painel
create function public.fin_dashboard_kpis(p_org uuid, p_from date, p_to date, p_account uuid default null, p_category uuid default null, p_cost_center uuid default null, p_counterparty uuid default null, p_today date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare today date; cats uuid[]; len integer; pf date; pt date; inc bigint; exp_ bigint; cnt bigint; pinc bigint; pexp bigint;
  pay_pend bigint; rec_pend bigint; pay_over bigint; rec_over bigint; pay_over_n integer; rec_over_n integer; due_today bigint; due_today_n integer; due7 bigint; due7_n integer; due30 bigint; due30_n integer;
  partial_pay integer; partial_rec integer; proj bigint; goals jsonb; neg_accounts jsonb;
begin
  perform private.fin_guard(p_org, 'read');
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 3660 then raise exception 'período inválido' using errcode = '22023'; end if;
  today := coalesce(p_today, private.fin_today(p_org));
  cats := private.fin_category_ids(p_org, p_category);
  len := p_to - p_from + 1; pf := p_from - len; pt := p_from - 1;
  select coalesce(sum(amount_cents) filter (where entry_type = 'receivable'), 0), coalesce(-sum(amount_cents) filter (where entry_type = 'payable'), 0),
         count(*) filter (where movement_type = 'settlement' and entry_type = 'receivable' and settlement_active)
    into inc, exp_, cnt from private.fin_realized(p_org, p_from, p_to, p_account, cats, p_cost_center, p_counterparty);
  select coalesce(sum(amount_cents) filter (where entry_type = 'receivable'), 0), coalesce(-sum(amount_cents) filter (where entry_type = 'payable'), 0)
    into pinc, pexp from private.fin_realized(p_org, pf, pt, p_account, cats, p_cost_center, p_counterparty);
  select coalesce(sum(pending_cents) filter (where entry_type = 'payable'), 0), coalesce(sum(pending_cents) filter (where entry_type = 'receivable'), 0),
         coalesce(sum(pending_cents) filter (where entry_type = 'payable' and due_date < today), 0), coalesce(sum(pending_cents) filter (where entry_type = 'receivable' and due_date < today), 0),
         count(*) filter (where entry_type = 'payable' and due_date < today), count(*) filter (where entry_type = 'receivable' and due_date < today),
         coalesce(sum(pending_cents) filter (where entry_type = 'payable' and due_date = today), 0), count(*) filter (where entry_type = 'payable' and due_date = today),
         coalesce(sum(pending_cents) filter (where entry_type = 'payable' and due_date between today and today + 7), 0), count(*) filter (where entry_type = 'payable' and due_date between today and today + 7),
         coalesce(sum(pending_cents) filter (where entry_type = 'payable' and due_date between today and today + 30), 0), count(*) filter (where entry_type = 'payable' and due_date between today and today + 30),
         count(*) filter (where entry_type = 'payable' and paid_cents > 0), count(*) filter (where entry_type = 'receivable' and paid_cents > 0)
    into pay_pend, rec_pend, pay_over, rec_over, pay_over_n, rec_over_n, due_today, due_today_n, due7, due7_n, due30, due30_n, partial_pay, partial_rec
    from private.fin_pending(p_org, p_account, cats, p_cost_center, p_counterparty);
  select balance_cents into proj from private.fin_projection(p_org, today, 30, 'day', 'base', p_account) order by period desc limit 1;
  select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'metric_type', g.metric_type, 'target_cents', g.target_amount_cents, 'period_start', g.period_start, 'period_end', g.period_end,
      'actual_cents', x.actual, 'progress_bps', least(coalesce(private.fin_round_div((greatest(x.actual, 0) * 10000)::bigint, g.target_amount_cents), 0), 99999)) order by g.period_start, g.name), '[]'::jsonb)
    into goals from public.financial_goals g
    cross join lateral (select case g.metric_type
        when 'income' then coalesce(sum(r.amount_cents) filter (where r.entry_type = 'receivable'), 0)
        when 'expense' then coalesce(-sum(r.amount_cents) filter (where r.entry_type = 'payable'), 0)
        else coalesce(sum(r.amount_cents), 0) end as actual
      from private.fin_realized(p_org, g.period_start, g.period_end, null, null, null, null) r) x
    where g.organization_id = p_org and g.period_start <= p_to and g.period_end >= p_from;
  select coalesce(jsonb_agg(jsonb_build_object('id', b.account_id, 'name', b.name, 'balance_cents', b.balance_cents)), '[]'::jsonb) into neg_accounts
    from public.fin_account_balances b where b.organization_id = p_org and b.active and b.balance_cents < 0 and (p_account is null or b.account_id = p_account);
  return jsonb_build_object(
    'period', jsonb_build_object('from', p_from, 'to', p_to, 'today', today, 'previous_from', pf, 'previous_to', pt),
    'balance_now_cents', private.fin_balance_asof(p_org, p_account, null),
    'balance_period_end_cents', private.fin_balance_asof(p_org, p_account, p_to),
    'income_cents', inc, 'expense_cents', exp_, 'net_cents', inc - exp_,
    'previous_income_cents', pinc, 'previous_expense_cents', pexp, 'previous_net_cents', pinc - pexp,
    'payables_pending_cents', pay_pend, 'receivables_pending_cents', rec_pend,
    'payables_overdue_cents', pay_over, 'receivables_overdue_cents', rec_over, 'payables_overdue_count', pay_over_n, 'receivables_overdue_count', rec_over_n,
    'payables_due_today_cents', due_today, 'payables_due_today_count', due_today_n, 'payables_due_7d_cents', due7, 'payables_due_7d_count', due7_n,
    'payables_due_30d_cents', due30, 'payables_due_30d_count', due30_n, 'partial_payables_count', partial_pay, 'partial_receivables_count', partial_rec,
    'projected_30d_cents', proj, 'receipts_count', cnt, 'avg_ticket_cents', private.fin_round_div(inc, cnt),
    'goals', goals, 'negative_accounts', neg_accounts);
end $$;

-- ======================================================================= séries e distribuições do painel
create function public.fin_dashboard_series(p_org uuid, p_from date, p_to date, p_account uuid default null, p_category uuid default null, p_cost_center uuid default null, p_counterparty uuid default null, p_today date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare today date; cats uuid[]; tz text := private.fin_tz(p_org); monthly jsonb; bal jsonb; exp_cat jsonb; inc_cat jsonb; cc jsonb; pay_age jsonb; rec_age jsonb; pva jsonb; step integer; ids uuid[];
begin
  perform private.fin_guard(p_org, 'read');
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 3660 then raise exception 'período inválido' using errcode = '22023'; end if;
  today := coalesce(p_today, private.fin_today(p_org));
  cats := private.fin_category_ids(p_org, p_category);
  step := greatest(1, ceil((p_to - p_from + 1) / 90.0)::integer);

  select coalesce(jsonb_agg(jsonb_build_object('month', mth, 'income_cents', inc, 'expense_cents', ex) order by mth), '[]'::jsonb) into monthly from (
    select gs::date as mth,
           coalesce((select sum(r.amount_cents) from private.fin_realized(p_org, greatest(gs::date, p_from), least((gs + interval '1 month - 1 day')::date, p_to), p_account, cats, p_cost_center, p_counterparty) r where r.entry_type = 'receivable'), 0) as inc,
           coalesce((select -sum(r.amount_cents) from private.fin_realized(p_org, greatest(gs::date, p_from), least((gs + interval '1 month - 1 day')::date, p_to), p_account, cats, p_cost_center, p_counterparty) r where r.entry_type = 'payable'), 0) as ex
    from generate_series(date_trunc('month', p_from)::timestamp, p_to::timestamp, interval '1 month') gs) t;

  select array_agg(a.id) into ids from public.financial_accounts a where a.organization_id = p_org and ((p_account is null and a.include_in_consolidated) or a.id = p_account);
  select coalesce(jsonb_agg(jsonb_build_object('date', g.d, 'balance_cents',
      (select coalesce(sum(a.opening_balance_cents) filter (where a.opening_balance_date <= g.d), 0) from public.financial_accounts a where a.id = any (coalesce(ids, '{}')))
      + (select coalesce(sum(m.amount_cents), 0) from public.account_movements m where m.account_id = any (coalesce(ids, '{}')) and (m.effective_at at time zone tz)::date <= g.d)) order by g.d), '[]'::jsonb)
    into bal from (select d::date as d from generate_series(p_from::timestamp, p_to::timestamp, make_interval(days => step)) d union select p_to) g;

  with r as (select * from private.fin_realized(p_org, p_from, p_to, p_account, cats, p_cost_center, p_counterparty)),
  agg as (
    select r.entry_type, coalesce(pp.parent_id, c.parent_id, c.id) as root_id, sum(r.amount_cents) as cents
    from r left join public.financial_categories c on c.id = r.category_id left join public.financial_categories pp on pp.id = c.parent_id group by 1, 2),
  tot as (select entry_type, sum(cents) as total from agg group by 1)
  select (select coalesce(jsonb_agg(jsonb_build_object('category_id', a.root_id, 'name', coalesce(rc.name, 'Sem categoria'), 'cents', abs(a.cents)::bigint,
            'share_bps', coalesce(private.fin_round_div((abs(a.cents) * 10000)::bigint, abs(t.total)::bigint), 0)) order by abs(a.cents) desc, rc.name), '[]'::jsonb)
          from agg a join tot t on t.entry_type = a.entry_type left join public.financial_categories rc on rc.id = a.root_id where a.entry_type = 'payable' and a.cents <> 0),
         (select coalesce(jsonb_agg(jsonb_build_object('category_id', a.root_id, 'name', coalesce(rc.name, 'Sem categoria'), 'cents', abs(a.cents)::bigint,
            'share_bps', coalesce(private.fin_round_div((abs(a.cents) * 10000)::bigint, abs(t.total)::bigint), 0)) order by abs(a.cents) desc, rc.name), '[]'::jsonb)
          from agg a join tot t on t.entry_type = a.entry_type left join public.financial_categories rc on rc.id = a.root_id where a.entry_type = 'receivable' and a.cents <> 0)
    into exp_cat, inc_cat;

  select coalesce(jsonb_agg(jsonb_build_object('cost_center_id', x.id, 'code', x.code, 'name', x.name, 'income_cents', x.inc, 'expense_cents', x.ex, 'net_cents', x.inc - x.ex) order by x.name), '[]'::jsonb) into cc from (
    select cc2.id, cc2.code, cc2.name,
      coalesce((select sum(r.amount_cents) from private.fin_realized(p_org, p_from, p_to, p_account, cats, cc2.id, p_counterparty) r where r.entry_type = 'receivable'), 0) as inc,
      coalesce((select -sum(r.amount_cents) from private.fin_realized(p_org, p_from, p_to, p_account, cats, cc2.id, p_counterparty) r where r.entry_type = 'payable'), 0) as ex
    from public.cost_centers cc2 where cc2.organization_id = p_org and (p_cost_center is null or cc2.id = p_cost_center)) x where x.inc <> 0 or x.ex <> 0;

  select coalesce(jsonb_agg(jsonb_build_object('bucket', b.k, 'label', b.label, 'cents', b.cents, 'count', b.n) order by b.ord), '[]'::jsonb) into pay_age from (
    select o.ord, o.k, o.label, coalesce(sum(p.pending_cents), 0) as cents, count(p.installment_id) as n
    from (values (1, 'overdue', 'Vencidas'), (2, 'd0_7', 'Hoje a 7 dias'), (3, 'd8_30', '8 a 30 dias'), (4, 'd31_60', '31 a 60 dias'), (5, 'd61p', 'Mais de 60 dias')) o(ord, k, label)
    left join private.fin_pending(p_org, p_account, cats, p_cost_center, p_counterparty) p on p.entry_type = 'payable' and o.k = case
        when p.due_date < today then 'overdue' when p.due_date <= today + 7 then 'd0_7' when p.due_date <= today + 30 then 'd8_30' when p.due_date <= today + 60 then 'd31_60' else 'd61p' end
    group by o.ord, o.k, o.label) b;
  select coalesce(jsonb_agg(jsonb_build_object('bucket', b.k, 'label', b.label, 'cents', b.cents, 'count', b.n) order by b.ord), '[]'::jsonb) into rec_age from (
    select o.ord, o.k, o.label, coalesce(sum(p.pending_cents), 0) as cents, count(p.installment_id) as n
    from (values (1, 'overdue', 'Vencidas'), (2, 'd0_7', 'Hoje a 7 dias'), (3, 'd8_30', '8 a 30 dias'), (4, 'd31_60', '31 a 60 dias'), (5, 'd61p', 'Mais de 60 dias')) o(ord, k, label)
    left join private.fin_pending(p_org, p_account, cats, p_cost_center, p_counterparty) p on p.entry_type = 'receivable' and o.k = case
        when p.due_date < today then 'overdue' when p.due_date <= today + 7 then 'd0_7' when p.due_date <= today + 30 then 'd8_30' when p.due_date <= today + 60 then 'd31_60' else 'd61p' end
    group by o.ord, o.k, o.label) b;

  select coalesce(jsonb_agg(jsonb_build_object('month', mth, 'planned_income_cents', pi, 'actual_income_cents', ai, 'planned_expense_cents', pe, 'actual_expense_cents', ae) order by mth), '[]'::jsonb) into pva from (
    select gs::date as mth,
      coalesce((select sum(q.amount_cents) from private.fin_planned(p_org, greatest(gs::date, p_from), least((gs + interval '1 month - 1 day')::date, p_to), p_account, cats, p_cost_center, p_counterparty) q where q.entry_type = 'receivable'), 0) as pi,
      coalesce((select sum(r.amount_cents) from private.fin_realized(p_org, greatest(gs::date, p_from), least((gs + interval '1 month - 1 day')::date, p_to), p_account, cats, p_cost_center, p_counterparty) r where r.entry_type = 'receivable'), 0) as ai,
      coalesce((select sum(q.amount_cents) from private.fin_planned(p_org, greatest(gs::date, p_from), least((gs + interval '1 month - 1 day')::date, p_to), p_account, cats, p_cost_center, p_counterparty) q where q.entry_type = 'payable'), 0) as pe,
      coalesce((select -sum(r.amount_cents) from private.fin_realized(p_org, greatest(gs::date, p_from), least((gs + interval '1 month - 1 day')::date, p_to), p_account, cats, p_cost_center, p_counterparty) r where r.entry_type = 'payable'), 0) as ae
    from generate_series(date_trunc('month', p_from)::timestamp, p_to::timestamp, interval '1 month') gs) t;

  return jsonb_build_object('monthly', monthly, 'balance', bal, 'expense_by_category', exp_cat, 'income_by_category', inc_cat, 'cost_centers', cc,
    'payables_aging', pay_age, 'receivables_aging', rec_age, 'planned_vs_actual', pva);
end $$;

-- ======================================================================= relatórios
-- Por categoria: caixa (baixas no período, líquidas de estorno) ou competência (títulos com competência no período).
create function public.fin_report_by_category(p_org uuid, p_from date, p_to date, p_nature public.fin_nature, p_regime text default 'cash', p_account uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare res jsonb; et public.fin_entry_type := case p_nature when 'income' then 'receivable' else 'payable' end;
begin
  perform private.fin_guard(p_org, 'read');
  if p_regime not in ('cash', 'accrual') then raise exception 'regime inválido' using errcode = '22023'; end if;
  if p_from is null or p_to is null or p_to < p_from then raise exception 'período inválido' using errcode = '22023'; end if;
  if p_regime = 'cash' then
    select coalesce(jsonb_agg(jsonb_build_object('category_id', t.cid, 'name', coalesce(c.name, 'Sem categoria'), 'parent_name', pn.name, 'cents', t.cents, 'count', t.n) order by t.cents desc, c.name), '[]'::jsonb) into res from (
      select r.category_id as cid, abs(sum(r.amount_cents)) as cents, count(*) filter (where r.movement_type = 'settlement') as n
      from private.fin_realized(p_org, p_from, p_to, p_account, null, null, null) r where r.entry_type = et group by r.category_id having sum(r.amount_cents) <> 0) t
      left join public.financial_categories c on c.id = t.cid left join public.financial_categories pn on pn.id = c.parent_id;
  else
    select coalesce(jsonb_agg(jsonb_build_object('category_id', t.cid, 'name', coalesce(c.name, 'Sem categoria'), 'parent_name', pn.name, 'cents', t.cents, 'count', t.n) order by t.cents desc, c.name), '[]'::jsonb) into res from (
      select e.category_id as cid, sum(e.amount_cents) as cents, count(*) as n from public.financial_entries e
      where e.organization_id = p_org and e.entry_type = et and e.cancelled_at is null and e.competence_date between p_from and p_to and (p_account is null or e.expected_account_id = p_account) group by e.category_id) t
      left join public.financial_categories c on c.id = t.cid left join public.financial_categories pn on pn.id = c.parent_id;
  end if;
  return res;
end $$;

-- Por cliente ou fornecedor: liquidado no período + pendente atual + vencido.
create function public.fin_report_by_counterparty(p_org uuid, p_from date, p_to date, p_kind public.fin_counterparty_kind, p_today date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare res jsonb; today date; et public.fin_entry_type := case p_kind when 'supplier' then 'payable' else 'receivable' end;
begin
  perform private.fin_guard(p_org, 'read');
  if p_kind = 'both' then raise exception 'informe cliente ou fornecedor' using errcode = '22023'; end if;
  today := coalesce(p_today, private.fin_today(p_org));
  select coalesce(jsonb_agg(jsonb_build_object('counterparty_id', t.cid, 'name', coalesce(c.name, 'Sem contraparte'), 'settled_cents', t.settled, 'pending_cents', t.pending, 'overdue_cents', t.overdue, 'settlements', t.n)
    order by (t.settled + t.pending) desc, c.name), '[]'::jsonb) into res from (
    select x.cid, coalesce(sum(x.settled), 0) as settled, coalesce(sum(x.pending), 0) as pending, coalesce(sum(x.overdue), 0) as overdue, coalesce(sum(x.n), 0) as n from (
      select r.counterparty_id as cid, abs(sum(r.amount_cents)) as settled, 0::bigint as pending, 0::bigint as overdue, count(*) filter (where r.movement_type = 'settlement' and r.settlement_active) as n
        from private.fin_realized(p_org, p_from, p_to, null, null, null, null) r where r.entry_type = et group by r.counterparty_id
      union all
      select p.counterparty_id, 0, sum(p.pending_cents), coalesce(sum(p.pending_cents) filter (where p.due_date < today), 0), 0
        from private.fin_pending(p_org, null, null, null, null) p where p.entry_type = et group by p.counterparty_id) x group by x.cid) t
    left join public.counterparties c on c.id = t.cid;
  return res;
end $$;

-- Por centro de custo (caixa, ponderado pelo rateio) + linha «Sem centro de custo» para o que não foi ratado.
create function public.fin_report_cost_centers(p_org uuid, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare res jsonb; inc_all bigint; exp_all bigint; inc_cc bigint := 0; exp_cc bigint := 0;
begin
  perform private.fin_guard(p_org, 'read');
  if p_from is null or p_to is null or p_to < p_from then raise exception 'período inválido' using errcode = '22023'; end if;
  select coalesce(sum(r.amount_cents) filter (where r.entry_type = 'receivable'), 0), coalesce(-sum(r.amount_cents) filter (where r.entry_type = 'payable'), 0) into inc_all, exp_all
    from private.fin_realized(p_org, p_from, p_to, null, null, null, null) r;
  select coalesce(sum(x.inc), 0), coalesce(sum(x.ex), 0) into inc_cc, exp_cc from (
    select coalesce((select sum(r.amount_cents) from private.fin_realized(p_org, p_from, p_to, null, null, c.id, null) r where r.entry_type = 'receivable'), 0) as inc,
           coalesce((select -sum(r.amount_cents) from private.fin_realized(p_org, p_from, p_to, null, null, c.id, null) r where r.entry_type = 'payable'), 0) as ex
    from public.cost_centers c where c.organization_id = p_org) x;
  select coalesce(jsonb_agg(row_ order by ord, nm), '[]'::jsonb) into res from (
    select 0 as ord, c.name as nm, jsonb_build_object('cost_center_id', c.id, 'code', c.code, 'name', c.name, 'income_cents', x.inc, 'expense_cents', x.ex, 'net_cents', x.inc - x.ex) as row_
    from public.cost_centers c cross join lateral (select
        coalesce((select sum(r.amount_cents) from private.fin_realized(p_org, p_from, p_to, null, null, c.id, null) r where r.entry_type = 'receivable'), 0) as inc,
        coalesce((select -sum(r.amount_cents) from private.fin_realized(p_org, p_from, p_to, null, null, c.id, null) r where r.entry_type = 'payable'), 0) as ex) x
    where c.organization_id = p_org and (x.inc <> 0 or x.ex <> 0)
    union all
    select 1, 'zzz', jsonb_build_object('cost_center_id', null, 'code', null, 'name', 'Sem centro de custo', 'income_cents', inc_all - inc_cc, 'expense_cents', exp_all - exp_cc, 'net_cents', (inc_all - inc_cc) - (exp_all - exp_cc))
    where inc_all - inc_cc <> 0 or exp_all - exp_cc <> 0) q;
  return res;
end $$;

-- Mensal: caixa e competência lado a lado («Resumo Gerencial de Receitas e Despesas» — não é DRE contábil).
create function public.fin_report_monthly(p_org uuid, p_from date, p_to date, p_account uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare res jsonb;
begin
  perform private.fin_guard(p_org, 'read');
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 3660 then raise exception 'período inválido' using errcode = '22023'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('month', mth, 'cash_income_cents', ci, 'cash_expense_cents', ce, 'cash_net_cents', ci - ce,
      'accrual_income_cents', ai, 'accrual_expense_cents', ae, 'accrual_net_cents', ai - ae) order by mth), '[]'::jsonb) into res from (
    select gs::date as mth,
      coalesce((select sum(r.amount_cents) from private.fin_realized(p_org, greatest(gs::date, p_from), least((gs + interval '1 month - 1 day')::date, p_to), p_account, null, null, null) r where r.entry_type = 'receivable'), 0) as ci,
      coalesce((select -sum(r.amount_cents) from private.fin_realized(p_org, greatest(gs::date, p_from), least((gs + interval '1 month - 1 day')::date, p_to), p_account, null, null, null) r where r.entry_type = 'payable'), 0) as ce,
      coalesce((select sum(e.amount_cents) from public.financial_entries e where e.organization_id = p_org and e.entry_type = 'receivable' and e.cancelled_at is null
                and e.competence_date between greatest(gs::date, p_from) and least((gs + interval '1 month - 1 day')::date, p_to) and (p_account is null or e.expected_account_id = p_account)), 0) as ai,
      coalesce((select sum(e.amount_cents) from public.financial_entries e where e.organization_id = p_org and e.entry_type = 'payable' and e.cancelled_at is null
                and e.competence_date between greatest(gs::date, p_from) and least((gs + interval '1 month - 1 day')::date, p_to) and (p_account is null or e.expected_account_id = p_account)), 0) as ae
    from generate_series(date_trunc('month', p_from)::timestamp, p_to::timestamp, interval '1 month') gs) t;
  return res;
end $$;

-- Alerta de saldo projetado negativo nas notificações (30 dias, cenário base).
create or replace function private.fin_generate_notifications(p_org uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare today date := private.fin_today(p_org); alert integer; n integer; made integer := 0; roles public.org_role[] := array['owner', 'admin', 'manager', 'member']; minbal bigint;
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
  select min(balance_cents) into minbal from private.fin_projection(p_org, today, 30, 'day', 'base', null);
  if minbal < 0 then made := made + private.fin_notify(p_org, 'projected_negative', 'Saldo projetado negativo', 'O saldo projetado fica negativo nos próximos 30 dias. Veja o fluxo de caixa projetado.', '/fluxo-caixa?aba=projetado', 'projneg:' || today::text, array['owner', 'admin', 'manager']::public.org_role[]); end if;
  return made;
end $$;
revoke all on function private.fin_generate_notifications(uuid) from public;

do $$
declare f text;
begin
  foreach f in array array[
    'public.fin_cashflow_projection(uuid, integer, text, text, uuid, date)', 'public.fin_cashflow_opening(uuid, date, uuid)', 'public.fin_cashflow_realized(uuid, date, date, text, uuid)',
    'public.fin_dashboard_kpis(uuid, date, date, uuid, uuid, uuid, uuid, date)', 'public.fin_dashboard_series(uuid, date, date, uuid, uuid, uuid, uuid, date)',
    'public.fin_report_by_category(uuid, date, date, public.fin_nature, text, uuid)', 'public.fin_report_by_counterparty(uuid, date, date, public.fin_counterparty_kind, date)',
    'public.fin_report_cost_centers(uuid, date, date)', 'public.fin_report_monthly(uuid, date, date, uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

commit;
