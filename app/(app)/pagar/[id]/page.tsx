import type { Metadata } from 'next';
import { EntryDetailPage } from '@/components/finance/pages/entries';

export const metadata: Metadata = { title: 'Título — Contas a pagar' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <EntryDetailPage type="payable" id={(await params).id} />;
}
