/** Tipos de recebimento, despesa, devolução e ajuste do livro caixa. */
export type FinanceKind = 'receipt' | 'expense' | 'refund' | 'opening_in' | 'opening_out';
/** Totais consolidados do caixa e valores a receber no período. */
export interface FinanceSummary {
  openingBalance: number; income: number; expenses: number; closingBalance: number;
  amountDue: number; unpricedCount: number; unreconciledCount: number;
}
/** Dados de uma movimentação e sua contribuição positiva ou negativa ao caixa. */
export interface FinanceTransaction {
  id: string; reservationId: string | null; name: string | null; kind: FinanceKind;
  category: string; amount: number; occurredOn: string; description: string; externalReference: string | null;
  createdBy: string; createdAt: string; signedAmount: number;
}
/** Situação financeira de uma reserva, incluindo recebimentos e devoluções. */
export interface FinanceReservation {
  reservationId: string; name: string; startDate: string; endDate: string; status: string;
  stayDays: number | null; dailyRate: number | null; totalAmount: number | null;
  received: number; refunded: number; amountDue: number; refundableAmount: number;
}
/** Resumo e páginas de movimentações e reservas retornados pelo banco. */
export interface FinanceDashboard {
  summary: FinanceSummary; transactions: FinanceTransaction[]; reservations: FinanceReservation[];
  transactionCount: number; reservationCount: number;
}

/** O total mensal inclui todas as páginas; entries contém apenas a página consultada. */
export interface ExpenseReport {
  month: string;
  total: number;
  count: number;
  entries: { id: string; occurredOn: string; description: string; amount: number }[];
}
/** Resumo financeiro e página de reservas apresentados no painel. */
export type FinanceOverview = Pick<FinanceDashboard, 'summary' | 'reservations' | 'reservationCount'>;
/** Operações financeiras disponibilizadas à interface administrativa. */
export type FinanceAction = 'post' | 'overview' | 'negotiate' | 'approve' | 'reject' | 'expenses' | 'delete_expense';
