#!/usr/bin/env node
// Gera supabase/seed.sql — dados de DEMONSTRAÇÃO fictícios e determinísticos da «Nova Horizonte Serviços Ltda.».
// Rode: node scripts/gen-seed.mjs
//
// Princípio: tudo que movimenta dinheiro nasce pelas MESMAS funções do sistema (fin_create_entry, fin_settle_installment, fin_create_transfer…),
// com a sessão do proprietário simulada por claims. Assim o livro, as parcelas, o rateio e a auditoria são consistentes por construção,
// e nenhum indicador do painel é digitado à mão. As datas são relativas ao dia em que o banco é criado («N dias atrás»).
// Só vale para ambiente local/demonstração: usuários @demo.exemplo com senha local. NUNCA use em produção.
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sq = (s) => (s === null || s === undefined ? 'null' : `'${String(s).replace(/'/g, "''")}'`);

let seed = 20270601;
const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = (l) => l[Math.floor(rnd() * l.length)];
const chance = (p) => rnd() < p;
const cents = (reais, c = 0) => reais * 100 + c;

export const ORG = 'f6f6f6f6-0000-4000-8000-000000000001';
const uid = (k) => `f6f6f6f6-0000-4000-8000-000000000${k}`;
const U = { owner: '0a1', manager: '0a2', analyst: '0a3', viewer: '0a4' };

const ACCOUNTS = [
  { k: 'itau', name: 'Itaú Empresas (fictício)', type: 'checking', inst: 'Banco fictício Itaú', opening: cents(82_000), ago: 180, include: true, neg: true },
  { k: 'nubank', name: 'Conta digital PJ', type: 'digital', inst: 'Fintech fictícia', opening: cents(14_500), ago: 180, include: true, neg: true },
  { k: 'caixa', name: 'Caixa da matriz', type: 'cash', inst: null, opening: cents(2_000), ago: 180, include: true, neg: false },
  { k: 'reserva', name: 'Reserva de emergência', type: 'savings', inst: 'Banco fictício Itaú', opening: cents(50_000), ago: 180, include: false, neg: false },
];
const CUSTOMERS = [
  ['Alfa Indústria de Embalagens Ltda', '11222333000181'], ['Beta Comércio de Peças Ltda', '45723174000110'], ['Gama Consultoria Empresarial', '11444777000161'],
  ['Delta Logística e Transportes', '33444555000122'], ['Épsilon Clínica Integrada', '55666777000133'], ['Zeta Educação Profissional', '77888999000144'],
];
const SUPPLIERS = [
  ['Imobiliária Central', '12345670000101'], ['NetFibra Telecom', '23456780000102'], ['Papelaria Pontual', '34567890000103'], ['Agência Pixel Marketing', '45678900000104'],
  ['CloudSoft Licenças', '56789010000105'], ['Contabilidade Exata', '67890120000106'], ['Transportes Rápido', '78901230000107'],
];
const CENTERS = [['ADM', 'Administrativo'], ['COM', 'Comercial'], ['MKT', 'Marketing'], ['OPS', 'Operações'], ['TEC', 'Tecnologia']];
const SUBCATS = [['Salários', 'Pessoal', 'expense'], ['Encargos e benefícios', 'Pessoal', 'expense'], ['Licenças de software', 'Tecnologia', 'expense'], ['Infraestrutura', 'Tecnologia', 'expense']];

const sql = [];
const add = (s) => sql.push(s);
let n = 0;
const key = (p) => `${p}${String(++n).padStart(3, '0')}`;
const jsonAlloc = (a) => (a ? `'${JSON.stringify(a)}'::jsonb` : 'null');
const entry = (o) => {
  const k = o.k ?? key('e');
  add(`select pg_temp.mk_entry(${sq(k)}, ${sq(o.type)}, ${sq(o.desc)}, ${sq(o.cp ?? null)}, ${sq(o.cat ?? null)}, ${sq(o.acct ?? null)}, ${o.amount}, ${o.issue}, ${o.comp ?? o.issue}, ${o.due}, ${o.n ?? 1}, ${sq(o.freq ?? 'monthly')}, ${jsonAlloc(o.alloc)});`);
  return k;
};
const pay = (k, o = {}) => add(`select pg_temp.pay(${sq(k)}, ${o.upto ?? 99}, ${sq(o.acct ?? 'itau')}, ${o.pct ?? 100}, ${o.lag ?? 0}, ${sq(o.method ?? 'pix')}, ${o.minAge ?? 0});`);

// ----------------------------------------------------------------------------- um mês de operação (m = meses atrás; 0 = mês corrente)
const SALES = [
  ['Projeto de implantação — fase', 'Serviços', 'Alfa Indústria de Embalagens Ltda'], ['Consultoria mensal de processos', 'Serviços', 'Gama Consultoria Empresarial'],
  ['Venda de lote de peças', 'Vendas', 'Beta Comércio de Peças Ltda'], ['Treinamento in company', 'Serviços', 'Zeta Educação Profissional'],
  ['Contrato de logística — adicional', 'Serviços', 'Delta Logística e Transportes'], ['Atendimento corporativo', 'Serviços', 'Épsilon Clínica Integrada'],
];
const ALLOC_SALES = [[{ cost_center: 'COM', weight: 60 }, { cost_center: 'OPS', weight: 40 }], [{ cost_center: 'COM', weight: 100 }], [{ cost_center: 'OPS', weight: 70 }, { cost_center: 'COM', weight: 30 }]];

for (const m of [5, 4, 3, 2, 1, 0]) {
  const base = m * 30;
  // receitas avulsas
  for (let i = 0; i < 4; i += 1) {
    const s = pick(SALES);
    const amount = cents(int(52, 170) * 100, pick([0, 0, 50, 90]));
    const issue = Math.max(base + int(8, 26), 0);
    const dueAgo = issue - int(10, 30);
    const parcelado = chance(0.22);
    const k = entry({ type: 'receivable', desc: `${s[0]} #${m}${i + 1}`, cp: s[2], cat: s[1], acct: 'itau', amount, issue, comp: issue, due: dueAgo, n: parcelado ? 3 : 1, alloc: pick(ALLOC_SALES) });
    if (dueAgo > -2 && chance(0.12) && m <= 1) continue; // fica em aberto (vencida ou quase) para o painel de atrasos
    if (chance(0.22)) { pay(k, { upto: 1, pct: 50, lag: int(0, 4), acct: pick(['itau', 'itau', 'itau', 'itau', 'nubank']) }); if (chance(0.55)) pay(k, { lag: int(8, 16), acct: 'itau', minAge: 3 }); }
    else pay(k, { lag: int(0, 6), acct: pick(['itau', 'itau', 'itau', 'itau', 'nubank']), method: pick(['pix', 'transfer', 'boleto']) });
  }
  // despesas mensais fixas lançadas à mão
  const folha = entry({ type: 'payable', desc: `Folha de pagamento ${m === 0 ? 'do mês' : `(${m} mês(es) atrás)`}`, cp: null, cat: 'Salários', acct: 'itau', amount: cents(18_450), issue: base + 12, comp: base + 5, due: base + 5, alloc: [{ cost_center: 'ADM', weight: 40 }, { cost_center: 'OPS', weight: 40 }, { cost_center: 'COM', weight: 20 }] });
  pay(folha, { lag: 0, acct: 'itau', method: 'transfer', minAge: 0 });
  const enc = entry({ type: 'payable', desc: `Encargos e benefícios (${m}m)`, cat: 'Encargos e benefícios', acct: 'itau', amount: cents(6_180, 40), issue: base + 10, comp: base + 5, due: base + 3, alloc: [{ cost_center: 'ADM', weight: 50 }, { cost_center: 'OPS', weight: 50 }] });
  pay(enc, { lag: 0, method: 'boleto' });
  const cont = entry({ type: 'payable', desc: `Honorários contábeis (${m}m)`, cp: 'Contabilidade Exata', cat: 'Administrativas', acct: 'itau', amount: cents(1_150), issue: base + 14, comp: base + 8, due: base + 8, alloc: [{ cost_center: 'ADM', weight: 1 }] });
  pay(cont, { lag: 0, method: 'boleto' });
  const mkt = entry({ type: 'payable', desc: `Campanha de marketing digital (${m}m)`, cp: 'Agência Pixel Marketing', cat: 'Marketing', acct: 'nubank', amount: cents(int(24, 46) * 100), issue: base + 20, comp: base + 12, due: base + 11, alloc: [{ cost_center: 'MKT', weight: 80 }, { cost_center: 'COM', weight: 20 }] });
  pay(mkt, { lag: int(0, 2), acct: 'nubank' });
  const forn = entry({ type: 'payable', desc: `Material e insumos (${m}m)`, cp: pick(['Papelaria Pontual', 'Transportes Rápido']), cat: pick(['Fornecedores', 'Logística']), acct: 'caixa', amount: cents(int(9, 28) * 100, 70), issue: base + 18, comp: base + 15, due: base + 14 - 3, n: chance(0.3) ? 2 : 1 });
  if (!(m === 0 && chance(0.5))) pay(forn, { lag: int(0, 3), acct: pick(['itau', 'nubank']), method: 'pix', minAge: 0 });
  // movimentações entre contas e ajustes (um por mês)
  add(`select pg_temp.xfer(${sq(key('t'))}, 'itau', 'caixa', ${cents(3_000)}, ${Math.max(base + 22, 0)}, 'Reforço do caixa da matriz');`);
  add(`select pg_temp.adj(${sq(key('a'))}, 'itau', ${-cents(89, 90)}, 'fee', 'Tarifa mensal de manutenção da conta', ${Math.max(base + 1, 0)});`);
  add(`select pg_temp.adj(${sq(key('a'))}, 'reserva', ${cents(312, 45)}, 'interest', 'Rendimento mensal da reserva', ${Math.max(base + 2, 0)});`);
}

// ----------------------------------------------------------------------------- casos especiais (determinísticos) para o painel
add(`select pg_temp.xfer(${sq(key('t'))}, 'itau', 'nubank', ${cents(20_000)}, 96, 'Capital de giro para a conta digital');`);
add(`select pg_temp.xfer(${sq(key('t'))}, 'itau', 'reserva', ${cents(10_000)}, 70, 'Aporte na reserva de emergência (fora do consolidado)');`);
const equip = entry({ k: 'equip', type: 'payable', desc: 'Compra de servidores — 6x', cp: 'CloudSoft Licenças', cat: 'Infraestrutura', acct: 'itau', amount: cents(72_000), issue: 100, comp: 100, due: 95, n: 6, alloc: [{ cost_center: 'TEC', weight: 1 }] });
pay(equip, { lag: 0, method: 'boleto', acct: 'nubank' });
const grande = entry({ k: 'grande', type: 'receivable', desc: 'Contrato anual de implantação — 3x', cp: 'Alfa Indústria de Embalagens Ltda', cat: 'Serviços', acct: 'itau', amount: cents(45_000), issue: 75, comp: 75, due: 60, n: 3, alloc: [{ cost_center: 'COM', weight: 50 }, { cost_center: 'OPS', weight: 50 }] });
pay(grande, { upto: 1, lag: 2 });
entry({ k: 'cancel', type: 'receivable', desc: 'Proposta aceita e depois cancelada pelo cliente', cp: 'Beta Comércio de Peças Ltda', cat: 'Vendas', acct: 'itau', amount: cents(8_900), issue: 40, comp: 40, due: 30 });
add(`select pg_temp.cancel('cancel', 'Cliente desistiu antes da entrega; sem cobrança.');`);
const erro = entry({ k: 'erro', type: 'payable', desc: 'Pagamento lançado em duplicidade (estornado)', cp: 'Papelaria Pontual', cat: 'Administrativas', acct: 'itau', amount: cents(2_340), issue: 33, comp: 33, due: 28 });
pay(erro, { lag: 0 });
add(`select pg_temp.reverse('erro', 1, 'Pagamento feito duas vezes por engano; valor devolvido pelo fornecedor.');`);
// vencidos e parciais (alertas)
entry({ type: 'payable', desc: 'Manutenção predial — vencida', cp: 'Transportes Rápido', cat: 'Administrativas', acct: 'itau', amount: cents(3_780), issue: 22, comp: 15, due: 9 });
entry({ type: 'receivable', desc: 'Serviço de consultoria — cliente atrasado', cp: 'Épsilon Clínica Integrada', cat: 'Serviços', acct: 'itau', amount: cents(12_600), issue: 30, comp: 25, due: 6 });
const parcial = entry({ k: 'parcial', type: 'payable', desc: 'Licenças anuais de software — parcial', cp: 'CloudSoft Licenças', cat: 'Licenças de software', acct: 'itau', amount: cents(21_000), issue: 12, comp: 12, due: 4, alloc: [{ cost_center: 'TEC', weight: 1 }] });
pay(parcial, { pct: 40, lag: 1 });
entry({ type: 'payable', desc: 'Seguro empresarial — vence em 3 dias', cp: 'Contabilidade Exata', cat: 'Administrativas', acct: 'itau', amount: cents(1_890), issue: 14, comp: 14, due: -3 });
entry({ type: 'receivable', desc: 'Mensalidade extra — vence na semana', cp: 'Zeta Educação Profissional', cat: 'Serviços', acct: 'itau', amount: cents(9_400), issue: 5, comp: 5, due: -6 });
entry({ type: 'receivable', desc: 'Projeto de expansão — marco futuro', cp: 'Delta Logística e Transportes', cat: 'Serviços', acct: 'itau', amount: cents(38_000), issue: 3, comp: -20, due: -25, n: 2, alloc: [{ cost_center: 'OPS', weight: 1 }] });
entry({ type: 'payable', desc: 'Impostos e taxas do trimestre', cp: null, cat: 'Administrativas', acct: 'itau', amount: cents(14_820, 15), issue: 2, comp: 0, due: -18 });

// ----------------------------------------------------------------------------- recorrências (títulos previstos gerados pela própria rotina do sistema)
const rule = (r) => add(`select pg_temp.mk_rule(${sq(r.desc)}, ${sq(r.type)}, ${sq(r.cp ?? null)}, ${sq(r.cat)}, ${sq(r.acct)}, ${r.amount}, ${sq(r.freq)}, ${r.interval ?? 1}, ${r.start}, ${r.lead ?? 30});`);
rule({ desc: 'Aluguel da sede', type: 'payable', cp: 'Imobiliária Central', cat: 'Aluguel', acct: 'itau', amount: cents(6_500), freq: 'monthly', start: 145 });
rule({ desc: 'Internet e telefonia', type: 'payable', cp: 'NetFibra Telecom', cat: 'Tecnologia', acct: 'itau', amount: cents(389, 90), freq: 'monthly', start: 143 });
rule({ desc: 'Assinaturas de software (SaaS)', type: 'payable', cp: 'CloudSoft Licenças', cat: 'Licenças de software', acct: 'nubank', amount: cents(1_790), freq: 'monthly', start: 140 });
rule({ desc: 'Mensalidade — Alfa Indústria', type: 'receivable', cp: 'Alfa Indústria de Embalagens Ltda', cat: 'Recorrências', acct: 'itau', amount: cents(12_000), freq: 'monthly', start: 144 });
rule({ desc: 'Contrato de suporte — Beta Comércio', type: 'receivable', cp: 'Beta Comércio de Peças Ltda', cat: 'Recorrências', acct: 'itau', amount: cents(8_500), freq: 'monthly', start: 141 });
rule({ desc: 'Seguro anual (antecipação trimestral)', type: 'payable', cp: 'Contabilidade Exata', cat: 'Administrativas', acct: 'itau', amount: cents(2_250), freq: 'quarterly', start: 130 });
add(`select pg_temp.gen_rules();`);
add(`select pg_temp.pay_rule('Aluguel da sede', 'itau', 0, 0);`);
add(`select pg_temp.pay_rule('Internet e telefonia', 'itau', 0, 0);`);
add(`select pg_temp.pay_rule('Assinaturas de software (SaaS)', 'nubank', 0, 1);`); // o último mês fica em aberto
add(`select pg_temp.pay_rule('Mensalidade — Alfa Indústria', 'itau', 1, 0);`);
add(`select pg_temp.pay_rule('Contrato de suporte — Beta Comércio', 'itau', 2, 1);`); // recebimento atrasado do último mês
add(`select pg_temp.pay_rule('Seguro anual (antecipação trimestral)', 'itau', 0, 0);`);

// ----------------------------------------------------------------------------- extrato, importação e conciliação
add(`select pg_temp.statement_demo();`);
add(`select pg_temp.goal_demo();`);

const header = `-- ARQUIVO GERADO por scripts/gen-seed.mjs — NÃO edite à mão. Dados de DEMONSTRAÇÃO, fictícios e determinísticos.
-- Empresa: «Nova Horizonte Serviços Ltda. (dados fictícios)». Usuários @demo.exemplo, senha local: DemoLocal#2026
--   dono@ (administrador) · gestor@ (gestor financeiro) · analista@ (analista financeiro) · consulta@ (consulta)
-- Tudo que movimenta dinheiro nasce pelas funções do sistema (fin_*), nunca por INSERT direto no livro. Datas relativas ao dia da criação do banco.
-- Só para ambiente local/demonstração; nunca use em produção.
`;

const body = `
create function pg_temp.today() returns date language sql stable as $f$ select (now() at time zone 'America/Sao_Paulo')::date $f$;
create function pg_temp.d(n int) returns date language sql stable as $f$ select pg_temp.today() - n $f$;
-- instante «N dias atrás» ao meio-dia (horário de Brasília); N = 0 → agora
create function pg_temp.ts(n int) returns timestamptz language sql stable as $f$
  select case when n <= 0 then now() else ((pg_temp.today() - n)::timestamp + time '12:00') at time zone 'America/Sao_Paulo' end $f$;

create temp table seedmap (k text primary key, id uuid not null);
create function pg_temp.id(p_k text) returns uuid language sql stable as $f$ select id from seedmap where k = p_k $f$;
create function pg_temp.org() returns uuid language sql immutable as $f$ select '${ORG}'::uuid $f$;
create function pg_temp.cat(p_name text) returns uuid language sql stable as $f$
  select id from public.financial_categories where organization_id = pg_temp.org() and lower(name) = lower(p_name) limit 1 $f$;
create function pg_temp.cp(p_name text) returns uuid language sql stable as $f$
  select id from public.counterparties where organization_id = pg_temp.org() and name = p_name limit 1 $f$;

create function pg_temp.mk_account(p_k text, p_name text, p_type text, p_inst text, p_open bigint, p_ago int, p_inc boolean, p_neg boolean) returns void language plpgsql as $f$
begin
  insert into seedmap values (p_k, public.fin_create_account(pg_temp.org(), p_name, p_type::public.fin_account_type, p_inst, p_open, pg_temp.d(p_ago), p_inc, p_neg));
end $f$;

create function pg_temp.mk_entry(p_k text, p_type text, p_desc text, p_cp text, p_cat text, p_acct text, p_amount bigint, p_issue int, p_comp int, p_due int, p_n int, p_freq text, p_alloc jsonb) returns void language plpgsql as $f$
declare alloc jsonb;
begin
  select jsonb_agg(jsonb_build_object('cost_center_id', (select id from public.cost_centers where organization_id = pg_temp.org() and code = a ->> 'cost_center'), 'weight', (a ->> 'weight')::bigint))
    into alloc from jsonb_array_elements(coalesce(p_alloc, '[]'::jsonb)) a;
  insert into seedmap values (p_k, public.fin_create_entry(pg_temp.org(), p_type::public.fin_entry_type, p_desc, pg_temp.cp(p_cp), pg_temp.cat(p_cat), pg_temp.id(p_acct), p_amount,
    pg_temp.d(p_issue), pg_temp.d(p_comp), pg_temp.d(p_due), p_n, p_freq, null, 'seed-entry-' || p_k, alloc, null));
end $f$;

-- Dá baixa nas parcelas 1..p_upto (se vencidas há ao menos p_min_age dias): p_pct% do pendente, na data de vencimento + p_lag dias (nunca no futuro).
create function pg_temp.pay(p_k text, p_upto int, p_acct text, p_pct int, p_lag int, p_method text, p_min_age int) returns void language plpgsql as $f$
declare i record; when_ date; amt bigint; pend bigint;
begin
  for i in select * from public.financial_installments where entry_id = pg_temp.id(p_k) and installment_number <= p_upto order by installment_number loop
    when_ := least(i.due_date + p_lag, pg_temp.today());
    if i.due_date > pg_temp.today() - p_min_age then continue; end if;
    select i.amount_cents - coalesce(sum(st.amount_cents), 0) into pend from public.settlements st where st.installment_id = i.id and st.reversed_at is null;
    amt := case when p_pct >= 100 then pend else (pend * p_pct / 100) end;
    if amt <= 0 then continue; end if;
    perform public.fin_settle_installment(i.id, pg_temp.id(p_acct), amt, pg_temp.ts(pg_temp.today() - when_), p_method, null, 'seed-pay-' || p_k || '-' || i.installment_number || '-' || p_pct);
  end loop;
end $f$;

create function pg_temp.reverse(p_k text, p_no int, p_reason text) returns void language plpgsql as $f$
begin
  perform public.fin_reverse_settlement((select s.id from public.settlements s join public.financial_installments i on i.id = s.installment_id
    where i.entry_id = pg_temp.id(p_k) and i.installment_number = p_no and s.reversed_at is null order by s.created_at limit 1), p_reason);
end $f$;
create function pg_temp.cancel(p_k text, p_reason text) returns void language plpgsql as $f$ begin perform public.fin_cancel_entry(pg_temp.id(p_k), p_reason); end $f$;
create function pg_temp.xfer(p_k text, p_from text, p_to text, p_amount bigint, p_ago int, p_desc text) returns void language plpgsql as $f$
begin perform public.fin_create_transfer(pg_temp.org(), pg_temp.id(p_from), pg_temp.id(p_to), p_amount, pg_temp.ts(p_ago), p_desc, 'seed-xfer-' || p_k); end $f$;
create function pg_temp.adj(p_k text, p_acct text, p_amount bigint, p_kind text, p_reason text, p_ago int) returns void language plpgsql as $f$
begin perform public.fin_create_adjustment(pg_temp.org(), pg_temp.id(p_acct), p_amount, p_kind::public.fin_adjustment_kind, p_reason, pg_temp.ts(p_ago), 'seed-adj-' || p_k); end $f$;

create function pg_temp.mk_rule(p_desc text, p_type text, p_cp text, p_cat text, p_acct text, p_amount bigint, p_freq text, p_interval int, p_start int, p_lead int) returns void language plpgsql as $f$
begin
  perform public.fin_create_recurring_rule(pg_temp.org(), p_type::public.fin_entry_type, p_desc, pg_temp.cp(p_cp), pg_temp.cat(p_cat), pg_temp.id(p_acct), p_amount, p_freq::public.fin_frequency, p_interval, pg_temp.d(p_start), null, p_lead, null);
end $f$;
create function pg_temp.gen_rules() returns void language plpgsql as $f$ begin perform public.fin_generate_recurring(pg_temp.org()); end $f$;

-- Paga as ocorrências vencidas de uma regra; as p_leave mais recentes (vencidas) ficam em aberto para demonstrar atrasos.
create function pg_temp.pay_rule(p_desc text, p_acct text, p_lag int, p_leave int) returns void language plpgsql as $f$
declare r record; skip int := p_leave;
begin
  for r in select e.id, i.id as inst, i.due_date, i.amount_cents from public.financial_entries e join public.financial_installments i on i.entry_id = e.id
           where e.organization_id = pg_temp.org() and e.description = p_desc and e.recurring_rule_id is not null and i.due_date < pg_temp.today() order by i.due_date desc loop
    if skip > 0 then skip := skip - 1; continue; end if;
    perform public.fin_settle_installment(r.inst, pg_temp.id(p_acct), r.amount_cents, pg_temp.ts(pg_temp.today() - least(r.due_date + p_lag, pg_temp.today())),
      case when p_acct = 'nubank' then 'card' else 'pix' end, null, 'seed-rule-' || r.inst::text);
  end loop;
end $f$;

-- Extrato do Itaú dos últimos 35 dias a partir do livro: a maioria é conciliada, uma com diferença, uma ignorada e algumas ficam pendentes.
create function pg_temp.statement_demo() returns void language plpgsql as $f$
declare acct uuid := pg_temp.id('itau'); rows_ jsonb; m record; k int := 0; imp jsonb; lid uuid; mid uuid; sug record; recon int := 0;
begin
  select jsonb_agg(jsonb_build_object('row_number', x.rn, 'reference', x.ref, 'hash', encode(sha256(convert_to('seed-stmt|' || x.id::text, 'UTF8')), 'hex'),
      'data', jsonb_build_object('date', x.d, 'amount_cents', x.amt, 'description', x.dsc, 'external_reference', x.ref)) order by x.d, x.id)
    into rows_
  from (select y.*, row_number() over (order by y.d, y.id) as rn from (
    select m2.id, (m2.effective_at at time zone 'America/Sao_Paulo')::date as d,
           case when m2.id = (select id from public.account_movements where account_id = acct and movement_type = 'settlement' and amount_cents < 0 and effective_at > now() - interval '30 days' order by effective_at limit 1) then m2.amount_cents - 500 else m2.amount_cents end as amt,
           upper(case m2.movement_type when 'settlement' then (case when m2.amount_cents > 0 then 'PIX RECEBIDO ' else 'PAGTO TITULO ' end) || coalesce(left(m2.description, 24), '') when 'transfer_out' then 'TED ENVIADA' when 'transfer_in' then 'TED RECEBIDA'
                       when 'settlement_reversal' then 'ESTORNO' else 'TARIFA / AJUSTE' end) as dsc,
           'NH' || substr(replace(m2.id::text, '-', ''), 1, 10) as ref
    from public.account_movements m2 where m2.account_id = acct and m2.effective_at > now() - interval '35 days'
    union all
    select gen_random_uuid(), pg_temp.today() - 2, 18_732, 'RENDIMENTO CONTA REMUNERADA', 'NHRENDIM01'
    union all
    select gen_random_uuid(), pg_temp.today() - 9, -4_190, 'DEBITO AUTOMATICO NAO IDENTIFICADO', 'NHDEBAUT01'
  ) y) x;
  if rows_ is null then return; end if;
  imp := public.fin_create_import(pg_temp.org(), 'statement', 'extrato-demo-itau.csv', encode(sha256(convert_to('seed-extrato-demo', 'UTF8')), 'hex'), acct, rows_);
  perform public.fin_commit_import((imp ->> 'import_id')::uuid);
  -- concilia as sugestões NÃO ambíguas de valor igual (a primeira de cada linha); diferenças e ambíguas ficam para decisão humana
  for sug in select s.* from public.fin_suggest_matches(pg_temp.org(), acct, 3) s where s.amount_equal and not s.ambiguous order by s.score desc loop
    begin
      perform public.fin_reconcile(sug.line_id, sug.movement_id);
      recon := recon + 1;
    exception when others then null; end;
  end loop;
  -- a linha com diferença de R$ 5,00 é conciliada com justificativa (fica «divergente»)
  select s.* into sug from public.fin_suggest_matches(pg_temp.org(), acct, 3) s where not s.amount_equal order by s.score desc limit 1;
  if found then perform public.fin_reconcile(sug.line_id, sug.movement_id, 'Banco debitou R$ 5,00 a menos; conferir com o gerente.'); end if;
  select l.id into lid from public.bank_statement_lines l where l.account_id = acct and l.description = 'DEBITO AUTOMATICO NAO IDENTIFICADO';
  if lid is not null then perform public.fin_ignore_statement_line(lid, 'Débito de teste do banco já estornado; sem reflexo no caixa.'); end if;
end $f$;

create function pg_temp.goal_demo() returns void language plpgsql as $f$
begin
  insert into public.financial_goals (organization_id, name, metric_type, target_amount_cents, period_start, period_end, created_by)
  values (pg_temp.org(), 'Receita realizada do mês', 'income', 15000000, date_trunc('month', pg_temp.today())::date, (date_trunc('month', pg_temp.today()) + interval '1 month - 1 day')::date, '${uid(U.owner)}'),
         (pg_temp.org(), 'Teto de despesas do mês', 'expense', 9000000, date_trunc('month', pg_temp.today())::date, (date_trunc('month', pg_temp.today()) + interval '1 month - 1 day')::date, '${uid(U.owner)}');
end $f$;
`;

const prelude = `
do $seed$
declare
  org uuid := '${ORG}';
  pw text := extensions.crypt('DemoLocal#2026', extensions.gen_salt('bf'));
begin
  if exists (select 1 from public.organizations where id = org) then return; end if; -- já semeado
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
  select '00000000-0000-0000-0000-000000000000', v.id::uuid, 'authenticated', 'authenticated', v.email, pw, now(), '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('full_name', v.nome), now(), now(), '', '', '', ''
  from (values
    ('${uid(U.owner)}', 'dono@demo.exemplo', 'Helena Souza'), ('${uid(U.manager)}', 'gestor@demo.exemplo', 'Rafael Lima'),
    ('${uid(U.analyst)}', 'analista@demo.exemplo', 'Camila Prado'), ('${uid(U.viewer)}', 'consulta@demo.exemplo', 'Lívia Torres')
  ) as v(id, email, nome);
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  select gen_random_uuid(), u.id, u.email, jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true), 'email', now(), now(), now() from auth.users u where u.email like '%@demo.exemplo';
  update public.profiles p set full_name = u.raw_user_meta_data ->> 'full_name' from auth.users u where u.id = p.id and u.email like '%@demo.exemplo';
  insert into public.organizations (id, name, slug) values (org, 'Nova Horizonte Serviços Ltda. (dados fictícios)', 'nova-horizonte');
  insert into public.organization_settings (organization_id, display_name, theme) values (org, 'Nova Horizonte Serviços', '{"primary":"#162a43"}'::jsonb);
  insert into public.organization_members (organization_id, user_id, role) values
    (org, '${uid(U.owner)}', 'owner'), (org, '${uid(U.manager)}', 'manager'), (org, '${uid(U.analyst)}', 'member'), (org, '${uid(U.viewer)}', 'viewer');
  -- cadastros (categorias padrão nascem por gatilho)
  insert into public.counterparties (organization_id, kind, name, legal_name, document_number, email, phone) values
    ${CUSTOMERS.map(([nm, doc], i) => `(org, 'customer', ${sq(nm)}, ${sq(nm)}, ${sq(doc)}, ${sq(`financeiro${i + 1}@cliente.exemplo`)}, ${sq(`(11) 4000-10${i}0`)})`).join(',\n    ')},
    ${SUPPLIERS.map(([nm, doc], i) => `(org, 'supplier', ${sq(nm)}, ${sq(nm)}, ${sq(doc)}, ${sq(`contato${i + 1}@fornecedor.exemplo`)}, ${sq(`(11) 4000-20${i}0`)})`).join(',\n    ')};
  insert into public.cost_centers (organization_id, name, code) values ${CENTERS.map(([c, nm]) => `(org, ${sq(nm)}, ${sq(c)})`).join(', ')};
  ${SUBCATS.map(([nm, parent, nat]) => `insert into public.financial_categories (organization_id, parent_id, name, nature) select org, p.id, ${sq(nm)}, ${sq(nat)}::public.fin_nature from public.financial_categories p where p.organization_id = org and p.name = ${sq(parent)};`).join('\n  ')}
  update public.fin_settings set alert_days_before = 5 where organization_id = org;
  -- a partir daqui, as operações usam a sessão do proprietário (claims), exatamente como o app
  perform set_config('request.jwt.claims', '{"sub":"${uid(U.owner)}","aal":"aal2","role":"authenticated"}', true);
  ${ACCOUNTS.map((a) => `perform pg_temp.mk_account(${sq(a.k)}, ${sq(a.name)}, ${sq(a.type)}, ${sq(a.inst)}, ${a.opening}, ${a.ago}, ${a.include}, ${a.neg});`).join('\n  ')}
end $seed$;
`;

// as chamadas das operações rodam num segundo bloco (as funções temporárias precisam existir antes)
const ops = `
do $ops$
begin
  if not exists (select 1 from public.organizations where id = '${ORG}') or exists (select 1 from public.financial_entries where organization_id = '${ORG}') then return; end if;
  perform set_config('request.jwt.claims', '{"sub":"${uid(U.owner)}","aal":"aal2","role":"authenticated"}', true);
${sql.map((s) => `  perform ${s.replace(/^select /, '').replace(/;$/, '')};`).join('\n')}
  perform public.fin_run_routines('${ORG}');
end $ops$;
`;

mkdirSync(join(root, 'supabase'), { recursive: true });
// helpers antes dos blocos: o bloco 1 usa pg_temp.mk_account
writeFileSync(join(root, 'supabase', 'seed.sql'), header + body + prelude + ops);
const counts = { operations: sql.length, entries: sql.filter((s) => s.includes('mk_entry')).length, transfers: sql.filter((s) => s.includes('pg_temp.xfer')).length };
writeFileSync(join(root, 'supabase', 'seed-plan.json'), JSON.stringify({
  org: ORG, users: { owner: 'dono@demo.exemplo', manager: 'gestor@demo.exemplo', analyst: 'analista@demo.exemplo', viewer: 'consulta@demo.exemplo' }, password: 'DemoLocal#2026',
  accounts: ACCOUNTS.map((a) => ({ name: a.name, type: a.type, opening_cents: a.opening, include: a.include })), customers: CUSTOMERS.map((c) => c[0]), suppliers: SUPPLIERS.map((s) => s[0]), costCenters: CENTERS.map((c) => c[0]),
  checksum: createHash('sha256').update(sql.join('\n')).digest('hex').slice(0, 16), counts,
}, null, 2) + '\n');
console.log(`seed.sql gerado: ${counts.operations} operações (${counts.entries} títulos avulsos, ${counts.transfers} transferências) + 6 regras de recorrência.`);
