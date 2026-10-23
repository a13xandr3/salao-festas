import '@angular/common/locales/global/pt';
import { ChangeDetectionStrategy, Component, ElementRef, inject, input, OnInit, output, signal, viewChild } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AdminAuth, AdminListRow } from '../../services/admin-auth';
import { FinanceDashboard, FinanceReservation } from '../../services/finance.models';

interface ExpenseReport {
  month: string; total: number; count: number;
  entries: { id: string; occurredOn: string; description: string; amount: number }[];
}

type FinanceOverview = Pick<FinanceDashboard, 'summary' | 'reservations' | 'reservationCount'>;

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const money = /^(?!0+(?:[.,]0{1,2})?$)\d{1,8}(?:[.,]\d{1,2})?$/;
export function financeError(error: unknown): string {
  const details = error as { code?: string; message?: string } | null;
  if (['PT400', 'PT404', 'PT409'].includes(details?.code ?? '') && details?.message) return details.message;
  return 'Não foi possível concluir a operação financeira. Atualize e tente novamente.';
}

@Component({
  selector: 'app-cash-flow', changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, CurrencyPipe, DatePipe],
  templateUrl: './cash-flow.html', styleUrl: './cash-flow.scss',
})
export class CashFlow implements OnInit {
  private readonly auth = inject(AdminAuth);
  private readonly fb = inject(FormBuilder);
  readonly disabled = input(false);
  readonly writing = output<boolean>();
  protected readonly today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  protected readonly snapshot = signal<FinanceOverview | null>(null);
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal('');
  protected readonly notice = signal('');
  protected readonly confirmation = signal<{ row: FinanceReservation; action: 'approve' } | null>(null);
  private readonly rejectionDialog = viewChild.required<ElementRef<HTMLDialogElement>>('rejectionDialog');
  protected readonly rejecting = signal<FinanceReservation | null>(null);
  protected readonly rejection = this.fb.nonNullable.group({
    reason: ['', [Validators.required, Validators.pattern(/\S/), Validators.maxLength(500)]],
    refundDate: [''],
    refundReference: [''],
    checked: [false, Validators.requiredTrue],
  });
  private rejectionPending?: { fingerprint: string; key: string };
  protected readonly cancelled = signal<AdminListRow[] | null>(null);
  protected readonly expenses = signal<ExpenseReport | null>(null);
  protected readonly expensePage = signal(0);
  protected readonly reservationPage = signal(0);
  protected readonly tab = signal<'entry' | 'price' | 'reservations' | 'cancelled' | 'expenses'>('reservations');
  protected readonly tabs = [
    { id: 'reservations', label: 'Pré-Reservas/Reservas' },
    { id: 'price', label: 'Definir valor contratado' },
    { id: 'entry', label: 'Registrar despesas' },
    { id: 'expenses', label: 'Despesas' },
    { id: 'cancelled', label: 'Cancelados' },
  ] as const;
  protected readonly period = this.fb.nonNullable.group({ month: [this.today.slice(0, 7), [Validators.required, Validators.pattern(/^\d{4}-(0[1-9]|1[0-2])$/)]] });
  protected readonly entry = this.fb.nonNullable.group({
    amount: ['', [Validators.required, Validators.pattern(money)]],
    occurredOn: [this.today, Validators.required],
    description: ['', [Validators.required, Validators.pattern(/\S/), Validators.maxLength(500)]],
    category: ['limpeza', Validators.required],
  });
  protected readonly price = this.fb.nonNullable.group({
    reservationId: ['', [Validators.required, Validators.pattern(uuid)]],
    dailyRate: ['', [Validators.required, Validators.pattern(money)]],
    reason: ['', [Validators.required, Validators.pattern(/\S/), Validators.maxLength(500)]],
  });
  protected readonly payment = this.fb.nonNullable.group({
    amount: ['', [Validators.required, Validators.pattern(money)]],
    occurredOn: [this.today, Validators.required],
    reference: ['', [Validators.required, Validators.pattern(/\S/), Validators.maxLength(120)]],
  });
  private receiptPending?: { fingerprint: string; key: string };
  private pending?: { fingerprint: string; key: string };

  ngOnInit(): void { void this.refresh(); }

  protected async refresh(): Promise<void> {
    this.period.markAllAsTouched();
    if (this.period.invalid || this.loading() || this.saving() || this.disabled()) return;
    if (this.tab() === 'expenses') { await this.refreshExpenses(); return; }
    this.loading.set(true); this.error.set('');
    try {
      this.snapshot.set(await this.auth.finance<FinanceOverview>('overview', {
        p_month: this.period.controls.month.value, p_reservation_page: this.reservationPage(),
      }));
    } catch (error) {
      this.snapshot.set(null); this.error.set(financeError(error));
    } finally { this.loading.set(false); }
  }

  protected async applyPeriod(): Promise<void> {
    this.expensePage.set(0); this.reservationPage.set(0); this.confirmation.set(null); await this.refresh();
  }

  protected async changePage(delta: number): Promise<void> {
    if (this.loading() || this.saving() || this.disabled()) return;
    this.reservationPage.update(value => Math.max(0, value + delta));
    this.confirmation.set(null); await this.refresh();
  }

  protected async selectTab(type: 'entry' | 'price' | 'reservations' | 'cancelled' | 'expenses'): Promise<void> {
    if (this.loading() || this.saving() || this.disabled()) return;
    this.notice.set(''); this.error.set(''); this.confirmation.set(null); this.tab.set(type);
    if (type === 'cancelled') await this.refreshCancelled();
    if (type === 'expenses') await this.refreshExpenses();
  }

  protected async refreshCancelled(): Promise<void> {
    if (this.loading() || this.saving() || this.disabled()) return;
    this.loading.set(true); this.error.set(''); this.cancelled.set(null);
    try { this.cancelled.set(await this.auth.list('pre_reservas_canceladas')); }
    catch { this.error.set('Não foi possível carregar os cancelados. Tente novamente.'); }
    finally { this.loading.set(false); }
  }

  protected async refreshExpenses(): Promise<void> {
    this.period.markAllAsTouched();
    if (this.period.invalid || this.loading() || this.saving() || this.disabled()) return;
    this.loading.set(true); this.error.set(''); this.expenses.set(null);
    try {
      this.expenses.set(await this.auth.finance<ExpenseReport>('expenses', {
        p_month: this.period.controls.month.value, p_page: this.expensePage(),
      }));
    } catch (error) {
      const code = (error as { code?: string } | null)?.code;
      this.error.set(code === 'PGRST202'
        ? 'O relatório de despesas ainda não está disponível no banco. Aplique a migração 202610230005_expense_report.sql no Supabase.'
        : code === 'PT403' || code === '42501'
          ? 'Sem permissão para consultar despesas. Entre novamente com uma conta administradora e confirme o segundo fator.'
          : financeError(error));
    }
    finally { this.loading.set(false); }
  }

  protected async changeExpensePage(delta: number): Promise<void> {
    if (this.loading() || this.saving() || this.disabled()) return;
    this.expensePage.update(value => Math.max(0, value + delta)); await this.refreshExpenses();
  }

  protected async submitEntry(): Promise<void> {
    this.entry.markAllAsTouched();
    if (this.entry.invalid || this.saving() || this.loading() || this.disabled()) return;
    const values = this.entry.getRawValue();
    const request = { ...values, kind: 'expense', amount: values.amount.replace(',', '.'), description: values.description.trim() };
    const fingerprint = JSON.stringify(request);
    if (this.pending?.fingerprint !== fingerprint) this.pending = { fingerprint, key: crypto.randomUUID() };
    if (await this.write('post', { p_input: { ...request, key: this.pending!.key } })) {
      this.pending = undefined; this.entry.reset({ occurredOn: this.today, category: 'limpeza' });
      await this.refresh(); this.notice.set('Despesa registrada.');
    }
  }

  protected async submitPrice(): Promise<void> {
    this.price.markAllAsTouched();
    if (this.price.invalid || this.saving() || this.loading() || this.disabled()) return;
    const values = this.price.getRawValue();
    if (await this.write('negotiate', { p_id: values.reservationId, p_daily_rate: values.dailyRate.replace(',', '.'), p_reason: values.reason.trim() })) {
      this.price.reset(); this.tab.set('reservations');
      await this.refresh(); this.notice.set('Valor negociado registrado.');
    }
  }

  protected openRejection(row: FinanceReservation): void {
    this.rejection.reset({ reason: '', refundDate: this.today, refundReference: '', checked: false });
    const paid = row.refundableAmount > 0;
    this.rejection.controls.refundDate.setValidators(paid ? [Validators.required] : []);
    this.rejection.controls.refundReference.setValidators(paid ? [Validators.required, Validators.pattern(/\S/), Validators.maxLength(120)] : []);
    this.rejection.controls.refundDate.updateValueAndValidity();
    this.rejection.controls.refundReference.updateValueAndValidity();
    this.error.set(''); this.notice.set(''); this.rejecting.set(row);
    this.rejectionDialog().nativeElement.showModal();
  }

  protected closeRejection(): void {
    if (this.saving()) return;
    this.rejecting.set(null); this.rejectionDialog().nativeElement.close();
  }

  protected async submitRejection(): Promise<void> {
    this.rejection.markAllAsTouched();
    const row = this.rejecting();
    if (!row || this.rejection.invalid || this.loading() || this.saving() || this.disabled()) return;
    const values = this.rejection.getRawValue();
    const request = { p_id: row.reservationId, p_reason: values.reason.trim(), p_refund_amount: String(row.refundableAmount),
      p_refund_date: row.refundableAmount > 0 ? values.refundDate : null,
      p_refund_reference: row.refundableAmount > 0 ? values.refundReference.trim() : null, p_checked: values.checked };
    const fingerprint = JSON.stringify(request);
    if (this.rejectionPending?.fingerprint !== fingerprint) this.rejectionPending = { fingerprint, key: crypto.randomUUID() };
    if (await this.write('reject', { ...request, p_key: this.rejectionPending!.key })) {
      this.rejectionPending = undefined; this.closeRejection();
      await this.refresh(); this.notice.set('Reserva reprovada. Motivo e eventual devolução registrados; consulte Cancelados.');
    }
  }

  protected openPayment(row: FinanceReservation): void {
    this.payment.reset({ amount: '', occurredOn: this.today, reference: '' });
    this.error.set(''); this.notice.set('');
    this.confirmation.set({ row, action: 'approve' });
  }

  protected async confirmReservation(): Promise<void> {
    const selected = this.confirmation();
    if (!selected || this.saving() || this.loading() || this.disabled()) return;
    this.payment.markAllAsTouched();
    if (this.payment.invalid) return;
    const values = this.payment.getRawValue();
    const request = { p_id: selected.row.reservationId, p_amount: values.amount.replace(',', '.'), p_occurred_on: values.occurredOn, p_reference: values.reference.trim() };
    const fingerprint = JSON.stringify(request);
    if (this.receiptPending?.fingerprint !== fingerprint) this.receiptPending = { fingerprint, key: crypto.randomUUID() };
    const parameters = { ...request, p_key: this.receiptPending!.key };
    if (await this.write(selected.action, parameters)) {
      this.receiptPending = undefined;
      this.confirmation.set(null);
      await this.refresh();
      this.notice.set('Pagamento registrado pelo valor informado. A reserva será confirmada quando o total estiver quitado.');
    }
  }

  private async write(action: 'post' | 'negotiate' | 'approve' | 'reject', parameters: object): Promise<boolean> {
    this.saving.set(true); this.writing.emit(true); this.error.set(''); this.notice.set('');
    try { await this.auth.finance(action, parameters); return true; }
    catch (error) { this.error.set(financeError(error)); return false; }
    finally { this.saving.set(false); this.writing.emit(false); }
  }
}
