import type { Metadata } from 'next';
import { EntryDetailPage } from '@/components/finance/pages/entries';

export const metadata: Metadata = { title: 'Título — Contas a receber' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <EntryDetailPage type="receivable" id={(await params).id} />;
}
