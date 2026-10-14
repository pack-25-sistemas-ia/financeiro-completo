// Configuração da Gestão Financeira Empresarial. Para personalizar para uma empresa:
//  1. troque `name`;  2. substitua public/brand/logo.svg;  3. ajuste a navegação em `primaryNav`.
// Papéis do Core → perfis financeiros: owner/admin = Administrador; manager = Gestor financeiro;
// member = Analista financeiro; viewer = Consulta (ver docs/PERMISSIONS.md).
// Este arquivo é do sistema (listado em .core-overrides): o sync-core nunca o sobrescreve.
// Itens de menu entram junto com as telas reais de cada módulo (nenhum link para página inexistente).
import type { OrgRole } from '@/lib/validation/org';

export type NavItem = { href: string; label: string; roles?: readonly OrgRole[] };

export const systemConfig: { name: string; logo: string; primaryNav: NavItem[] } = {
  name: 'Gestão Financeira Empresarial',
  logo: '/brand/logo.svg',
  primaryNav: [
    { href: '/dashboard', label: 'Painel' },
    { href: '/contas', label: 'Contas' },
    { href: '/pagar', label: 'A pagar' },
    { href: '/receber', label: 'A receber' },
    { href: '/movimentacoes', label: 'Movimentações' },
    { href: '/fluxo-caixa', label: 'Fluxo de caixa' },
    { href: '/conciliacao', label: 'Conciliação' },
    { href: '/importacoes', label: 'Importações' },
    { href: '/recorrencias', label: 'Recorrências' },
    { href: '/clientes', label: 'Clientes' },
    { href: '/fornecedores', label: 'Fornecedores' },
    { href: '/categorias', label: 'Categorias' },
    { href: '/centros-custo', label: 'Centros de custo' },
    { href: '/relatorios', label: 'Relatórios' },
    { href: '/notificacoes', label: 'Notificações' },
    { href: '/configuracoes', label: 'Config. financeiras', roles: ['owner', 'admin'] },
  ],
};
