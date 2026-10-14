import type { Metadata } from 'next';
import { CounterpartiesPage } from '@/components/finance/pages/counterparties';
import type { SearchParams } from '@/lib/finance/filters';

export const metadata: Metadata = { title: 'Fornecedores' };

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  return <CounterpartiesPage kind="supplier" sp={await searchParams} />;
}
