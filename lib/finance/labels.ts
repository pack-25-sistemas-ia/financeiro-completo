// Rótulos em português e conjuntos de valores usados por formulários, filtros e tabelas.
export type Tone = 'neutral' | 'success' | 'warning' | 'danger';

export const ACCOUNT_TYPES = ['checking', 'digital', 'cash', 'savings', 'other'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];
export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  checking: 'Conta corrente', digital: 'Conta digital', cash: 'Caixa físico', savings: 'Poupança empresarial', other: 'Outra conta de disponibilidade',
};

export const ENTRY_TYPES = ['payable', 'receivable'] as const;
export type EntryType = (typeof ENTRY_TYPES)[number];
export const ENTRY_TYPE_LABELS: Record<EntryType, string> = { payable: 'A pagar', receivable: 'A receber' };

export type InstallmentStatus = 'open' | 'partial' | 'paid' | 'cancelled';
export const STATUS_LABELS: Record<EntryType, Record<InstallmentStatus, string>> = {
  payable: { open: 'Aberta', partial: 'Parcialmente paga', paid: 'Paga', cancelled: 'Cancelada' },
  receivable: { open: 'Aberta', partial: 'Parcialmente recebida', paid: 'Recebida', cancelled: 'Cancelada' },
};
export const STATUS_TONES: Record<InstallmentStatus, Tone> = { open: 'neutral', partial: 'warning', paid: 'success', cancelled: 'neutral' };

export const SETTLEMENT_METHODS = ['pix', 'transfer', 'boleto', 'card', 'cash', 'check', 'other'] as const;
export type SettlementMethod = (typeof SETTLEMENT_METHODS)[number];
export const METHOD_LABELS: Record<SettlementMethod, string> = { pix: 'Pix', transfer: 'Transferência/TED', boleto: 'Boleto', card: 'Cartão', cash: 'Dinheiro', check: 'Cheque', other: 'Outro' };

export const MOVEMENT_LABELS: Record<string, string> = {
  settlement: 'Baixa', settlement_reversal: 'Estorno de baixa', transfer_out: 'Transferência enviada', transfer_in: 'Transferência recebida', transfer_reversal: 'Estorno de transferência', adjustment: 'Ajuste de saldo',
};

export const ADJUSTMENT_KINDS = ['manual', 'fee', 'interest', 'correction'] as const;
export const ADJUSTMENT_LABELS: Record<(typeof ADJUSTMENT_KINDS)[number], string> = { manual: 'Ajuste manual', fee: 'Tarifa', interest: 'Juros/rendimento', correction: 'Correção' };

export const NATURES = ['income', 'expense'] as const;
export const NATURE_LABELS: Record<(typeof NATURES)[number], string> = { income: 'Receita', expense: 'Despesa' };

export const COUNTERPARTY_KINDS = ['customer', 'supplier', 'both'] as const;
export const COUNTERPARTY_LABELS: Record<(typeof COUNTERPARTY_KINDS)[number], string> = { customer: 'Cliente', supplier: 'Fornecedor', both: 'Cliente e fornecedor' };

export const FREQUENCY_OPTIONS = ['weekly', 'monthly', 'quarterly', 'annual'] as const;
export const FREQUENCY_NAMES: Record<(typeof FREQUENCY_OPTIONS)[number], string> = { weekly: 'Semanal', monthly: 'Mensal', quarterly: 'Trimestral', annual: 'Anual' };

export const IMPORT_KINDS = ['payables', 'receivables', 'customers', 'suppliers', 'statement', 'history'] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];
export const IMPORT_LABELS: Record<ImportKind, string> = {
  payables: 'Contas a pagar', receivables: 'Contas a receber', customers: 'Clientes', suppliers: 'Fornecedores', statement: 'Extrato bancário', history: 'Movimentações históricas',
};
export const IMPORT_STATUS_LABELS: Record<string, string> = { previewed: 'Aguardando confirmação', completed: 'Concluída', cancelled: 'Cancelada' };
export const IMPORT_ROW_LABELS: Record<string, string> = { valid: 'Válida', duplicate: 'Repetida', error: 'Com erro', imported: 'Importada', rejected: 'Rejeitada' };

export const RECON_LABELS: Record<string, string> = { pending: 'Pendente', reconciled: 'Conciliado', divergent: 'Divergente', ignored: 'Ignorado' };
export const RECON_TONES: Record<string, Tone> = { pending: 'warning', reconciled: 'success', divergent: 'danger', ignored: 'neutral' };

export const NOTIFICATION_TYPES = ['due_soon', 'overdue', 'receivable_late', 'projected_negative', 'recurring_generated', 'import_done', 'reconciliation_pending', 'processing_failed', 'entry_reversed'] as const;
export const NOTIFICATION_LABELS: Record<(typeof NOTIFICATION_TYPES)[number], string> = {
  due_soon: 'Conta vencendo', overdue: 'Conta vencida', receivable_late: 'Recebimento atrasado', projected_negative: 'Saldo projetado negativo', recurring_generated: 'Recorrência gerada',
  import_done: 'Importação finalizada', reconciliation_pending: 'Conciliação pendente', processing_failed: 'Falha em processamento', entry_reversed: 'Lançamento estornado',
};

export const SCENARIOS = ['base', 'conservative', 'optimistic'] as const;
export type Scenario = (typeof SCENARIOS)[number];
export const SCENARIO_LABELS: Record<Scenario, string> = { base: 'Base', conservative: 'Conservador', optimistic: 'Otimista' };

export const GRANULARITIES = ['day', 'week', 'month'] as const;
export type Granularity = (typeof GRANULARITIES)[number];
export const GRANULARITY_LABELS: Record<Granularity, string> = { day: 'Diária', week: 'Semanal', month: 'Mensal' };

export const GOAL_METRICS = ['income', 'expense', 'net'] as const;
export const GOAL_LABELS: Record<(typeof GOAL_METRICS)[number], string> = { income: 'Receita realizada', expense: 'Despesa realizada', net: 'Resultado de caixa' };

export const PERFIL_LABELS: Record<string, string> = { owner: 'Administrador (proprietário)', admin: 'Administrador', manager: 'Gestor financeiro', member: 'Analista financeiro', viewer: 'Consulta' };

/** Permissões por papel — espelham private.fin_is_* no banco (o banco é quem decide; isto só esconde botões). */
export function can(role: string) {
  const admin = role === 'owner' || role === 'admin';
  const manager = admin || role === 'manager';
  const analyst = manager || role === 'member';
  return { admin, manager, analyst, read: true };
}
