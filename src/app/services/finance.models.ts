export type FinanceKind = 'receipt' | 'expense' | 'refund' | 'opening_in' | 'opening_out';
export interface FinanceSummary {
  openingBalance: number; income: number; expenses: number; closingBalance: number;
  amountDue: number; unpricedCount: number; unreconciledCount: number;
}
export interface FinanceTransaction {
  id: string; reservationId: string | null; name: string | null; kind: FinanceKind;
  category: string; amount: number; occurredOn: string; description: string; externalReference: string | null;
  createdBy: string; createdAt: string; signedAmount: number;
}
export interface FinanceReservation {
  reservationId: string; name: string; startDate: string; endDate: string; status: string;
  stayDays: number | null; dailyRate: number | null; totalAmount: number | null;
  received: number; refunded: number; amountDue: number; refundableAmount: number;
}
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
export type FinanceOverview = Pick<FinanceDashboard, 'summary' | 'reservations' | 'reservationCount'>;
export type FinanceAction = 'post' | 'overview' | 'negotiate' | 'approve' | 'reject' | 'expenses' | 'delete_expense';
