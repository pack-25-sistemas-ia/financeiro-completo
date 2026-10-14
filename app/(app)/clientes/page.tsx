import type { Metadata } from 'next';
import { CounterpartiesPage } from '@/components/finance/pages/counterparties';
import type { SearchParams } from '@/lib/finance/filters';

export const metadata: Metadata = { title: 'Clientes' };

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  return <CounterpartiesPage kind="customer" sp={await searchParams} />;
}
