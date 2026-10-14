-- Regras monetárias puras: distribuição exata de centavos (parcelas e rateios), datas de parcelas e formatação de mensagens.
-- Valores esperados calculados À MÃO (método do maior resto; empate vai ao menor índice).

begin;

do $$
begin
  -- R$ 1.000,00 em 3 parcelas: 333,34 + 333,33 + 333,33 (soma exata)
  assert private.fin_distribute(100000, array[1, 1, 1]::bigint[]) = array[33334, 33333, 33333]::bigint[], '1000 em 3';
  assert private.fin_distribute(1, array[1, 1, 1]::bigint[]) = array[1, 0, 0]::bigint[], '1 centavo em 3';
  assert private.fin_distribute(0, array[1, 2]::bigint[]) = array[0, 0]::bigint[], 'zero';
  assert private.fin_distribute(10, array[1, 1, 1, 1]::bigint[]) = array[3, 3, 2, 2]::bigint[], '10 em 4';
  assert private.fin_distribute(10001, array[60, 40]::bigint[]) = array[6001, 4000]::bigint[], 'rateio 60/40 com resto';
  assert private.fin_distribute(100, array[1, 2, 3]::bigint[]) = array[17, 33, 50]::bigint[], 'pesos 1:2:3';
  assert private.fin_distribute(7, array[5]::bigint[]) = array[7]::bigint[], 'um só destinatário recebe tudo';
  -- valores elevados (R$ 999.999.999.999,99 é o teto)
  assert private.fin_distribute(99999999999999, array[1, 1, 1]::bigint[]) = array[33333333333333, 33333333333333, 33333333333333]::bigint[], 'teto em 3';
  assert private.fin_distribute(99999999999998, array[1, 1, 1]::bigint[]) = array[33333333333333, 33333333333333, 33333333333332]::bigint[], 'teto-1 em 3';
  assert (private.fin_distribute(99999999999999, array[1000000000, 999999999, 1]::bigint[]))[1] > 0, 'pesos grandes não estouram';
  -- recusas
  assert test.throws($q$select private.fin_distribute(10, array[1, 0]::bigint[])$q$), 'peso zero recusado';
  assert test.throws($q$select private.fin_distribute(10, array[1, -1]::bigint[])$q$), 'peso negativo recusado';
  assert test.throws($q$select private.fin_distribute(10, '{}'::bigint[])$q$), 'sem destinatários recusado';
  assert test.throws($q$select private.fin_distribute(-1, array[1]::bigint[])$q$), 'total negativo recusado';
  raise notice 'PASS: distribuição de centavos (casos à mão, teto e recusas)';
end $$;

-- Propriedade: a soma é SEMPRE o total; com pesos iguais a diferença entre partes é de no máximo 1 centavo.
do $$
declare bad integer;
begin
  select count(*) into bad from (
    select t, n, private.fin_distribute(t, array_fill(1::bigint, array[n])) as d
    from generate_series(0, 250) t cross join generate_series(1, 12) n
  ) x where (select sum(v) from unnest(d) v) <> t or (select max(v) - min(v) from unnest(d) v) > 1;
  assert bad = 0, 'soma exata e partes equilibradas em 3.000 combinações';
  -- pesos variados: soma exata e nenhuma parte negativa
  select count(*) into bad from (
    select t, private.fin_distribute(t, array[(t % 7) + 1, (t % 11) + 1, (t % 13) + 1, 1]::bigint[]) as d
    from generate_series(0, 20000, 7) t
  ) x where (select sum(v) from unnest(d) v) <> t or (select min(v) from unnest(d) v) < 0;
  assert bad = 0, 'soma exata com pesos variados';
  raise notice 'PASS: propriedades da distribuição (soma exata em milhares de combinações)';
end $$;

do $$
begin
  assert private.fin_due_dates(date '2024-01-31', 4, 'monthly', null) = array[date '2024-01-31', '2024-02-29', '2024-03-31', '2024-04-30'], 'fim de mês, ano bissexto';
  assert private.fin_due_dates(date '2023-01-31', 3, 'monthly', null) = array[date '2023-01-31', '2023-02-28', '2023-03-31'], 'fim de mês, ano comum';
  assert private.fin_due_dates(date '2024-11-15', 4, 'monthly', null) = array[date '2024-11-15', '2024-12-15', '2025-01-15', '2025-02-15'], 'virada de ano';
  assert private.fin_due_dates(date '2024-11-30', 3, 'quarterly', null) = array[date '2024-11-30', '2025-02-28', '2025-05-30'], 'trimestral';
  assert private.fin_due_dates(date '2024-02-29', 3, 'annual', null) = array[date '2024-02-29', '2025-02-28', '2026-02-28'], 'anual a partir de 29/fev';
  assert private.fin_due_dates(date '2024-12-30', 3, 'weekly', null) = array[date '2024-12-30', '2025-01-06', '2025-01-13'], 'semanal na virada de ano';
  assert private.fin_due_dates(date '2024-05-10', 1, 'monthly', null) = array[date '2024-05-10'], 'parcela única';
  assert private.fin_due_dates(null, 2, 'x', array[date '2024-01-01', '2024-03-01']) = array[date '2024-01-01', '2024-03-01'], 'datas combinadas';
  assert test.throws($q$select private.fin_due_dates(date '2024-01-01', 2, 'daily', null)$q$), 'frequência inválida';
  assert test.throws($q$select private.fin_due_dates(null, 3, 'x', array[date '2024-01-01'])$q$), 'quantidade de datas diferente';
  assert test.throws($q$select private.fin_due_dates(null, 2, 'x', array[date '2024-03-01', date '2024-01-01'])$q$), 'datas fora de ordem';
  raise notice 'PASS: datas de parcelas (fim de mês, bissexto, virada de ano, trimestral, anual, semanal)';
end $$;

do $$
begin
  assert private.fin_brl(123456) = 'R$ 1234,56', 'formato';
  assert private.fin_brl(5) = 'R$ 0,05', 'centavos com zero à esquerda';
  assert private.fin_brl(-100) = '-R$ 1,00', 'negativo';
  assert private.fin_brl(0) = 'R$ 0,00', 'zero';
  raise notice 'PASS: formatação de valores em mensagens';
end $$;

rollback;
select 'PASS 60_fin_money' as result;
