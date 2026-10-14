'use client';

import { Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatBRL } from '@/lib/finance/money';

// Gráficos só no navegador (ver charts-loader.tsx). Todos os valores vêm do banco; cada gráfico traz uma tabela alternativa acessível.
export type MonthRow = { label: string; income: number; expense: number };
export type PointRow = { label: string; balance: number };
export type CatRow = { name: string; cents: number; share: number };
export type BucketRow = { label: string; cents: number; count: number };
export type PvaRow = { label: string; plannedIncome: number; actualIncome: number; plannedExpense: number; actualExpense: number };
export type CcRow = { name: string; income: number; expense: number };
export type FlowRow = { label: string; inflow: number; outflow: number; balance: number };
export type ProjRow = { label: string; base: number; conservative: number; optimistic: number };

const INCOME = '#047857';
const EXPENSE = '#b91c1c';
const BALANCE = '#0e7490';
const PLANNED = '#94a3b8';
const TICK = { fill: 'currentColor', fontSize: 12 };
const TOOLTIP = { background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--foreground)' };
const compact = new Intl.NumberFormat('pt-BR', { notation: 'compact', style: 'currency', currency: 'BRL', maximumFractionDigits: 1 });
const tick = (v: number) => compact.format(v / 100); // só rótulo de eixo; os valores exatos ficam na tabela e no tooltip
const tip = (v: unknown) => formatBRL(Number(v));
const Grid = () => <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.2} />;

function Frame({ title, description, empty, children, table }: { title: string; description: string; empty: boolean; children: React.ReactNode; table: React.ReactNode }) {
  return (
    <section className="min-w-0 rounded-lg border border-border bg-card p-4 shadow-sm" aria-label={title}>
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="mb-3 text-xs text-muted">{description}</p>
      {empty ? <p className="flex h-[260px] items-center justify-center rounded-md border border-dashed border-border text-sm text-muted">Sem dados no período selecionado</p> : <div className="h-[260px] w-full text-muted">{children}</div>}
      <details className="mt-3 text-sm"><summary className="cursor-pointer text-muted">Ver dados em tabela</summary><div className="mt-2 overflow-x-auto">{table}</div></details>
    </section>
  );
}
const TH = 'px-2 py-1 text-left font-medium text-muted';
const TD = 'px-2 py-1 tabular-nums';
const T = ({ caption, head, children }: { caption: string; head: string[]; children: React.ReactNode }) => (
  <table className="w-full text-xs"><caption className="sr-only">{caption}</caption><thead><tr>{head.map((h) => <th key={h} scope="col" className={TH}>{h}</th>)}</tr></thead><tbody>{children}</tbody></table>
);

export function MonthlyChart({ rows }: { rows: MonthRow[] }) {
  return (
    <Frame title="Receitas × despesas por mês" description="Regime de caixa: baixas efetivas no mês, líquidas de estornos. Transferências e ajustes ficam de fora." empty={rows.every((r) => r.income === 0 && r.expense === 0)}
      table={<T caption="Receitas e despesas por mês" head={['Mês', 'Receitas', 'Despesas']}>{rows.map((r) => <tr key={r.label}><td className={TD}>{r.label}</td><td className={TD}>{formatBRL(r.income)}</td><td className={TD}>{formatBRL(r.expense)}</td></tr>)}</T>}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}><Grid /><XAxis dataKey="label" tick={TICK} /><YAxis tick={TICK} tickFormatter={tick} width={64} /><Tooltip contentStyle={TOOLTIP} formatter={tip} /><Legend />
          <Bar isAnimationActive={false} dataKey="income" name="Receitas" fill={INCOME} radius={[4, 4, 0, 0]} /><Bar isAnimationActive={false} dataKey="expense" name="Despesas" fill={EXPENSE} radius={[4, 4, 0, 0]} /></BarChart>
      </ResponsiveContainer>
    </Frame>
  );
}

export function BalanceChart({ rows }: { rows: PointRow[] }) {
  return (
    <Frame title="Evolução do saldo consolidado" description="Saldo ao fim de cada dia (contas incluídas no consolidado). Transferências entre contas não alteram a linha." empty={rows.length === 0}
      table={<T caption="Saldo consolidado ao longo do período" head={['Data', 'Saldo']}>{rows.map((r) => <tr key={r.label}><td className={TD}>{r.label}</td><td className={TD}>{formatBRL(r.balance)}</td></tr>)}</T>}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}><Grid /><XAxis dataKey="label" tick={TICK} minTickGap={24} /><YAxis tick={TICK} tickFormatter={tick} width={64} /><Tooltip contentStyle={TOOLTIP} formatter={tip} />
          <ReferenceLine y={0} stroke="currentColor" strokeOpacity={0.5} /><Line isAnimationActive={false} type="monotone" dataKey="balance" name="Saldo" stroke={BALANCE} strokeWidth={2} dot={false} /></LineChart>
      </ResponsiveContainer>
    </Frame>
  );
}

export function FlowChart({ rows, title, description }: { rows: FlowRow[]; title: string; description: string }) {
  return (
    <Frame title={title} description={description} empty={rows.every((r) => r.inflow === 0 && r.outflow === 0)}
      table={<T caption={title} head={['Período', 'Entradas', 'Saídas', 'Saldo']}>{rows.map((r) => <tr key={r.label}><td className={TD}>{r.label}</td><td className={TD}>{formatBRL(r.inflow)}</td><td className={TD}>{formatBRL(r.outflow)}</td><td className={TD}>{formatBRL(r.balance)}</td></tr>)}</T>}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}><Grid /><XAxis dataKey="label" tick={TICK} minTickGap={16} /><YAxis tick={TICK} tickFormatter={tick} width={64} /><Tooltip contentStyle={TOOLTIP} formatter={tip} /><Legend /><ReferenceLine y={0} stroke="currentColor" strokeOpacity={0.5} />
          <Bar isAnimationActive={false} dataKey="inflow" name="Entradas" fill={INCOME} /><Bar isAnimationActive={false} dataKey="outflow" name="Saídas" fill={EXPENSE} />
          <Line isAnimationActive={false} type="monotone" dataKey="balance" name="Saldo" stroke={BALANCE} strokeWidth={2} dot={false} /></ComposedChart>
      </ResponsiveContainer>
    </Frame>
  );
}

export function ProjectionChart({ rows }: { rows: ProjRow[] }) {
  return (
    <Frame title="Saldo projetado por cenário" description="Hipóteses transparentes (parâmetros em Configurações), não previsão estatística nem valor garantido." empty={rows.length === 0}
      table={<T caption="Saldo projetado por cenário" head={['Período', 'Base', 'Conservador', 'Otimista']}>{rows.map((r) => <tr key={r.label}><td className={TD}>{r.label}</td><td className={TD}>{formatBRL(r.base)}</td><td className={TD}>{formatBRL(r.conservative)}</td><td className={TD}>{formatBRL(r.optimistic)}</td></tr>)}</T>}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}><Grid /><XAxis dataKey="label" tick={TICK} minTickGap={16} /><YAxis tick={TICK} tickFormatter={tick} width={64} /><Tooltip contentStyle={TOOLTIP} formatter={tip} /><Legend /><ReferenceLine y={0} stroke={EXPENSE} strokeDasharray="4 4" />
          <Line isAnimationActive={false} type="monotone" dataKey="base" name="Base" stroke={BALANCE} strokeWidth={2.5} dot={false} />
          <Line isAnimationActive={false} type="monotone" dataKey="conservative" name="Conservador" stroke={EXPENSE} strokeWidth={1.5} strokeDasharray="5 3" dot={false} />
          <Line isAnimationActive={false} type="monotone" dataKey="optimistic" name="Otimista" stroke={INCOME} strokeWidth={1.5} strokeDasharray="5 3" dot={false} /></LineChart>
      </ResponsiveContainer>
    </Frame>
  );
}

export function CategoryChart({ rows, title, income }: { rows: CatRow[]; title: string; income: boolean }) {
  return (
    <Frame title={title} description={income ? 'Receitas realizadas no período, agrupadas pela categoria principal.' : 'Despesas realizadas no período, agrupadas pela categoria principal.'} empty={rows.length === 0}
      table={<T caption={title} head={['Categoria', 'Valor', '%']}>{rows.map((r) => <tr key={r.name}><td className={TD}>{r.name}</td><td className={TD}>{formatBRL(r.cents)}</td><td className={TD}>{(r.share / 100).toFixed(2).replace('.', ',')}%</td></tr>)}</T>}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows.slice(0, 8)} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}><Grid /><XAxis type="number" tick={TICK} tickFormatter={tick} /><YAxis type="category" dataKey="name" tick={TICK} width={112} /><Tooltip contentStyle={TOOLTIP} formatter={tip} />
          <Bar isAnimationActive={false} dataKey="cents" name="Valor" fill={income ? INCOME : EXPENSE} radius={[0, 4, 4, 0]} /></BarChart>
      </ResponsiveContainer>
    </Frame>
  );
}

export function AgingChart({ rows, title, income }: { rows: BucketRow[]; title: string; income: boolean }) {
  return (
    <Frame title={title} description="Saldo ainda pendente, por faixa de vencimento a partir de hoje. Vencidas à esquerda." empty={rows.every((r) => r.cents === 0)}
      table={<T caption={title} head={['Faixa', 'Pendente', 'Parcelas']}>{rows.map((r) => <tr key={r.label}><td className={TD}>{r.label}</td><td className={TD}>{formatBRL(r.cents)}</td><td className={TD}>{r.count}</td></tr>)}</T>}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}><Grid /><XAxis dataKey="label" tick={TICK} /><YAxis tick={TICK} tickFormatter={tick} width={64} /><Tooltip contentStyle={TOOLTIP} formatter={tip} />
          <Bar isAnimationActive={false} dataKey="cents" name="Pendente" fill={income ? INCOME : EXPENSE} radius={[4, 4, 0, 0]} /></BarChart>
      </ResponsiveContainer>
    </Frame>
  );
}

export function PlannedActualChart({ rows }: { rows: PvaRow[] }) {
  return (
    <Frame title="Previsto × realizado" description="Previsto = parcelas com vencimento no mês; realizado = baixas efetivas no mês (caixa). São critérios diferentes por definição." empty={rows.every((r) => r.plannedIncome + r.actualIncome + r.plannedExpense + r.actualExpense === 0)}
      table={<T caption="Previsto e realizado por mês" head={['Mês', 'Receita prev.', 'Receita real.', 'Despesa prev.', 'Despesa real.']}>{rows.map((r) => <tr key={r.label}><td className={TD}>{r.label}</td><td className={TD}>{formatBRL(r.plannedIncome)}</td><td className={TD}>{formatBRL(r.actualIncome)}</td><td className={TD}>{formatBRL(r.plannedExpense)}</td><td className={TD}>{formatBRL(r.actualExpense)}</td></tr>)}</T>}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}><Grid /><XAxis dataKey="label" tick={TICK} /><YAxis tick={TICK} tickFormatter={tick} width={64} /><Tooltip contentStyle={TOOLTIP} formatter={tip} /><Legend />
          <Bar isAnimationActive={false} dataKey="plannedIncome" name="Receita prevista" fill={PLANNED} /><Bar isAnimationActive={false} dataKey="actualIncome" name="Receita realizada" fill={INCOME} />
          <Bar isAnimationActive={false} dataKey="plannedExpense" name="Despesa prevista" fill="#cbd5e1" /><Bar isAnimationActive={false} dataKey="actualExpense" name="Despesa realizada" fill={EXPENSE} /></BarChart>
      </ResponsiveContainer>
    </Frame>
  );
}

export function CostCenterChart({ rows }: { rows: CcRow[] }) {
  return (
    <Frame title="Desempenho por centro de custo" description="Receitas e despesas realizadas, ponderadas pelo rateio de cada título." empty={rows.length === 0}
      table={<T caption="Centros de custo" head={['Centro', 'Receitas', 'Despesas']}>{rows.map((r) => <tr key={r.name}><td className={TD}>{r.name}</td><td className={TD}>{formatBRL(r.income)}</td><td className={TD}>{formatBRL(r.expense)}</td></tr>)}</T>}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}><Grid /><XAxis dataKey="name" tick={TICK} /><YAxis tick={TICK} tickFormatter={tick} width={64} /><Tooltip contentStyle={TOOLTIP} formatter={tip} /><Legend />
          <Bar isAnimationActive={false} dataKey="income" name="Receitas" fill={INCOME} radius={[4, 4, 0, 0]} /><Bar isAnimationActive={false} dataKey="expense" name="Despesas" fill={EXPENSE} radius={[4, 4, 0, 0]} /></BarChart>
      </ResponsiveContainer>
    </Frame>
  );
}
