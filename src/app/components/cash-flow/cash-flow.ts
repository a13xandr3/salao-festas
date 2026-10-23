import '@angular/common/locales/global/pt';
import { ChangeDetectionStrategy, Component, inject, input, OnInit, output, signal } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { AdminAuth } from '../../services/admin-auth';
import { FinanceDashboard, FinanceKind, FinanceReservation } from '../../services/finance.models';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const money = /^(?!0+(?:[.,]0{1,2})?$)\d{1,8}(?:[.,]\d{1,2})?$/;
export function entryRequirements(control: AbstractControl): ValidationErrors | null {
  const { kind, reservationId, reference } = control.value;
  if ((kind === 'receipt' || kind === 'refund') && !uuid.test(reservationId)) return { reservationRequired: true };
  if (kind === 'receipt' && !reference.trim()) return { referenceRequired: true };
  return null;
}
export function financeError(error: unknown): string {
  const details = error as { code?: string; message?: string } | null;
  if (['PT400', 'PT404', 'PT409'].includes(details?.code ?? '') && details?.message) return details.message;
  return 'Não foi possível concluir a operação financeira. Atualize e tente novamente.';
}

@Component({
  selector: 'app-cash-flow',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, CurrencyPipe, DatePipe],
  templateUrl: './cash-flow.html',
  styleUrl: './cash-flow.scss',
})
export class CashFlow implements OnInit {
  private readonly auth = inject(AdminAuth);
  private readonly fb = inject(FormBuilder);
  readonly disabled = input(false);
  readonly writing = output<boolean>();
  protected readonly today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  protected readonly snapshot = signal<FinanceDashboard | null>(null);
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal('');
  protected readonly notice = signal('');
  protected readonly page = signal(0);
  protected readonly reservationPage = signal(0);
  protected readonly tab = signal<'transactions' | 'reservations'>('transactions');
  protected readonly editing = signal<'entry' | 'price' | null>(null);
  protected readonly labels: Record<FinanceKind, string> = {
    receipt: 'Recebimento', expense: 'Despesa', refund: 'Devolução', opening_in: 'Saldo/ajuste de entrada', opening_out: 'Saldo/ajuste de saída',
  };
  protected readonly categoryLabels: Record<string, string> = { locacao: 'Locação', limpeza: 'Limpeza', manutencao: 'Manutenção', agua: 'Água', energia: 'Energia', fornecedores: 'Fornecedores', devolucao: 'Devolução', ajuste: 'Ajuste de saldo', outros: 'Outros' };
  protected readonly period = this.fb.nonNullable.group({ month: [this.today.slice(0, 7), [Validators.required, Validators.pattern(/^\d{4}-(0[1-9]|1[0-2])$/)]] });
  protected readonly entry = this.fb.nonNullable.group({
    kind: ['receipt' as FinanceKind, Validators.required],
    reservationId: ['', Validators.pattern(uuid)],
    amount: ['', [Validators.required, Validators.pattern(money)]],
    occurredOn: [this.today, Validators.required],
    description: ['', [Validators.required, Validators.pattern(/\S/), Validators.maxLength(500)]],
    reference: ['', Validators.maxLength(120)],
    category: ['outros', Validators.required],
  }, { validators: entryRequirements });
  protected readonly price = this.fb.nonNullable.group({
    reservationId: ['', [Validators.required, Validators.pattern(uuid)]],
    dailyRate: ['', [Validators.required, Validators.pattern(money)]],
  });
  private pending?: { fingerprint: string; key: string };

  ngOnInit(): void { void this.refresh(); }

  protected async refresh(): Promise<void> {
    this.period.markAllAsTouched();
    if (this.period.invalid || this.loading() || this.saving() || this.disabled()) return;
    this.loading.set(true);
    this.error.set('');
    try {
      this.snapshot.set(await this.auth.finance<FinanceDashboard>('dashboard', {
        p_month: this.period.controls.month.value, p_page: this.page(), p_reservation_page: this.reservationPage(),
      }));
    } catch (error) {
      this.snapshot.set(null);
      this.error.set(financeError(error));
    } finally { this.loading.set(false); }
  }

  protected async applyPeriod(): Promise<void> {
    this.page.set(0); this.reservationPage.set(0);
    await this.refresh();
  }

  protected async changePage(type: 'transactions' | 'reservations', delta: number): Promise<void> {
    if (this.loading() || this.saving() || this.disabled()) return;
    const page = type === 'transactions' ? this.page : this.reservationPage;
    page.update(value => Math.max(0, value + delta));
    await this.refresh();
  }

  protected edit(type: 'entry' | 'price'): void {
    this.notice.set(''); this.error.set(''); this.editing.set(type);
  }

  protected prepare(row: FinanceReservation, action: 'receipt' | 'refund' | 'price'): void {
    this.error.set(''); this.notice.set('');
    if (action === 'price') {
      this.price.reset({ reservationId: row.reservationId, dailyRate: '' });
      this.editing.set('price');
    } else {
      this.entry.reset({ kind: action, reservationId: row.reservationId,
        amount: String(action === 'receipt' ? row.amountDue : row.refundableAmount), occurredOn: this.today,
        description: `${this.labels[action]} da pré-reserva ${row.reservationId}`, reference: '', category: action === 'receipt' ? 'locacao' : 'devolucao' });
      this.editing.set('entry');
    }
  }

  protected async submitEntry(): Promise<void> {
    this.entry.markAllAsTouched();
    if (this.entry.invalid || this.saving() || this.loading() || this.disabled()) return;
    const values = this.entry.getRawValue();
    const request = { ...values, amount: values.amount.replace(',', '.'), description: values.description.trim(), reference: values.reference.trim() };
    const fingerprint = JSON.stringify(request);
    if (this.pending?.fingerprint !== fingerprint) this.pending = { fingerprint, key: crypto.randomUUID() };
    if (await this.write('post', { p_input: { ...request, key: this.pending!.key } })) {
      this.pending = undefined;
      this.entry.reset({ kind: 'receipt', occurredOn: this.today });
      this.editing.set(null);
      this.period.controls.month.setValue(values.occurredOn.slice(0, 7));
      this.page.set(0); this.reservationPage.set(0);
      await this.refresh();
      this.notice.set('Movimentação registrada.');
    }
  }

  protected async submitPrice(): Promise<void> {
    this.price.markAllAsTouched();
    if (this.price.invalid || this.saving() || this.loading() || this.disabled()) return;
    const values = this.price.getRawValue();
    if (await this.write('price', { p_id: values.reservationId, p_daily_rate: values.dailyRate.replace(',', '.') })) {
      this.price.reset(); this.editing.set(null);
      await this.refresh();
      this.notice.set('Valor contratado registrado.');
    }
  }

  private async write(action: 'post' | 'price', parameters: object): Promise<boolean> {
    this.saving.set(true); this.writing.emit(true); this.error.set(''); this.notice.set('');
    try { await this.auth.finance(action, parameters); return true; }
    catch (error) { this.error.set(financeError(error)); return false; }
    finally { this.saving.set(false); this.writing.emit(false); }
  }
}
