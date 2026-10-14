import type { Metadata } from 'next';
import { EntriesListPage } from '@/components/finance/pages/entries';
import type { SearchParams } from '@/lib/finance/filters';

export const metadata: Metadata = { title: 'Contas a pagar' };

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  return <EntriesListPage type="payable" sp={await searchParams} />;
}
