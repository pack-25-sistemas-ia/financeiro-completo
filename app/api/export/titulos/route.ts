import { NextResponse } from 'next/server';

// Compatibilidade: a lista de títulos exporta pelo relatório «contas-pagar» / «contas-receber».
export function GET(request: Request) {
  const url = new URL(request.url);
  const type = url.searchParams.get('type') === 'receivable' ? 'contas-receber' : 'contas-pagar';
  url.searchParams.delete('type');
  return NextResponse.redirect(new URL(`/api/export/${type}${url.search}`, url.origin), 307);
}
