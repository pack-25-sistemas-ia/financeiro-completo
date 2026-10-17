#!/usr/bin/env node
// Concorrência REAL: várias sessões psql simultâneas contra o mesmo banco (dados confirmados, sem rollback).
// Prova: baixas paralelas não passam do pendente; a mesma chave não duplica; estorno simultâneo vale uma vez;
// transferências cruzadas (A→B e B→A) não travam; ao final o livro bate com as baixas.
// Uso: node scripts/test-concurrency.mjs   (requer Docker; banco descartável, sem porta publicada)
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dbDir = join(root, 'supabase');
const name = `pack25-fin-conc-${randomBytes(4).toString('hex')}`;
const IMAGE = process.env.PG_TEST_IMAGE ?? 'postgres:17-alpine';
const OWNER = 'ffffffff-0000-4000-8000-0000000000a0';
const docker = (a, o = {}) => spawnSync('docker', a, { encoding: 'utf8', ...o });

// «Largada sincronizada»: depois de armGun(), toda chamada espera um alvo comum (advisory lock) liberado só quando o canhão termina;
// assim as sessões entram no motor AO MESMO TEMPO (sem isso, o atraso de abrir cada sessão pode esconder a falta de uma trava).
const GUN_KEY = 7777006;
const GUN_MS = 3500;
let gunOn = false;
function psql(sql, { asOwner = false } = {}) {
  const wrapped = asOwner
    ? `begin; select set_config('request.jwt.claims', '{"sub":"${OWNER}","aal":"aal2","email":"oa@t.invalid"}', true); set local role authenticated; ${gunOn ? `select pg_advisory_xact_lock_shared(${GUN_KEY});` : ''} ${sql}; commit;`
    : sql;
  return new Promise((resolve) => {
    const p = spawn('docker', ['exec', '-i', name, 'psql', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'core'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => resolve({ code, out: out.trim(), err: err.trim() }));
    p.stdin.end(wrapped);
  });
}
async function armGun() {
  gunOn = true;
  spawn('docker', ['exec', '-i', name, 'psql', '-X', '-q', '-t', '-A', '-U', 'postgres', '-d', 'core', '-c', `select pg_advisory_lock(${GUN_KEY}); select pg_sleep(${GUN_MS / 1000});`], { stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    const r = await psql("select count(*) from pg_locks where locktype = 'advisory' and granted and mode = 'ExclusiveLock'");
    if (r.out.trim() === '1') return;
    await new Promise((res) => setTimeout(res, 100));
  }
}
const one = async (sql, opts) => { const r = await psql(sql, opts); if (r.code !== 0) throw new Error(r.err); return r.out.split('\n').filter(Boolean).pop(); };

let failed = 0;
const check = (cond, label) => { console.log(`  ${cond ? 'PASS' : 'FALHOU'}: ${label}`); if (!cond) failed++; };

try {
  if (docker(['version', '--format', '{{.Server.Version}}']).status !== 0) throw new Error('Docker indisponível');
  const run = docker(['run', '-d', '--rm', '--name', name, '-e', `POSTGRES_PASSWORD=${randomBytes(16).toString('hex')}`, '-e', 'POSTGRES_DB=core', IMAGE, '-c', 'max_connections=200']);
  if (run.status !== 0) throw new Error(run.stderr);
  for (let i = 0; i < 60; i++) {
    if (docker(['exec', name, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'core']).status === 0) break;
    spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},1000)']);
  }
  // harness + migrações (sem os testes numerados)
  for (const f of ['tests/00_harness.sql', ...readdirSync(join(dbDir, 'migrations')).sort().map((x) => `migrations/${x}`)]) {
    const r = await psql(readFileSync(join(dbDir, f), 'utf8'));
    if (r.code !== 0) throw new Error(`${f}: ${r.err}`);
  }
  // cenário confirmado
  await psql(`insert into auth.users (id, email) values ('${OWNER}', 'oa@t.invalid')`);
  const org = await one(`select public.create_organization('Empresa Concorrência', 'empresa-conc')`, { asOwner: true });
  const mk = (n, cents, neg) => one(`select public.fin_create_account('${org}', '${n}', 'checking', null, ${cents}, current_date - 30, true, ${neg})`, { asOwner: true });
  const A = await mk('Conta A', 1000000, true);
  const B = await mk('Conta B', 1000000, true);
  const C = await mk('Conta sem negativo', 50000, false);
  const entry = (type, amount) => one(`select public.fin_create_entry('${org}', '${type}', 'Título concorrente', null, null, null, ${amount}, current_date, current_date, current_date + 5, 1)`, { asOwner: true });
  const inst = (e) => one(`select id from public.financial_installments where entry_id = '${e}'`);
  const bal = async (acc) => Number(await one(`select balance_cents from public.fin_account_balances where account_id = '${acc}'`));

  // 1) 10 baixas simultâneas de 30.000 sobre uma parcela de 100.000 (chaves distintas): só 3 cabem
  const i1 = await inst(await entry('receivable', 100000));
  await armGun();
  const r1 = await Promise.all(Array.from({ length: 10 }, (_, k) => psql(`select public.fin_settle_installment('${i1}', '${A}', 30000, now(), 'pix', null, 'conc-par-${String(k).padStart(3, '0')}-xx')`, { asOwner: true })));
  const ok1 = r1.filter((r) => r.code === 0).length;
  const paid1 = Number(await one(`select coalesce(sum(amount_cents),0) from public.settlements where installment_id = '${i1}' and reversed_at is null`));
  check(ok1 === 3 && paid1 === 90000, `10 baixas de 300,00 sobre 1.000,00: exatamente 3 passam (passaram ${ok1}, soma ${paid1})`);
  check(r1.filter((r) => r.code !== 0).every((r) => /excede o pendente/.test(r.err)), 'as demais falham por «excede o pendente», sem outro erro');
  check((await bal(A)) === 1000000 + 90000, 'saldo da conta = inicial + 3 baixas');

  // 2) 8 requisições com a MESMA chave: uma baixa só, todas devolvem o mesmo id
  const i2 = await inst(await entry('receivable', 50000));
  await armGun();
  const r2 = await Promise.all(Array.from({ length: 8 }, () => psql(`select public.fin_settle_installment('${i2}', '${A}', 20000, now(), 'pix', null, 'conc-same-key-001')`, { asOwner: true })));
  const ids2 = new Set(r2.filter((r) => r.code === 0).map((r) => r.out.split('\n').filter(Boolean).pop()));
  check(r2.every((r) => r.code === 0) && ids2.size === 1, 'mesma chave em 8 requisições: todas ok e devolvem a mesma baixa');
  check(Number(await one(`select count(*) from public.settlements where installment_id = '${i2}'`)) === 1, 'uma única baixa gravada');
  check(Number(await one(`select count(*) from public.account_movements m join public.settlements s on s.id = m.settlement_id where s.installment_id = '${i2}'`)) === 1, 'um único movimento no livro');

  // 3) estorno simultâneo da mesma baixa: vale uma vez
  const sid = [...ids2][0];
  await armGun();
  const r3 = await Promise.all(Array.from({ length: 6 }, () => psql(`select public.fin_reverse_settlement('${sid}', 'estorno concorrente de teste')`, { asOwner: true })));
  check(r3.filter((r) => r.code === 0).length === 1, `6 estornos simultâneos: só 1 vale (valeram ${r3.filter((r) => r.code === 0).length})`);
  check(Number(await one(`select count(*) from public.account_movements where settlement_id = '${sid}'`)) === 2, 'livro com original + 1 estorno');

  // 4) pagamentos simultâneos numa conta que NÃO aceita saldo negativo (saldo 500,00; 8 saídas de 120,00 → cabem 4)
  const payInst = [];
  for (let k = 0; k < 8; k++) payInst.push(await inst(await entry('payable', 12000)));
  await armGun();
  const r4 = await Promise.all(payInst.map((p, k) => psql(`select public.fin_settle_installment('${p}', '${C}', 12000, now(), 'pix', null, 'conc-neg-${String(k).padStart(3, '0')}-xx')`, { asOwner: true })));
  const ok4 = r4.filter((r) => r.code === 0).length;
  if (process.env.DEBUG_CONC) console.log(r4.filter((r) => r.code !== 0).map((r) => r.err.split('\n')[0]));
  const balC = Number(await one(`select opening_balance_cents + coalesce((select sum(amount_cents) from public.account_movements where account_id = '${C}'), 0) from public.financial_accounts where id = '${C}'`));
  check(ok4 === 4 && balC === 50000 - 4 * 12000, `conta sem negativo: 4 de 8 saídas passam e o saldo não fica negativo (passaram ${ok4}, saldo ${balC})`);

  // 4b) estornos e pagamentos simultâneos numa conta sem saldo negativo: 5 recebimentos de 100,00 (saldo 500,00);
  //      depois 5 estornos + 5 pagamentos de 100,00 ao mesmo tempo — só 5 operações cabem e o saldo termina em zero
  const D = await mk('Conta D sem negativo', 0, false);
  const recvSettles = [];
  for (let k = 0; k < 5; k++) {
    const ii = await inst(await entry('receivable', 10000));
    recvSettles.push(await one(`select public.fin_settle_installment('${ii}', '${D}', 10000, now(), 'pix', null, 'conc-rv-${String(k).padStart(3, '0')}-xx')`, { asOwner: true }));
  }
  const payD = [];
  for (let k = 0; k < 5; k++) payD.push(await inst(await entry('payable', 10000)));
  await armGun();
  const r4b = await Promise.all([
    ...recvSettles.map((sid2) => psql(`select public.fin_reverse_settlement('${sid2}', 'estorno concorrente com pagamento')`, { asOwner: true })),
    ...payD.map((p, k) => psql(`select public.fin_settle_installment('${p}', '${D}', 10000, now(), 'pix', null, 'conc-pd-${String(k).padStart(3, '0')}-xx')`, { asOwner: true })),
  ]);
  const ok4b = r4b.filter((r) => r.code === 0).length;
  const balD = await bal(D);
  check(ok4b === 5 && balD === 0, `estornos × pagamentos simultâneos: só 5 de 10 cabem e o saldo termina em zero, nunca negativo (passaram ${ok4b}, saldo ${balD})`);

  // 5) transferências cruzadas A→B e B→A simultâneas: sem impasse e com saldos consistentes
  const balA0 = await bal(A), balB0 = await bal(B);
  await armGun();
  const r5 = await Promise.all(Array.from({ length: 20 }, (_, k) => k % 2 === 0
    ? psql(`select public.fin_create_transfer('${org}', '${A}', '${B}', 1000, now(), null, 'conc-xfer-ab-${String(k).padStart(3, '0')}')`, { asOwner: true })
    : psql(`select public.fin_create_transfer('${org}', '${B}', '${A}', 700, now(), null, 'conc-xfer-ba-${String(k).padStart(3, '0')}')`, { asOwner: true })));
  check(r5.every((r) => r.code === 0), '20 transferências cruzadas simultâneas concluem sem impasse');
  check((await bal(A)) === balA0 - 10 * 1000 + 10 * 700 && (await bal(B)) === balB0 + 10 * 1000 - 10 * 700, 'saldos das duas contas batem com as transferências');

  // 6) invariantes finais do livro
  const gap = Number(await one(`
    select coalesce(sum(abs(x.net_movements - x.net_settled)), 0) from (
      select e.id,
        coalesce((select sum(m.amount_cents) from public.account_movements m join public.settlements s on s.id = m.settlement_id join public.financial_installments i on i.id = s.installment_id
                  where i.entry_id = e.id), 0) as net_movements,
        case e.entry_type when 'receivable' then 1 else -1 end * coalesce((select sum(s.amount_cents) from public.settlements s join public.financial_installments i on i.id = s.installment_id
                  where i.entry_id = e.id and s.reversed_at is null), 0) as net_settled
      from public.financial_entries e) x`));
  check(gap === 0, 'livro × baixas ativas: diferença zero em todos os títulos');
  check(Number(await one(`select coalesce(sum(amount_cents), 0) from public.account_movements where transfer_id is not null`)) === 0, 'transferências somam zero no livro');
  check(Number(await one(`select count(*) from (select i.id from public.financial_installments i left join lateral (select coalesce(sum(s.amount_cents),0) p from public.settlements s where s.installment_id = i.id and s.reversed_at is null) q on true where q.p > i.amount_cents) z`)) === 0, 'nenhuma parcela paga acima do valor');
} catch (e) {
  console.error(String(e.message ?? e));
  failed++;
} finally {
  docker(['rm', '-f', name]);
}
console.log(failed === 0 ? 'CONCORRÊNCIA: TODOS OS TESTES PASSARAM' : `CONCORRÊNCIA: ${failed} FALHA(S)`);
process.exit(failed === 0 ? 0 : 1);
