-- Motor financeiro: título → baixa → movimento. Valores esperados calculados à mão (em centavos).
-- Cenários: baixa parcial/total, idempotência, excesso, estorno, parcelamento, transferência atômica, ajuste, rateio, replanejamento,
-- cancelamento, arquivamento, saldo inicial e imutabilidade do histórico (testada até como dono do schema).

\set as_oa 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a0","aal":"aal2","email":"oa@t.invalid"}'', true); set local role authenticated;'

begin;

-- auxiliares de asserção (security invoker: respeitam a RLS de quem chama)
create function test.today() returns date language sql as $$ select (now() at time zone 'America/Sao_Paulo')::date $$;
create function test.errmsg(q text) returns text language plpgsql as $$ begin execute q; return null; exception when others then return sqlerrm; end $$;
create function test.bal(a uuid) returns bigint language sql as $$ select balance_cents from public.fin_account_balances where account_id = a $$;
create function test.pend(i uuid) returns bigint language sql as $$ select pending_cents from public.fin_installments_view where installment_id = i $$;
create function test.st(i uuid) returns text language sql as $$ select status from public.fin_installments_view where installment_id = i $$;
create function test.t(k text) returns uuid language sql as $$ select current_setting('t.' || k)::uuid $$;
grant execute on all functions in schema test to anon, authenticated;

insert into auth.users (id, email) values ('ffffffff-0000-4000-8000-0000000000a0', 'oa@t.invalid');

:as_oa
do $$
declare org uuid; banco uuid; caixa uuid; poup uuid; cust uuid; sup uuid;
begin
  org := public.create_organization('Empresa Teste', 'empresa-teste');
  perform set_config('t.org', org::text, true);
  banco := public.fin_create_account(org, 'Banco', 'checking', 'Banco Fictício', 1000000, test.today() - 60);
  caixa := public.fin_create_account(org, 'Caixa', 'cash', null, 0, test.today() - 60, true, false);
  poup  := public.fin_create_account(org, 'Poupança', 'savings', null, 0, test.today() - 60, true, true);
  insert into public.counterparties (organization_id, kind, name) values (org, 'customer', 'Cliente Alfa') returning id into cust;
  insert into public.counterparties (organization_id, kind, name) values (org, 'supplier', 'Fornecedor Beta') returning id into sup;
  perform set_config('t.banco', banco::text, true); perform set_config('t.caixa', caixa::text, true); perform set_config('t.poup', poup::text, true);
  perform set_config('t.cust', cust::text, true); perform set_config('t.sup', sup::text, true);
  perform set_config('t.cat_in', (select id::text from public.financial_categories where organization_id = org and name = 'Serviços'), true);
  perform set_config('t.cat_out', (select id::text from public.financial_categories where organization_id = org and name = 'Fornecedores'), true);
  assert test.bal(banco) = 1000000 and test.bal(caixa) = 0, 'saldos iniciais';
end $$;
reset role;

-- ===================================================================== 1. a receber R$ 5.000,00: previsto não é dinheiro
:as_oa
do $$
declare org uuid := test.t('org'); e uuid; i uuid; s1 uuid; s2 uuid; s3 uuid; n integer;
begin
  e := public.fin_create_entry(org, 'receivable', 'Projeto Alfa', test.t('cust'), test.t('cat_in'), test.t('banco'), 500000, test.today() - 2, test.today() - 2, test.today() + 30, 1);
  select id into i from public.financial_installments where entry_id = e;
  perform set_config('t.e1', e::text, true); perform set_config('t.i1', i::text, true);
  assert test.bal(test.t('banco')) = 1000000, 'título previsto não muda o saldo';
  assert test.pend(i) = 500000 and test.st(i) = 'open', 'pendente 5.000,00, aberta';
  assert (select is_overdue from public.fin_installments_view where installment_id = i) = false, 'a vencer não é atrasada';
  assert (select count(*) from public.account_movements where organization_id = org) = 0, 'nenhum movimento efetivo ainda';

  -- recebe R$ 2.000,00 (parcial)
  s1 := public.fin_settle_installment(i, test.t('banco'), 200000, now(), 'pix', 'E2E-0001', 'settle-e1-0001');
  assert test.bal(test.t('banco')) = 1200000, 'entrada de 2.000,00 no saldo';
  assert test.pend(i) = 300000 and test.st(i) = 'partial', 'pendente 3.000,00, parcialmente recebida';
  -- repetição da MESMA requisição não duplica
  assert public.fin_settle_installment(i, test.t('banco'), 200000, now(), 'pix', 'E2E-0001', 'settle-e1-0001') = s1, 'repetição devolve a mesma baixa';
  assert (select count(*) from public.settlements where installment_id = i) = 1 and test.bal(test.t('banco')) = 1200000, 'sem baixa nem movimento duplicados';
  assert test.errmsg(format($q$select public.fin_settle_installment(%L, %L, 199999, now(), 'pix', null, 'settle-e1-0001')$q$, i, test.t('banco'))) like '%idempotência%', 'mesma chave com outro valor recusada';
  -- excesso
  assert test.errmsg(format($q$select public.fin_settle_installment(%L, %L, 300001, now(), 'pix', null, 'settle-e1-0002')$q$, i, test.t('banco'))) like '%excede o pendente%', 'baixa acima do pendente recusada';
  assert test.pend(i) = 300000, 'recusa não altera nada';
  -- recebe o restante
  s2 := public.fin_settle_installment(i, test.t('banco'), 300000, now(), 'transfer', null, 'settle-e1-0003');
  assert test.bal(test.t('banco')) = 1500000 and test.pend(i) = 0 and test.st(i) = 'paid', 'quitada: saldo 15.000,00';
  assert test.errmsg(format($q$select public.fin_settle_installment(%L, %L, 1, now(), 'pix', null, 'settle-e1-0004')$q$, i, test.t('banco'))) like '%excede%', 'nada a receber depois de quitada';
  -- valores inválidos
  assert test.errmsg(format($q$select public.fin_settle_installment(%L, %L, 0, now(), 'pix', null, 'settle-e1-0005')$q$, i, test.t('banco'))) like '%positivo%', 'valor zero recusado';
  assert test.errmsg(format($q$select public.fin_settle_installment(%L, %L, -5, now(), 'pix', null, 'settle-e1-0006')$q$, i, test.t('banco'))) like '%positivo%', 'valor negativo recusado';
  assert test.errmsg(format($q$select public.fin_settle_installment(%L, %L, 1, now(), 'pix', null, 'curta')$q$, i, test.t('banco'))) like '%idempotência%', 'chave curta recusada';

  -- estorno da última baixa
  assert test.errmsg(format($q$select public.fin_reverse_settlement(%L, 'x')$q$, s2)) like '%motivo%', 'estorno exige motivo';
  perform public.fin_reverse_settlement(s2, 'recebimento lançado por engano');
  assert test.bal(test.t('banco')) = 1200000 and test.pend(i) = 300000 and test.st(i) = 'partial', 'estorno devolve o pendente e o saldo';
  assert test.errmsg(format($q$select public.fin_reverse_settlement(%L, 'estorno repetido')$q$, s2)) like '%já estornada%', 'estorno repetido recusado';
  assert test.bal(test.t('banco')) = 1200000, 'estorno repetido não mexe no saldo';
  -- vínculo do movimento compensatório
  select count(*) into n from public.account_movements r join public.account_movements o on o.id = r.reverses_movement_id
    where r.settlement_id = s2 and r.movement_type = 'settlement_reversal' and o.movement_type = 'settlement' and r.amount_cents = -o.amount_cents;
  assert n = 1, 'estorno é movimento compensatório ligado ao original';
  assert (select count(*) from public.account_movements where settlement_id = s2) = 2, 'original e estorno preservados no livro';
  -- depois do estorno pode baixar de novo
  s3 := public.fin_settle_installment(i, test.t('banco'), 300000, now(), 'pix', null, 'settle-e1-0007');
  assert test.bal(test.t('banco')) = 1500000 and test.st(i) = 'paid', 'nova baixa após estorno';
  perform set_config('t.s1', s1::text, true); perform set_config('t.s3', s3::text, true);
  raise notice 'PASS: receber 5.000,00 — previsto ≠ efetivo, baixa parcial/total, idempotência, excesso, estorno e nova baixa';
end $$;
reset role;

-- ===================================================================== 2. a pagar R$ 1.000,00 em 3 parcelas (atrasada), conta sem saldo negativo
:as_oa
do $$
declare org uuid := test.t('org'); e uuid; i1 uuid; i2 uuid; i3 uuid; p1 uuid; sum_ bigint;
begin
  e := public.fin_create_entry(org, 'payable', 'Compra de insumos', test.t('sup'), test.t('cat_out'), null, 100000, test.today() - 20, test.today() - 20, test.today() - 5, 3, 'monthly');
  select id into i1 from public.financial_installments where entry_id = e and installment_number = 1;
  select id into i2 from public.financial_installments where entry_id = e and installment_number = 2;
  select id into i3 from public.financial_installments where entry_id = e and installment_number = 3;
  perform set_config('t.e2', e::text, true); perform set_config('t.i2a', i1::text, true); perform set_config('t.i2b', i2::text, true); perform set_config('t.i2c', i3::text, true);
  select sum(amount_cents) into sum_ from public.financial_installments where entry_id = e;
  assert sum_ = 100000, 'parcelas fecham exatamente R$ 1.000,00';
  assert (select array_agg(amount_cents order by installment_number) from public.financial_installments where entry_id = e) = array[33334, 33333, 33333]::bigint[], '333,34 + 333,33 + 333,33';
  assert (select array_agg(due_date order by installment_number) from public.financial_installments where entry_id = e) =
         array[test.today() - 5, (test.today() - 5 + interval '1 month')::date, (test.today() - 5 + interval '2 months')::date], 'vencimentos mensais';
  assert (select is_overdue from public.fin_installments_view where installment_id = i1) = true, '1ª parcela vencida e pendente = atrasada';
  assert (select is_overdue from public.fin_installments_view where installment_id = i2) = false, '2ª parcela a vencer';
  -- caixa sem saldo e sem permissão para negativo
  assert test.errmsg(format($q$select public.fin_settle_installment(%L, %L, 33334, now(), 'cash', null, 'settle-e2-0001')$q$, i1, test.t('caixa'))) like '%saldo insuficiente%', 'conta sem saldo negativo recusa saída';
  assert test.pend(i1) = 33334 and test.bal(test.t('caixa')) = 0, 'recusa não deixa rastro';
  p1 := public.fin_settle_installment(i1, test.t('banco'), 33334, now(), 'boleto', null, 'settle-e2-0002');
  assert test.bal(test.t('banco')) = 1500000 - 33334 and test.st(i1) = 'paid', 'pagamento é saída (sinal negativo)';
  assert (select amount_cents from public.account_movements where settlement_id = p1 and movement_type = 'settlement') = -33334, 'movimento de pagamento negativo';
  assert (select is_overdue from public.fin_installments_view where installment_id = i1) = false, 'quitada deixa de ser atrasada';
  -- poupança aceita negativo
  perform public.fin_settle_installment(i2, test.t('poup'), 33333, now(), 'pix', null, 'settle-e2-0003');
  assert test.bal(test.t('poup')) = -33333, 'conta que aceita negativo fica negativa';
  perform set_config('t.p2', (select id::text from public.settlements where idempotency_key = 'settle-e2-0003'), true);
  -- datas inválidas
  assert test.errmsg(format($q$select public.fin_settle_installment(%L, %L, 1, now() + interval '2 days', 'pix', null, 'settle-e2-0004')$q$, i3, test.t('banco'))) like '%futura%', 'baixa no futuro recusada';
  assert test.errmsg(format($q$select public.fin_settle_installment(%L, %L, 1, now() - interval '61 days', 'pix', null, 'settle-e2-0005')$q$, i3, test.t('banco'))) like '%anterior ao saldo inicial%', 'baixa antes do saldo inicial recusada';
  assert test.errmsg(format($q$select public.fin_settle_installment(%L, %L, 1, now(), 'dinheiro vivo', null, 'settle-e2-0006')$q$, i3, test.t('banco'))) like '%forma de pagamento%', 'forma de pagamento inválida';
  raise notice 'PASS: pagar 1.000,00 em 3 parcelas — soma exata, atraso derivado, sinal, conta sem negativo, datas inválidas';
end $$;
reset role;

-- ===================================================================== 3. validações de título e idempotência da criação
:as_oa
do $$
declare org uuid := test.t('org'); e uuid;
begin
  assert test.errmsg(format($q$select public.fin_create_entry(%L, 'payable', 'Zero', null, null, null, 0, test.today(), test.today(), test.today(), 1)$q$, org)) like '%positivo%', 'valor zero';
  assert test.errmsg(format($q$select public.fin_create_entry(%L, 'payable', 'Negativo', null, null, null, -100, test.today(), test.today(), test.today(), 1)$q$, org)) like '%positivo%', 'valor negativo';
  assert test.errmsg(format($q$select public.fin_create_entry(%L, 'payable', 'Acima do teto', null, null, null, 100000000000000, test.today(), test.today(), test.today(), 1)$q$, org)) like '%positivo%', 'acima do teto';
  assert test.errmsg(format($q$select public.fin_create_entry(%L, 'payable', 'Sem parcelas', null, null, null, 100, test.today(), test.today(), test.today(), 0)$q$, org)) like '%parcelas%', 'zero parcelas';
  assert test.errmsg(format($q$select public.fin_create_entry(%L, 'payable', 'Parcelas demais', null, null, null, 100, test.today(), test.today(), test.today(), 361)$q$, org)) like '%parcelas%', '361 parcelas';
  assert test.errmsg(format($q$select public.fin_create_entry(%L, 'payable', 'Vence antes', null, null, null, 100, test.today(), test.today(), test.today() - 1, 1)$q$, org)) like '%anterior à emissão%', 'vencimento antes da emissão';
  assert test.errmsg(format($q$select public.fin_create_entry(%L, 'payable', 'Categoria errada', null, %L, null, 100, test.today(), test.today(), test.today(), 1)$q$, org, test.t('cat_in'))) like '%natureza incompatível%', 'categoria de receita em despesa';
  assert test.errmsg(format($q$select public.fin_create_entry(%L, 'payable', 'Cliente em despesa', %L, null, null, 100, test.today(), test.today(), test.today(), 1)$q$, org, test.t('cust'))) like '%incompatível%', 'cliente em conta a pagar';
  assert test.errmsg(format($q$select public.fin_create_entry(%L, 'receivable', 'Fornecedor em receita', %L, null, null, 100, test.today(), test.today(), test.today(), 1)$q$, org, test.t('sup'))) like '%incompatível%', 'fornecedor em conta a receber';
  assert test.errmsg(format($q$select public.fin_create_entry(%L, 'payable', 'Parcelas fora de ordem', null, null, null, 100, test.today(), test.today(), test.today(), 2, 'monthly', null, null, null, array[test.today() + 10, test.today()]::date[])$q$, org)) like '%ordem%', 'datas fora de ordem';
  -- idempotência de criação
  e := public.fin_create_entry(org, 'payable', 'Licença anual', null, null, null, 120000, test.today(), test.today(), test.today() + 10, 1, 'monthly', null, 'create-key-0001');
  assert public.fin_create_entry(org, 'payable', 'Licença anual', null, null, null, 120000, test.today(), test.today(), test.today() + 10, 1, 'monthly', null, 'create-key-0001') = e, 'repetição devolve o mesmo título';
  assert (select count(*) from public.financial_entries where idempotency_key = 'create-key-0001') = 1, 'título único';
  assert test.errmsg(format($q$select public.fin_create_entry(%L, 'payable', 'Licença anual', null, null, null, 120001, test.today(), test.today(), test.today() + 10, 1, 'monthly', null, 'create-key-0001')$q$, org)) like '%idempotência%', 'chave com outros dados';
  -- categoria desativada e contraparte arquivada
  update public.financial_categories set active = false where id = test.t('cat_out');
  assert test.errmsg(format($q$select public.fin_create_entry(%L, 'payable', 'Categoria inativa', null, %L, null, 100, test.today(), test.today(), test.today(), 1)$q$, org, test.t('cat_out'))) like '%desativada%', 'categoria desativada';
  update public.financial_categories set active = true where id = test.t('cat_out');
  update public.counterparties set archived_at = now() where id = test.t('sup');
  assert test.errmsg(format($q$select public.fin_create_entry(%L, 'payable', 'Fornecedor arquivado', %L, null, null, 100, test.today(), test.today(), test.today(), 1)$q$, org, test.t('sup'))) like '%arquivado%', 'contraparte arquivada';
  update public.counterparties set archived_at = null where id = test.t('sup');
  -- edição de metadados
  perform public.fin_update_entry(e, 'Licença anual (renovada)', test.t('sup'), test.t('cat_out'), null, test.today(), 'obs');
  assert (select description from public.financial_entries where id = e) = 'Licença anual (renovada)', 'edição de descrição';
  raise notice 'PASS: validações de título (valor, parcelas, datas, categoria, contraparte) e idempotência da criação';
end $$;
reset role;

-- ===================================================================== 4. transferências
:as_oa
do $$
declare org uuid := test.t('org'); t uuid; t2 uuid; tot0 bigint; i uuid; mo integer;
begin
  select sum(balance_cents) into tot0 from public.fin_account_balances where include_in_consolidated;
  t := public.fin_create_transfer(org, test.t('banco'), test.t('caixa'), 100000, now(), 'Reforço do caixa', 'transfer-0001');
  perform set_config('t.tr1', t::text, true);
  assert test.bal(test.t('banco')) = 1500000 - 33334 - 100000 and test.bal(test.t('caixa')) = 100000, 'saída em A, entrada em B';
  assert (select sum(balance_cents) from public.fin_account_balances where include_in_consolidated) = tot0, 'variação consolidada é zero';
  assert (select sum(amount_cents) from public.account_movements where transfer_id = t) = 0, 'pernas somam zero';
  assert (select count(*) from public.account_movements where transfer_id = t) = 2, 'duas pernas ligadas ao mesmo evento';
  assert public.fin_create_transfer(org, test.t('banco'), test.t('caixa'), 100000, now(), 'Reforço do caixa', 'transfer-0001') = t, 'repetição devolve a mesma transferência';
  assert (select count(*) from public.transfers where idempotency_key = 'transfer-0001') = 1 and test.bal(test.t('caixa')) = 100000, 'sem duplicidade';
  assert test.errmsg(format($q$select public.fin_create_transfer(%L, %L, %L, 100001, now(), null, 'transfer-0001')$q$, org, test.t('banco'), test.t('caixa'))) like '%idempotência%', 'mesma chave com outro valor';
  assert test.errmsg(format($q$select public.fin_create_transfer(%L, %L, %L, 100, now(), null, 'transfer-0002')$q$, org, test.t('banco'), test.t('banco'))) like '%diferentes%', 'origem = destino';
  assert test.errmsg(format($q$select public.fin_create_transfer(%L, %L, %L, 0, now(), null, 'transfer-0003')$q$, org, test.t('banco'), test.t('caixa'))) like '%positivo%', 'valor zero';
  assert test.errmsg(format($q$select public.fin_create_transfer(%L, %L, %L, 100, now() + interval '3 days', null, 'transfer-0004')$q$, org, test.t('banco'), test.t('caixa'))) like '%futura%', 'data futura';
  assert test.errmsg(format($q$select public.fin_create_transfer(%L, %L, %L, 100, now(), null, 'transfer-0005')$q$, org, test.t('banco'), gen_random_uuid())) like '%pertencer%', 'conta inexistente';
  -- caixa não aceita saldo negativo: sair mais do que tem
  assert test.errmsg(format($q$select public.fin_create_transfer(%L, %L, %L, 100001, now(), null, 'transfer-0006')$q$, org, test.t('caixa'), test.t('banco'))) like '%saldo insuficiente%', 'transferência acima do saldo do caixa';
  assert test.bal(test.t('caixa')) = 100000 and (select count(*) from public.transfers where idempotency_key = 'transfer-0006') = 0, 'falha atômica: nada gravado';
  -- estorno
  perform public.fin_reverse_transfer(t, 'transferência feita para a conta errada');
  assert test.bal(test.t('banco')) = 1500000 - 33334 and test.bal(test.t('caixa')) = 0, 'estorno devolve os saldos';
  assert (select status from public.transfers where id = t) = 'reversed', 'transferência marcada como estornada';
  assert test.errmsg(format($q$select public.fin_reverse_transfer(%L, 'estorno repetido da transferência')$q$, t)) like '%já estornada%', 'estorno repetido recusado';
  assert (select count(*) from public.account_movements where transfer_id = t) = 4, 'quatro movimentos preservados (2 originais + 2 compensações)';
  assert (select sum(amount_cents) from public.account_movements where transfer_id = t) = 0, 'tudo soma zero';
  -- estorno que não cabe: o dinheiro já foi gasto no destino
  t2 := public.fin_create_transfer(org, test.t('banco'), test.t('caixa'), 30000, now(), null, 'transfer-0007');
  select id into i from public.financial_installments where entry_id = test.t('e2') and installment_number = 3;
  perform public.fin_settle_installment(i, test.t('caixa'), 30000, now(), 'cash', null, 'settle-e2-0010');
  select count(*) into mo from public.account_movements;
  assert test.errmsg(format($q$select public.fin_reverse_transfer(%L, 'estorno sem saldo no destino')$q$, t2)) like '%saldo insuficiente%', 'estorno recusado por falta de saldo no destino';
  assert (select count(*) from public.account_movements) = mo and (select status from public.transfers where id = t2) = 'posted', 'estorno recusado é atômico (nada mudou)';
  raise notice 'PASS: transferências — pernas ligadas, soma zero, idempotência, falha atômica, estorno e estorno recusado sem deixar rastro';
end $$;
reset role;

-- ===================================================================== 5. ajustes de saldo
:as_oa
do $$
declare org uuid := test.t('org'); a uuid; before_ bigint := test.bal(test.t('banco'));
begin
  a := public.fin_create_adjustment(org, test.t('banco'), -1500, 'fee', 'tarifa mensal do banco', now(), 'adjust-0001');
  assert test.bal(test.t('banco')) = before_ - 1500, 'tarifa reduz o saldo';
  assert public.fin_create_adjustment(org, test.t('banco'), -1500, 'fee', 'tarifa mensal do banco', now(), 'adjust-0001') = a and test.bal(test.t('banco')) = before_ - 1500, 'idempotente';
  assert test.errmsg(format($q$select public.fin_create_adjustment(%L, %L, 0, 'manual', 'ajuste zerado', now(), 'adjust-0002')$q$, org, test.t('banco'))) like '%zero%', 'ajuste zero';
  assert test.errmsg(format($q$select public.fin_create_adjustment(%L, %L, 100, 'manual', 'abc', now(), 'adjust-0003')$q$, org, test.t('banco'))) like '%motivo%', 'ajuste exige motivo';
  assert (select count(*) from public.account_movements where adjustment_id = a and movement_type = 'adjustment') = 1, 'ajuste vira movimento do tipo adjustment';
  raise notice 'PASS: ajustes de saldo com motivo, idempotentes';
end $$;
reset role;

-- ===================================================================== 6. rateio por centro de custo, replanejamento, cancelamento
:as_oa
do $$
declare org uuid := test.t('org'); cc1 uuid; cc2 uuid; e uuid; e2 uuid; i uuid;
begin
  insert into public.cost_centers (organization_id, name, code) values (org, 'Comercial', 'COM') returning id into cc1;
  insert into public.cost_centers (organization_id, name, code) values (org, 'Operações', 'OPS') returning id into cc2;
  e := public.fin_create_entry(org, 'payable', 'Despesa rateada', null, null, null, 10001, test.today(), test.today(), test.today(), 1, 'monthly', null, null,
         jsonb_build_array(jsonb_build_object('cost_center_id', cc1, 'weight', 60), jsonb_build_object('cost_center_id', cc2, 'weight', 40)));
  assert (select amount_cents from public.financial_allocations where entry_id = e and cost_center_id = cc1) = 6001 and
         (select amount_cents from public.financial_allocations where entry_id = e and cost_center_id = cc2) = 4000, 'rateio 60/40 de 100,01 = 60,01 + 40,00';
  assert (select sum(amount_cents) from public.financial_allocations where entry_id = e) = 10001, 'rateio soma exata';
  assert test.errmsg(format($q$select public.fin_set_allocations(%L, '[{"cost_center_id":"%s","weight":1},{"cost_center_id":"%s","weight":0}]'::jsonb)$q$, e, cc1, cc2)) like '%rateio inválido%', 'peso zero';
  assert test.errmsg(format($q$select public.fin_set_allocations(%L, '[{"cost_center_id":"%s","weight":1},{"cost_center_id":"%s","weight":2}]'::jsonb)$q$, e, cc1, cc1)) like '%repetido%', 'centro repetido';
  assert test.errmsg(format($q$select public.fin_set_allocations(%L, '[{"cost_center_id":"%s","weight":1}]'::jsonb)$q$, e, gen_random_uuid())) like '%inexistente%', 'centro inexistente';
  perform public.fin_set_allocations(e, jsonb_build_array(jsonb_build_object('cost_center_id', cc1, 'weight', 1), jsonb_build_object('cost_center_id', cc2, 'weight', 1)));
  assert (select array_agg(amount_cents order by cost_center_id = cc1 desc) from public.financial_allocations where entry_id = e) = array[5001, 5000]::bigint[], 'rateio 1:1 de 100,01 = 50,01 + 50,00';
  perform public.fin_set_allocations(e, null);
  assert (select count(*) from public.financial_allocations where entry_id = e) = 0, 'rateio removido';
  perform public.fin_set_allocations(e, jsonb_build_array(jsonb_build_object('cost_center_id', cc1, 'weight', 1), jsonb_build_object('cost_center_id', cc2, 'weight', 3)));
  perform set_config('t.e6', e::text, true);

  -- replanejar título SEM baixas: rateio acompanha o novo valor
  perform public.fin_replan_entry(e, 30000, 3, test.today() + 5, 'monthly');
  assert (select sum(amount_cents) from public.financial_installments where entry_id = e) = 30000 and (select count(*) from public.financial_installments where entry_id = e) = 3, 'replanejado em 3 parcelas de 100,00';
  assert (select sum(amount_cents) from public.financial_allocations where entry_id = e) = 30000, 'rateio reescalado para o novo valor';
  assert (select amount_cents from public.financial_allocations where entry_id = e and cost_center_id = cc2) = 22501 and (select amount_cents from public.financial_allocations where entry_id = e and cost_center_id = cc1) = 7499, 'rateio reescalado mantém a proporção (2500:7501 de 300,00 = 74,99 + 225,01)';
  -- com baixa (mesmo estornada) não replaneja
  select id into i from public.financial_installments where entry_id = e and installment_number = 1;
  perform public.fin_settle_installment(i, test.t('poup'), 10000, now(), 'pix', null, 'settle-e6-0001');
  assert test.errmsg(format($q$select public.fin_replan_entry(%L, 50000, 2, test.today(), 'monthly')$q$, e)) like '%já tem baixas%', 'replanejar com baixa recusado';
  perform public.fin_reverse_settlement((select id from public.settlements where idempotency_key = 'settle-e6-0001'), 'baixa lançada na parcela errada');
  assert test.errmsg(format($q$select public.fin_replan_entry(%L, 50000, 2, test.today(), 'monthly')$q$, e)) like '%já tem baixas%', 'histórico de baixas estornadas também protege o plano';
  -- reagendar
  assert test.errmsg(format($q$select public.fin_reschedule_installment(%L, test.today() - 400)$q$, i)) like '%anterior à emissão%', 'vencimento antes da emissão';
  perform public.fin_reschedule_installment(i, test.today() + 20);
  assert (select due_date from public.financial_installments where id = i) = test.today() + 20, 'parcela reagendada';
  -- cancelamento
  e2 := public.fin_create_entry(org, 'receivable', 'Venda cancelável', test.t('cust'), null, null, 7777, test.today(), test.today(), test.today() + 1, 1);
  select id into i from public.financial_installments where entry_id = e2;
  perform public.fin_settle_installment(i, test.t('banco'), 777, now(), 'pix', null, 'settle-e7-0001');
  assert test.errmsg(format($q$select public.fin_cancel_entry(%L, 'cancelar com baixa ativa')$q$, e2)) like '%baixas ativas%', 'não cancela com baixa ativa';
  perform public.fin_reverse_settlement((select id from public.settlements where idempotency_key = 'settle-e7-0001'), 'recebimento estornado');
  assert test.errmsg(format($q$select public.fin_cancel_entry(%L, 'no')$q$, e2)) like '%motivo%', 'cancelamento exige motivo';
  perform public.fin_cancel_entry(e2, 'venda desfeita pelo cliente');
  assert test.st(i) = 'cancelled' and test.pend(i) = 7777, 'status cancelado (pendente não conta nos totais por status)';
  assert test.errmsg(format($q$select public.fin_settle_installment(%L, %L, 1, now(), 'pix', null, 'settle-e7-0002')$q$, i, test.t('banco'))) like '%cancelado%', 'título cancelado não recebe baixa';
  assert test.errmsg(format($q$select public.fin_update_entry(%L, 'Edição pós-cancelamento', null, null, null, test.today(), null)$q$, e2)) like '%cancelado%', 'título cancelado não edita';
  assert test.errmsg(format($q$select public.fin_cancel_entry(%L, 'cancelamento repetido')$q$, e2)) like '%já cancelado%', 'cancelamento repetido';
  perform public.fin_archive_entry(e2);
  assert (select archived_at from public.financial_entries where id = e2) is not null, 'cancelado pode ser arquivado';
  assert test.errmsg(format($q$select public.fin_archive_entry(%L)$q$, test.t('e2'))) like '%quitado ou cancelado%', 'título em aberto não arquiva';
  raise notice 'PASS: rateio exato, replanejamento só sem baixas, reagendamento, cancelamento e arquivamento sob regras';
end $$;
reset role;

-- ===================================================================== 7. contas: arquivar e saldo inicial
:as_oa
do $$
declare org uuid := test.t('org'); novo uuid; e uuid; n integer;
begin
  assert test.errmsg(format($q$select public.fin_archive_account(%L)$q$, test.t('banco'))) like '%saldo%', 'conta com saldo não arquiva';
  novo := public.fin_create_account(org, 'Conta temporária', 'digital', null, 0, test.today() - 10);
  e := public.fin_create_entry(org, 'payable', 'Previsto na conta temporária', null, null, novo, 5000, test.today(), test.today(), test.today() + 3, 1);
  assert test.errmsg(format($q$select public.fin_archive_account(%L)$q$, novo)) like '%em aberto%', 'conta com título em aberto previsto não arquiva';
  perform public.fin_cancel_entry(e, 'título previsto por engano');
  perform public.fin_archive_account(novo);
  assert (select active from public.financial_accounts where id = novo) = false, 'conta zerada e sem pendências arquiva';
  assert test.errmsg(format($q$select public.fin_settle_installment(%L, %L, 1, now(), 'pix', null, 'settle-arq-0001')$q$, (select id from public.financial_installments where entry_id = test.t('e2') and installment_number = 3), novo)) like '%arquivada%', 'conta arquivada não recebe movimento';
  assert test.errmsg(format($q$select public.fin_create_entry(%L, 'payable', 'Em conta arquivada', null, null, %L, 100, test.today(), test.today(), test.today(), 1)$q$, org, novo)) like '%arquivada%', 'conta prevista arquivada recusada';
  perform public.fin_unarchive_account(novo);
  assert (select active from public.financial_accounts where id = novo), 'reativada';
  -- nome duplicado
  assert test.errmsg(format($q$select public.fin_create_account(%L, 'Banco', 'checking', null, 0, test.today())$q$, org)) like '%já existe%', 'nome duplicado';
  assert test.errmsg(format($q$select public.fin_create_account(%L, 'Futura', 'checking', null, 0, test.today() + 5)$q$, org)) like '%data do saldo inicial%', 'saldo inicial no futuro';
  -- saldo inicial: motivo, data e movimentos anteriores
  assert test.errmsg(format($q$select public.fin_set_opening_balance(%L, 1, test.today(), '')$q$, test.t('banco'))) like '%motivo%', 'correção exige motivo';
  perform public.fin_settle_installment((select id from public.financial_installments where entry_id = test.t('e2') and installment_number = 3), test.t('banco'), 100, now() - interval '30 days', 'pix', null, 'settle-hist-0001');
  assert test.errmsg(format($q$select public.fin_set_opening_balance(%L, 1, test.today() - 10, 'data posterior aos movimentos')$q$, test.t('banco'))) like '%movimentos anteriores%', 'não pula movimentos já lançados';
  select count(*) into n from public.account_opening_history where account_id = test.t('banco');
  perform public.fin_set_opening_balance(test.t('banco'), 1100000, test.today() - 60, 'conferência com o extrato de abertura');
  assert (select count(*) from public.account_opening_history where account_id = test.t('banco')) = n + 1, 'correção registrada no histórico';
  assert exists (select 1 from public.account_opening_history where account_id = test.t('banco') and old_cents = 1000000 and new_cents = 1100000), 'histórico guarda o valor anterior e o novo';
  -- conta com saldo negativo não pode proibir negativo
  assert test.errmsg(format($q$select public.fin_update_account(%L, 'Poupança', null, true, false)$q$, test.t('poup'))) like '%saldo negativo%', 'não proíbe negativo com saldo negativo';
  perform public.fin_update_account(test.t('caixa'), 'Caixa geral', 'Matriz', true, false);
  assert (select name from public.financial_accounts where id = test.t('caixa')) = 'Caixa geral', 'edição de conta';
  raise notice 'PASS: arquivamento de contas sob regras, nome único, correção de saldo inicial com histórico';
end $$;
reset role;

-- ===================================================================== 8. imutabilidade do histórico (testada como dono do schema/superusuário)
do $$
declare mv uuid := (select id from public.account_movements limit 1);
begin
  assert test.errmsg(format($q$update public.account_movements set amount_cents = amount_cents + 1 where id = %L$q$, mv)) like '%imutável%', 'livro não aceita UPDATE';
  assert test.errmsg(format($q$delete from public.account_movements where id = %L$q$, mv)) like '%imutável%', 'livro não aceita DELETE';
  assert test.errmsg($q$delete from public.settlements$q$) like '%não podem ser apagados%', 'baixa não é apagada';
  assert test.errmsg($q$delete from public.financial_entries$q$) like '%não podem ser apagados%', 'título não é apagado';
  assert test.errmsg($q$delete from public.financial_accounts$q$) like '%não podem ser apagados%', 'conta não é apagada';
  assert test.errmsg($q$delete from public.transfers$q$) like '%não podem ser apagados%', 'transferência não é apagada';
  assert test.errmsg($q$update public.balance_adjustments set amount_cents = 1$q$) like '%imutável%', 'ajuste imutável';
  assert test.errmsg($q$delete from public.account_opening_history$q$) like '%imutável%', 'histórico de saldo inicial imutável';
  assert test.errmsg($q$update public.settlements set amount_cents = amount_cents + 1 where reversed_at is null$q$) like '%imutável%', 'valor da baixa imutável';
  assert test.errmsg($q$update public.settlements set settled_at = now() where reversed_at is null$q$) like '%imutável%', 'data da baixa imutável';
  assert test.errmsg($q$update public.settlements set reversal_reason = 'trocado depois' where reversed_at is not null$q$) like '%definitiva%', 'estorno é definitivo';
  assert test.errmsg($q$update public.transfers set amount_cents = amount_cents + 1 where status = 'posted'$q$) like '%imutável%', 'valor da transferência imutável';
  assert test.errmsg($q$update public.financial_accounts set opening_balance_cents = opening_balance_cents + 1$q$) like '%saldo inicial%', 'saldo inicial só pela função própria';
  assert test.errmsg($q$update public.financial_installments set amount_cents = amount_cents + 1$q$) like '%só muda de vencimento%', 'valor da parcela imutável';
  assert test.errmsg($q$update public.financial_entries set amount_cents = amount_cents + 1 where id in (select entry_id from public.financial_installments i join public.settlements s on s.installment_id = i.id)$q$) like '%com baixas%', 'valor de título com baixas imutável';
  assert test.errmsg($q$update public.financial_entries set entry_type = 'receivable' where entry_type = 'payable'$q$) like '%imutáveis%', 'tipo do título imutável';
  raise notice 'PASS: histórico imutável até para o dono do schema (livro, baixas, transferências, ajustes, saldo inicial, valores)';
end $$;

-- invariantes de soma: adulterações são barradas no fim da transação
do $$
begin
  update public.financial_allocations set amount_cents = amount_cents + 1 where entry_id = test.t('e6') and cost_center_id = (select cost_center_id from public.financial_allocations where entry_id = test.t('e6') limit 1);
  set constraints all immediate;
  raise exception 'deveria ter falhado';
exception when check_violation then
  assert sqlerrm like '%rateio%', 'rateio adulterado quebra a soma: ' || sqlerrm;
  raise notice 'PASS: rateio adulterado (soma ≠ título) é barrado';
end $$;
do $$
declare r text;
begin
  delete from public.financial_installments where entry_id = test.t('e6') and installment_number = 2;
  set constraints all immediate;
  raise exception 'deveria ter falhado';
exception when check_violation then
  assert sqlerrm like '%parcelas não fecham%', 'remover parcela quebra a soma: ' || sqlerrm;
  raise notice 'PASS: remover parcela sem refazer o plano é barrado (parcelas ≠ título)';
end $$;

rollback;
select 'PASS 62_fin_engine' as result;
