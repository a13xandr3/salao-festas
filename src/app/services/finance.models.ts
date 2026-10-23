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
