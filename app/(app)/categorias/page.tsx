import type { Metadata } from 'next';
import { Alert, Badge, Card, PageHeader } from '@/components/ui/primitives';
import { Section } from '@/components/finance/bits';
import { CategoryForm, CategoryRowForm } from '@/components/finance/forms-catalogs';
import type { CategoryRow } from '@/lib/finance/data';
import { loadCategories } from '@/lib/finance/data';
import { NATURE_LABELS } from '@/lib/finance/labels';
import { categoryLabel, pageCtx } from '@/lib/finance/page';

export const metadata: Metadata = { title: 'Categorias' };

function tree(cats: CategoryRow[], parent: string | null, depth: number): Array<{ c: CategoryRow; depth: number }> {
  return cats.filter((c) => c.parent_id === parent).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')).flatMap((c) => [{ c, depth }, ...tree(cats, c.id, depth + 1)]);
}

export default async function CategoriasPage() {
  const p = await pageCtx();
  const cats = await loadCategories(p.ctx);
  const income = tree(cats.filter((c) => c.nature === 'income'), null, 0);
  const expense = tree(cats.filter((c) => c.nature === 'expense'), null, 0);
  const parents = cats.filter((c) => c.active).map((c) => ({ value: c.id, label: categoryLabel(cats, c), nature: c.nature }));
  const col = (title: string, rows: ReturnType<typeof tree>) => (
    <Card title={title}>
      {rows.length === 0 ? <p className="text-sm text-muted">Nenhuma categoria.</p> : (
        <ul className="space-y-2">
          {rows.map(({ c, depth }) => (
            <li key={c.id} className={depth ? 'border-l-2 border-border pl-3' : ''}>
              <div className={`flex flex-wrap items-center gap-2 ${depth === 2 ? 'ml-4' : ''}`}>
                {p.perms.manager ? <CategoryRowForm id={c.id} name={c.name} active={c.active} /> : <span className="text-sm">{c.name} {c.active ? null : <Badge>Inativa</Badge>}</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
  return (
    <>
      <PageHeader title="Categorias" description="Plano gerencial de receitas e despesas (não é plano de contas contábil oficial). Estruture como preferir, em até 3 níveis; desativar não altera lançamentos antigos." />
      <div className="grid gap-4 lg:grid-cols-2">{col('Receitas', income)}{col('Despesas', expense)}</div>
      {p.perms.manager ? <Section title="Nova categoria ou subcategoria"><Card><CategoryForm parents={parents} /></Card></Section> : <div className="mt-4"><Alert tone="info">Somente gestor financeiro ou administrador altera categorias.</Alert></div>}
      <p className="mt-4 text-xs text-muted">Natureza ({Object.values(NATURE_LABELS).join(' / ')}) não muda depois de criada: uma subcategoria sempre herda a natureza do pai.</p>
    </>
  );
}
