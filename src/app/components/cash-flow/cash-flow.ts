import '@angular/common/locales/global/pt';
import { ChangeDetectionStrategy, Component, ElementRef, inject, input, OnInit, output, signal, viewChild, WritableSignal } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { FormBuilder, FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { AdminData, AdminListRow } from '../../services/admin-data';
import { ExpenseReport, FinanceOverview, FinanceReservation, FinanceAction } from '../../services/finance.models';

import { expenseError, financeError, moneyPattern, moneyValue, RequestKey } from '../../services/finance-utils';
import { maskMoney } from '../../shared/formats/input-masks';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Coordena formulários e estado visual; autorização e regras financeiras pertencem às RPCs. */
@Component({
  selector: 'app-cash-flow', changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, CurrencyPipe, DatePipe],
  templateUrl: './cash-flow.html', styleUrl: './cash-flow.scss',
})
export class CashFlow implements OnInit {
  private readonly api = inject(AdminData);
  private readonly fb = inject(FormBuilder);
  readonly disabled = input(false);
  readonly writing = output<boolean>();
  protected readonly today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  protected readonly snapshot = signal<FinanceOverview | null>(null);
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal('');
  protected readonly notice = signal('');
  protected readonly confirmation = signal<{ row: FinanceReservation } | null>(null);
  private readonly rejectionDialog = viewChild.required<ElementRef<HTMLDialogElement>>('rejectionDialog');
  protected readonly rejecting = signal<FinanceReservation | null>(null);
  protected readonly rejection = this.fb.nonNullable.group({
    reason: ['', [Validators.required, Validators.pattern(/\S/), Validators.maxLength(500)]],
    refundDate: [''],
    refundReference: [''],
    checked: [false, Validators.requiredTrue],
  });
  private readonly rejectionKey = new RequestKey();
  protected readonly cancelled = signal<AdminListRow[] | null>(null);
  protected readonly expenses = signal<ExpenseReport | null>(null);
  protected readonly expenseToDelete = signal<ExpenseReport['entries'][number] | null>(null);
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
  protected readonly expenseCategories = [
    { value: 'limpeza', label: 'Limpeza' },
    { value: 'manutencao', label: 'Manutenção' },
    { value: 'agua', label: 'Água' },
    { value: 'energia', label: 'Energia' },
    { value: 'fornecedores', label: 'Fornecedores' },
    { value: 'aluguel_avulso', label: 'Aluguel Avulso' },
    { value: 'outros', label: 'Outros insumos e utensílios' },
  ] as const;
  protected readonly period = this.fb.nonNullable.group({ month: [this.today.slice(0, 7), [Validators.required, Validators.pattern(/^\d{4}-(0[1-9]|1[0-2])$/)]] });
  protected readonly entry = this.fb.nonNullable.group({
    amount: ['', [Validators.required, Validators.pattern(moneyPattern)]],
    occurredOn: [this.today, Validators.required],
    description: ['', [Validators.required, Validators.pattern(/\S/), Validators.maxLength(500)]],
    category: ['limpeza', Validators.required],
  });
  protected readonly price = this.fb.nonNullable.group({
    reservationId: ['', [Validators.required, Validators.pattern(uuid)]],
    dailyRate: ['', [Validators.required, Validators.pattern(moneyPattern)]],
    reason: ['', [Validators.required, Validators.pattern(/\S/), Validators.maxLength(500)]],
  });
  protected readonly payment = this.fb.nonNullable.group({
    amount: ['', [Validators.required, Validators.pattern(moneyPattern)]],
    occurredOn: [this.today, Validators.required],
    reference: ['', [Validators.required, Validators.pattern(/\S/), Validators.maxLength(120)]],
  });
  private readonly receiptKey = new RequestKey();
  private readonly entryKey = new RequestKey();

  /** Carrega o resumo financeiro e as reservas ao iniciar o componente. */
  ngOnInit(): void { void this.refresh(); }

  /** Formata o valor em reais e atualiza o campo preservando a posição do cursor. */
  protected maskMoney(event: Event, control: FormControl<string>): void {
    control.setValue(maskMoney(event.target as HTMLInputElement));
  }

  /** Informa se a tela está carregando, salvando ou bloqueada pelo componente pai. */
  private unavailable(): boolean { return this.loading() || this.saving() || this.disabled(); }

  /** Atualiza o resumo e as reservas do mês, além da lista da aba ativa. */
  protected async refresh(): Promise<void> {
    this.period.markAllAsTouched();
    if (this.period.invalid || this.unavailable()) return;
    await this.read(() => this.api.finance<FinanceOverview>('overview', {
      p_month: this.period.controls.month.value, p_reservation_page: this.reservationPage(),
    }), this.snapshot);
    if (this.tab() === 'expenses') await this.refreshExpenses();
    if (this.tab() === 'cancelled') await this.refreshCancelled();
  }

  /** Reinicia a paginação e as confirmações antes de consultar o mês selecionado. */
  protected async applyPeriod(): Promise<void> {
    this.expenseToDelete.set(null); this.expensePage.set(0); this.reservationPage.set(0); this.confirmation.set(null); await this.refresh();
  }

  /** Avança ou retrocede a página de reservas e recarrega os dados. */
  protected async changePage(delta: number): Promise<void> {
    if (this.unavailable()) return;
    this.reservationPage.update(value => Math.max(0, value + delta));
    this.confirmation.set(null); await this.refresh();
  }

  /** Abre a aba escolhida, limpa os avisos e consulta sua lista quando necessário. */
  protected async selectTab(type: 'entry' | 'price' | 'reservations' | 'cancelled' | 'expenses'): Promise<void> {
    if (this.unavailable()) return;
    this.notice.set(''); this.error.set(''); this.confirmation.set(null); this.expenseToDelete.set(null); this.tab.set(type);
    if (type === 'cancelled') await this.refreshCancelled();
    if (type === 'expenses') await this.refreshExpenses();
  }

  /** Consulta os registros cancelados com início no mês selecionado. */
  protected async refreshCancelled(): Promise<void> {
    this.period.markAllAsTouched();
    if (this.period.invalid || this.unavailable()) return;
    this.cancelled.set(null);
    await this.read(() => this.api.list('pre_reservas_canceladas', this.period.controls.month.value), this.cancelled,
      () => 'Não foi possível carregar os cancelados. Tente novamente.');
  }

  /** Consulta as despesas e o total mensal, respeitando a página atual. */
  protected async refreshExpenses(): Promise<void> {
    this.period.markAllAsTouched();
    if (this.period.invalid || this.unavailable()) return;
    this.expenses.set(null);
    await this.read(() => this.api.finance<ExpenseReport>('expenses', {
      p_month: this.period.controls.month.value, p_page: this.expensePage(),
    }), this.expenses, expenseError);
  }

  /** Muda a página de despesas e fecha a confirmação de exclusão. */
  protected async changeExpensePage(delta: number): Promise<void> {
    if (this.unavailable()) return;
    this.expenseToDelete.set(null); this.expensePage.update(value => Math.max(0, value + delta)); await this.refreshExpenses();
  }

  /** Solicita a exclusão da despesa selecionada e atualiza a lista e os totais após sucesso. */
  protected async deleteExpense(): Promise<void> {
    const expense = this.expenseToDelete();
    if (!expense || this.unavailable()) return;
    if (await this.write('delete_expense', { p_id: expense.id })) {
      this.expenseToDelete.set(null); this.expensePage.set(0);
      await this.refresh(); this.notice.set('Despesa excluída.');
    }
  }

  /** Valida e registra uma despesa, preservando a chave nos reenvios do mesmo lançamento. */
  protected async submitEntry(): Promise<void> {
    this.entry.markAllAsTouched();
    if (this.entry.invalid || this.unavailable()) return;
    const values = this.entry.getRawValue();
    const request = { ...values, kind: 'expense', amount: moneyValue(values.amount), description: values.description.trim() };
    if (await this.write('post', { p_input: { ...request, key: this.entryKey.forPayload(request) } })) {
      this.entryKey.clear(); this.entry.reset({ occurredOn: this.today, category: 'limpeza' });
      await this.refresh(); this.notice.set('Despesa registrada.');
    }
  }

  /** Valida e salva a diária negociada e seu motivo, depois retorna à aba de reservas. */
  protected async submitPrice(): Promise<void> {
    this.price.markAllAsTouched();
    if (this.price.invalid || this.unavailable()) return;
    const values = this.price.getRawValue();
    if (await this.write('negotiate', { p_id: values.reservationId, p_daily_rate: moneyValue(values.dailyRate), p_reason: values.reason.trim() })) {
      this.price.reset(); this.tab.set('reservations');
      await this.refresh(); this.notice.set('Valor negociado registrado.');
    }
  }

  /** Abre a reprovação e exige dados de devolução quando há saldo recebido. */
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

  /** Fecha a janela de reprovação quando não há gravação em andamento. */
  protected closeRejection(): void {
    if (this.saving()) return;
    this.rejecting.set(null); this.rejectionDialog().nativeElement.close();
  }

  /** Valida motivo e devolução, registra a reprovação e atualiza os dados da tela. */
  protected async submitRejection(): Promise<void> {
    this.rejection.markAllAsTouched();
    const row = this.rejecting();
    if (!row || this.rejection.invalid || this.unavailable()) return;
    const values = this.rejection.getRawValue();
    const request = { p_id: row.reservationId, p_reason: values.reason.trim(), p_refund_amount: String(row.refundableAmount),
      p_refund_date: row.refundableAmount > 0 ? values.refundDate : null,
      p_refund_reference: row.refundableAmount > 0 ? values.refundReference.trim() : null, p_checked: values.checked };
    if (await this.write('reject', { ...request, p_key: this.rejectionKey.forPayload(request) })) {
      this.rejectionKey.clear(); this.closeRejection();
      await this.refresh(); this.notice.set('Reserva reprovada. Motivo e eventual devolução registrados; consulte Cancelados.');
    }
  }

  /** Prepara o pagamento da reserva sem preencher automaticamente o valor recebido. */
  protected openPayment(row: FinanceReservation): void {
    this.payment.reset({ amount: '', occurredOn: this.today, reference: '' });
    this.error.set(''); this.notice.set('');
    this.confirmation.set({ row });
  }

  /** Registra o valor informado no Supabase; somente a quitação integral confirma a reserva. */
  protected async confirmReservation(): Promise<void> {
    const selected = this.confirmation();
    if (!selected || this.unavailable()) return;
    this.payment.markAllAsTouched();
    if (this.payment.invalid) return;
    const values = this.payment.getRawValue();
    const request = { p_id: selected.row.reservationId, p_amount: moneyValue(values.amount), p_occurred_on: values.occurredOn, p_reference: values.reference.trim() };
    const parameters = { ...request, p_key: this.receiptKey.forPayload(request) };
    if (await this.write('approve', parameters)) {
      this.receiptKey.clear();
      this.confirmation.set(null);
      await this.refresh();
      this.notice.set('Pagamento registrado pelo valor informado. A reserva será confirmada quando o total estiver quitado.');
    }
  }

  /** Executa uma consulta e controla seus dados, mensagem de erro e indicador de carregamento. */
  private async read<T>(request: () => Promise<T>, state: WritableSignal<T | null>, message = financeError): Promise<void> {
    this.loading.set(true); this.error.set('');
    try { state.set(await request()); }
    catch (error) { state.set(null); this.error.set(message(error)); }
    finally { this.loading.set(false); }
  }

  /** Executa uma gravação, notifica o painel e retorna se a operação teve sucesso. */
  private async write(action: FinanceAction, parameters: object): Promise<boolean> {
    this.saving.set(true); this.writing.emit(true); this.error.set(''); this.notice.set('');
    try { await this.api.finance(action, parameters); return true; }
    catch (error) { this.error.set(financeError(error)); return false; }
    finally { this.saving.set(false); this.writing.emit(false); }
  }
}
