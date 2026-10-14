import type { Metadata } from 'next';
import { EntryNewPage } from '@/components/finance/pages/entries';

export const metadata: Metadata = { title: 'Novo título — Contas a pagar' };

export default function Page() {
  return <EntryNewPage type="payable" />;
}
