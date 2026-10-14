'use client';

import dynamic from 'next/dynamic';

// Gráficos só no navegador: a biblioteca gera estilos em linha, que a CSP estrita bloquearia no HTML do servidor.
// (O Next exige que as opções do `dynamic` sejam um objeto literal, por isso se repetem.)
function Skeleton() {
  return (
    <div role="status" className="h-[330px] animate-pulse rounded-lg bg-black/10 dark:bg-white/10">
      <span className="sr-only">Carregando gráfico…</span>
    </div>
  );
}

export const MonthlyChartClient = dynamic(() => import('./charts').then((m) => m.MonthlyChart), { ssr: false, loading: Skeleton });
export const BalanceChartClient = dynamic(() => import('./charts').then((m) => m.BalanceChart), { ssr: false, loading: Skeleton });
export const FlowChartClient = dynamic(() => import('./charts').then((m) => m.FlowChart), { ssr: false, loading: Skeleton });
export const ProjectionChartClient = dynamic(() => import('./charts').then((m) => m.ProjectionChart), { ssr: false, loading: Skeleton });
export const CategoryChartClient = dynamic(() => import('./charts').then((m) => m.CategoryChart), { ssr: false, loading: Skeleton });
export const AgingChartClient = dynamic(() => import('./charts').then((m) => m.AgingChart), { ssr: false, loading: Skeleton });
export const PlannedActualChartClient = dynamic(() => import('./charts').then((m) => m.PlannedActualChart), { ssr: false, loading: Skeleton });
export const CostCenterChartClient = dynamic(() => import('./charts').then((m) => m.CostCenterChart), { ssr: false, loading: Skeleton });
