import { inject, Injectable } from '@angular/core';
import { AdminAuth } from './admin-auth';
import { FinanceAction } from './finance.models';

export type AdminList = 'contacts' | 'preReservations' | 'pre_reservas_canceladas';
export interface AdminListRow {
  id: string; name: string; email: string; phone: string; createdAt: string;
  rejectionReason?: string; rejectedAt?: string; rejectionRefundAmount?: number;
  message?: string; startDate?: string; endDate?: string; status?: string;
}

const listColumns: Record<AdminList, string> = {
  contacts: 'id,name,email,phone,message,createdAt',
  preReservations: 'id,name,email,phone,startDate,endDate,status,createdAt',
  pre_reservas_canceladas: 'id,name,email,phone,startDate,endDate,status,createdAt,rejectionReason,rejectedAt,rejectionRefundAmount',
};

function monthBounds(month: string): [string, string] {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Período inválido.');
  const [year, number] = month.split('-').map(Number);
  const next = number === 12 ? `${String(year + 1).padStart(4, '0')}-01` : `${year}-${String(number + 1).padStart(2, '0')}`;
  return [`${month}-01`, `${next}-01`];
}

/** Consultas administrativas e RPCs financeiras; a autenticação pertence ao AdminAuth. */
@Injectable({ providedIn: 'root' })
export class AdminData {
  private readonly auth = inject(AdminAuth);

  async list(type: AdminList, month?: string): Promise<AdminListRow[]> {
    return this.auth.runAuthorized(async client => {
      const query = client.from(type).select(listColumns[type]);
      if (type === 'pre_reservas_canceladas' && month !== undefined) {
        const [start, end] = monthBounds(month);
        query.gte('startDate', start).lt('startDate', end);
      }
      const result = await query.order('createdAt', { ascending: false }).limit(100).overrideTypes<AdminListRow[], { merge: false }>();
      if (result.error) throw result.error;
      return result.data ?? [];
    });
  }

  async finance<T>(action: FinanceAction, parameters: object): Promise<T> {
    return this.auth.runAuthorized(async client => {
      const result = await client.rpc(`booking_finance_${action}`, parameters);
      if (result.error) throw result.error;
      if (result.data === null) throw new Error('Resposta financeira indisponível.');
      return result.data as T;
    });
  }

}
