#!/usr/bin/env node
// Teste de mutação das regras críticas do banco: quebra cada regra DE PROPÓSITO numa cópia das migrações
// e exige que a suíte reprove. Se alguma mutação sobreviver, falta teste.
//   suite 'db'   → pnpm test:db (testes SQL com fixtures à mão)
//   suite 'conc' → pnpm test:concurrency (sessões simultâneas reais)
// Uso: node scripts/mutation-check.mjs [--only <trecho do nome>] [--jobs 3]
import { spawn } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const jobs = Number(args.includes('--jobs') ? args[args.indexOf('--jobs') + 1] : 3);

// { name, file (trecho do arquivo), find, replace, nth (qual ocorrência; omitido = única), suite }
const M = [
  // --- baixa: valores, idempotência, datas, sinal
  { name: 'baixa: aceita valor acima do pendente', file: 'fin_engine', find: 'if p_amount > i.amount_cents - paid then', replace: 'if false then' },
  { name: 'baixa: repetição com outro valor aceita', file: 'fin_engine', find: 'if ex.installment_id = p_installment and ex.account_id = p_account and ex.amount_cents = p_amount then return ex.id; end if;', replace: 'return ex.id;' },
  { name: 'baixa: repetição não devolve a original', file: 'fin_engine', find: 'if ex.installment_id = p_installment and ex.account_id = p_account and ex.amount_cents = p_amount then return ex.id; end if;', replace: '' },
  { name: 'baixa: recebimento vira saída', file: 'fin_engine', find: "signed := case e.entry_type when 'receivable' then p_amount else -p_amount end;", replace: "signed := case e.entry_type when 'receivable' then -p_amount else p_amount end;" },
  { name: 'baixa: título cancelado aceito', file: 'fin_engine', nth: 3, find: "if e.cancelled_at is not null then raise exception 'título cancelado' using errcode = '55000'; end if;", replace: '' },
  { name: 'baixa: data futura aceita', file: 'fin_engine', find: "if p_settled_at is null or p_settled_at > now() + interval '5 minutes' then", replace: 'if p_settled_at is null then' },
  { name: 'baixa: sem exigir chave de idempotência', file: 'fin_engine', find: "if p_key is null or char_length(p_key) < 8 then raise exception 'chave de idempotência obrigatória (mín. 8 caracteres)' using errcode = '22023'; end if;\n  if e.cancelled_at", replace: 'if e.cancelled_at' },
  // --- estorno
  { name: 'estorno: repetição aceita', file: 'fin_import_recon', find: "if s.reversed_at is not null then raise exception 'baixa já estornada' using errcode = '55000'; end if;", replace: '' },
  { name: 'estorno: movimento compensatório com sinal errado', file: 'fin_import_recon', find: "'settlement_reversal', -m.amount_cents", replace: "'settlement_reversal', m.amount_cents" },
  { name: 'estorno: sem exigir motivo', file: 'fin_import_recon', nth: 1, find: "if p_reason is null or char_length(trim(p_reason)) < 5 then raise exception 'informe o motivo do estorno' using errcode = '22023'; end if;", replace: '' },
  // --- livro, saldo e contas
  { name: 'saldo: conta sem negativo aceita saída além do saldo', file: 'fin_engine', find: 'if p_amount < 0 and not a.allow_negative then', replace: 'if false then' },
  { name: 'saldo: movimento antes do saldo inicial aceito', file: 'fin_engine', find: "if (p_at at time zone coalesce(tz, 'America/Sao_Paulo'))::date < a.opening_balance_date then", replace: 'if false then' },
  { name: 'saldo: conta arquivada recebe movimento', file: 'fin_engine', find: "if not a.active then raise exception 'conta «%» está arquivada', a.name using errcode = '55000'; end if;", replace: '' },
  { name: 'conta: arquiva com saldo', file: 'fin_engine', find: "if bal <> 0 then raise exception 'conta com saldo %: transfira ou ajuste o saldo antes de arquivar', private.fin_brl(bal) using errcode = '55000'; end if;", replace: '' },
  { name: 'saldo inicial: corrige pulando movimentos', file: 'fin_engine', find: "if exists (select 1 from public.account_movements m where m.account_id = p_id and (m.effective_at at time zone coalesce(tz, 'America/Sao_Paulo'))::date < p_date) then", replace: 'if false then' },
  { name: 'saldo inicial: editável sem a função própria', file: 'fin_engine', find: "and coalesce(current_setting('fin.opening_ok', true), '') <> '1' then", replace: 'and false then' },
  { name: 'saldo inicial: gestor também corrige', file: 'fin_engine', find: "perform private.fin_guard(a.organization_id, 'admin');", replace: "perform private.fin_guard(a.organization_id, 'manager');" },
  // --- transferências
  { name: 'transferência: aceita origem = destino', file: 'fin_engine', find: 'if p_source is null or p_destination is null or p_source = p_destination then', replace: 'if p_source is null or p_destination is null then' },
  { name: 'transferência: perna de entrada ausente', file: 'fin_engine', find: "perform private.fin_post_movement(p_org, p_destination, 'transfer_in', p_amount, p_at, null, tid, null, null, 'Transferência recebida');", replace: '' },
  { name: 'transferência: repetição não devolve a original', file: 'fin_engine', find: 'if ex.source_account_id = p_source and ex.destination_account_id = p_destination and ex.amount_cents = p_amount then return ex.id; end if;', replace: '' },
  { name: 'transferência: estorno ignora a perna de origem', file: 'fin_import_recon', find: "perform private.fin_post_movement(t.organization_id, t.source_account_id, 'transfer_reversal', -mo.amount_cents, now(), null, p_id, null, mo.id, 'Estorno de transferência');", replace: '' },
  { name: 'transferência: estorno repetido aceito', file: 'fin_import_recon', find: "if t.status = 'reversed' then raise exception 'transferência já estornada' using errcode = '55000'; end if;", replace: '' },
  { name: 'ajuste: repetição não devolve o original', file: 'fin_engine', find: 'if ex.account_id = p_account and ex.amount_cents = p_amount then return ex.id; end if;', replace: '' },
  // --- títulos, parcelas e rateio
  { name: 'título: criação repetida duplica', file: 'fin_engine', find: 'if ex.entry_type = p_type and ex.amount_cents = p_amount and ex.description = trim(p_description) then return ex.id; end if;', replace: '' },
  { name: 'parcelas: centavos restantes perdidos', file: 'fin_engine', find: 'left_ := p_total - (select sum(x) from unnest(res) x);', replace: 'left_ := 0;' },
  { name: 'parcelas: empate vai ao último índice', file: 'fin_engine', find: 'if rem[i] > rem[best] then best := i; end if;', replace: 'if rem[i] >= rem[best] then best := i; end if;' },
  { name: 'invariante: parcelas não precisam fechar com o título', file: 'fin_engine', find: 'if r.n = 0 or r.s <> r.amt or r.mn <> r.mx or r.n <> r.mn then', replace: 'if false then' },
  { name: 'invariante: rateio não precisa fechar com o título', file: 'fin_engine', find: 'if a.n > 0 and a.s <> r.amt then', replace: 'if false then' },
  { name: 'rateio: divisão sem distribuir o resto', file: 'fin_engine', find: 'shares := private.fin_distribute(p_amount, ws);', replace: 'shares := array_fill(p_amount / cardinality(ids), array[cardinality(ids)]);' },
  { name: 'título: cancela com baixa ativa', file: 'fin_engine', find: '  if exists (select 1 from public.settlements s join public.financial_installments x on x.id = s.installment_id where x.entry_id = p_id and s.reversed_at is null) then', replace: '  if false then' },
  { name: 'título: replaneja com histórico de baixas', file: 'fin_engine', find: '  if exists (select 1 from public.settlements s join public.financial_installments x on x.id = s.installment_id where x.entry_id = p_id) then', replace: '  if false then' },
  { name: 'título: categoria de outra natureza aceita', file: 'fin_engine', find: "if (p_type = 'receivable' and n <> 'income') or (p_type = 'payable' and n <> 'expense') then", replace: 'if false then' },
  { name: 'título: contraparte incompatível aceita', file: 'fin_engine', find: "if (p_type = 'receivable' and k = 'supplier') or (p_type = 'payable' and k = 'customer') then", replace: 'if false then' },
  { name: 'categoria: ciclo aceito', file: 'fin_engine', find: "if cur = new.id then raise exception 'ciclo na hierarquia de categorias' using errcode = '23514'; end if;", replace: '' },
  { name: 'categoria: subcategoria de outra natureza', file: 'fin_engine', find: "if pn is null or pn <> new.nature then raise exception 'subcategoria deve ter a mesma natureza da categoria-pai' using errcode = '23514'; end if;", replace: '' },
  // --- atraso derivado
  { name: 'atraso: parcela quitada continua atrasada', file: 'fin_views_recurring', find: 'e.cancelled_at is null and i.amount_cents > coalesce(p.paid, 0) and i.due_date <', replace: 'e.cancelled_at is null and i.due_date <' },
  // --- imutabilidade do histórico
  { name: 'histórico: livro editável', file: 'fin_engine', find: "execute format('create trigger %I before update or delete on public.%I for each row execute function private.fin_append_only()', 'append_' || t, t);", replace: 'null;' },
  { name: 'histórico: baixas apagáveis', file: 'fin_engine', find: "foreach t in array array['financial_accounts', 'financial_entries', 'settlements', 'transfers'] loop", replace: "foreach t in array array['financial_accounts', 'financial_entries', 'transfers'] loop" },
  { name: 'histórico: valor da baixa editável', file: 'fin_engine', find: "if new.reversed_at is null or (to_jsonb(new) - 'reversed_at' - 'reversed_by' - 'reversal_reason') is distinct from (to_jsonb(old) - 'reversed_at' - 'reversed_by' - 'reversal_reason') then", replace: 'if false then' },
  { name: 'histórico: valor do título com baixas editável', file: 'fin_engine', find: 'if new.amount_cents <> old.amount_cents and exists (', replace: 'if false and exists (' },
  // --- permissões e isolamento
  { name: 'permissão: analista faz baixa', file: 'fin_engine', find: "perform private.fin_guard(org, 'manager');", replace: "perform private.fin_guard(org, 'analyst');" },
  { name: 'permissão: analista estorna baixa', file: 'fin_import_recon', find: "perform private.fin_guard(s.organization_id, 'manager');", replace: "perform private.fin_guard(s.organization_id, 'analyst');" },
  { name: 'permissão: consulta cria título', file: 'fin_engine', find: "perform private.fin_guard(p_org, 'analyst');", replace: "perform private.fin_guard(p_org, 'read');" },
  { name: 'permissão: MFA ignorado nas funções', file: 'fin_engine', find: "if not private.mfa_ok() then raise exception 'verificação em duas etapas necessária' using errcode = '42501'; end if;", replace: '' },
  { name: 'permissão: gestor altera configurações', file: 'fin_engine', find: 'create policy fin_settings_update on public.fin_settings for update to authenticated using (private.fin_is_admin(organization_id))', replace: 'create policy fin_settings_update on public.fin_settings for update to authenticated using (private.fin_is_manager(organization_id))' },
  { name: 'isolamento: papel sem filtrar a organização', file: 'fin_schema', find: 'select m.role from public.organization_members m where m.organization_id = org and m.user_id = (select auth.uid());', replace: 'select m.role from public.organization_members m where m.user_id = (select auth.uid()) limit 1;' },
  { name: 'isolamento: leitura aberta a todos', file: 'fin_schema', find: "using (private.fin_can_read(organization_id))', t || '_select', t);", replace: "using (true)', t || '_select', t);" },
  { name: 'isolamento: conta prevista de outra empresa aceita', file: 'fin_engine', find: 'select active into act from public.financial_accounts where id = p_account and organization_id = p_org;', replace: 'select active into act from public.financial_accounts where id = p_account;' },
  // --- importação e conciliação
  { name: 'importação: mesmo arquivo reimportado', file: 'fin_import_recon', find: "  if found then return jsonb_build_object('duplicate_file', true, 'import_id', ex.id, 'status', ex.status); end if;", replace: '' },
  { name: 'conciliação: conta diferente aceita', file: 'fin_import_recon', find: "if m.account_id <> l.account_id then raise exception 'movimento e extrato são de contas diferentes' using errcode = '22023'; end if;", replace: '' },
  { name: 'conciliação: entrada com saída aceita', file: 'fin_import_recon', find: "if sign(m.amount_cents) <> sign(l.amount_cents) then raise exception 'entrada e saída não podem ser conciliadas entre si' using errcode = '22023'; end if;", replace: '' },
  { name: 'conciliação: diferença sem justificativa', file: 'fin_import_recon', find: 'if diff <> 0 and (p_note is null or char_length(trim(p_note)) < 5) then', replace: 'if false then' },
  { name: 'conciliação: movimento conciliado duas vezes', file: 'fin_import_recon', find: "if exists (select 1 from public.reconciliation_matches where movement_id = p_movement and status = 'active') then raise exception 'movimento já conciliado com outra linha' using errcode = '55000'; end if;", replace: '' },
  { name: 'conciliação: analista desfaz', file: 'fin_import_recon', find: "perform private.fin_guard(x.organization_id, 'manager');", replace: "perform private.fin_guard(x.organization_id, 'analyst');" },
  // --- exportação e métricas (a política de Storage dos anexos exige o schema storage do Supabase: coberta pelo E2E fin-security, fora desta suíte)
  { name: 'exportação: consulta registra e exporta', file: 'fin_export_log', find: "perform private.fin_guard(p_org, 'manager');", replace: "perform private.fin_guard(p_org, 'read');" },
  { name: 'métrica: receita ignora estornos de baixa', file: 'fin_metrics', find: "coalesce(sum(amount_cents) filter (where movement_type in ('settlement', 'settlement_reversal') and entry_type = 'receivable'), 0)::bigint as inflow,", replace: "coalesce(sum(amount_cents) filter (where movement_type in ('settlement') and entry_type = 'receivable'), 0)::bigint as inflow," },
  { name: 'métrica: transferência vira receita', file: 'fin_metrics', find: "coalesce(sum(amount_cents) filter (where movement_type in ('settlement', 'settlement_reversal') and entry_type = 'receivable'), 0)::bigint as inflow,", replace: "coalesce(sum(amount_cents) filter (where (movement_type in ('settlement', 'settlement_reversal') and entry_type = 'receivable') or movement_type = 'transfer_in'), 0)::bigint as inflow," },
  // --- concorrência (suíte própria)
  { name: 'concorrência: baixa sem travar a parcela', file: 'fin_engine', suite: 'conc', nth: 2, find: 'select * into i from public.financial_installments where id = p_installment for update;', replace: 'select * into i from public.financial_installments where id = p_installment;' },
  { name: 'concorrência: movimento sem travar a conta', file: 'fin_engine', suite: 'conc', find: 'select * into a from public.financial_accounts where id = p_account and organization_id = p_org for update;', replace: 'select * into a from public.financial_accounts where id = p_account and organization_id = p_org;' },
];

const migDir = join(root, 'supabase', 'migrations');
const files = readdirSync(migDir).filter((f) => f.endsWith('.sql'));
const SCRIPT = { db: 'test-db.mjs', conc: 'test-concurrency.mjs' };

function runSuite(dir, suite) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [join(dir, 'scripts', SCRIPT[suite])], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('close', (code) => resolve({ code, out }));
  });
}

function workspace(label, mutate) {
  const dir = mkdtempSync(join(tmpdir(), `pack25-fin-mut-${label}-`));
  mkdirSync(join(dir, 'scripts'));
  for (const s of Object.values(SCRIPT)) cpSync(join(root, 'scripts', s), join(dir, 'scripts', s));
  cpSync(join(root, 'supabase'), join(dir, 'supabase'), { recursive: true });
  if (mutate) {
    const f = files.find((x) => x.includes(mutate.file));
    const path = join(dir, 'supabase', 'migrations', f);
    const text = readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
    const parts = text.split(mutate.find);
    const nth = mutate.nth ?? 1;
    if (parts.length < 2) throw new Error(`mutação sem alvo: ${mutate.name}`);
    if (parts.length > 2 && !mutate.nth) throw new Error(`mutação ambígua (${parts.length - 1} ocorrências): ${mutate.name}`);
    if (nth > parts.length - 1) throw new Error(`mutação sem a ocorrência ${nth}: ${mutate.name}`);
    writeFileSync(path, parts.slice(0, nth).join(mutate.find) + mutate.replace + parts.slice(nth).join(mutate.find));
  }
  return dir;
}

const suitesNeeded = new Set(M.filter((m) => !only || m.name.includes(only)).map((m) => m.suite ?? 'db'));
for (const suite of suitesNeeded) {
  const base = workspace(`base-${suite}`, null);
  const baseline = await runSuite(base, suite);
  rmSync(base, { recursive: true, force: true });
  if (baseline.code !== 0) {
    console.error(`A suíte «${suite}» sem mutação já reprova; corrija antes.\n` + baseline.out.slice(-1500));
    process.exit(2);
  }
}

const todo = M.filter((m) => !only || m.name.includes(only));
const survived = [];
const broken = [];
let next = 0;
async function worker() {
  while (next < todo.length) {
    const m = todo[next++];
    let dir;
    try {
      dir = workspace(String(next), m);
    } catch (e) {
      console.log(`SEM ALVO    ${m.name} — ${e.message}`);
      broken.push(m.name);
      continue;
    }
    const r = await runSuite(dir, m.suite ?? 'db');
    rmSync(dir, { recursive: true, force: true });
    const killed = r.code !== 0;
    console.log(`${killed ? 'MORTA     ' : 'SOBREVIVEU '} ${m.name}`);
    if (!killed) survived.push(m.name);
  }
}
await Promise.all(Array.from({ length: Math.max(1, jobs) }, worker));
console.log(`\n${todo.length - survived.length - broken.length}/${todo.length} mutações reprovadas pela suíte.`);
if (broken.length) console.error('Mutações sem alvo (o texto mudou):\n- ' + broken.join('\n- '));
if (survived.length) console.error('Sobreviveram:\n- ' + survived.join('\n- '));
if (survived.length || broken.length) process.exit(1);
