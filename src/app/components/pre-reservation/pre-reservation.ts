import { DOCUMENT } from '@angular/common';
import { afterNextRender, ChangeDetectionStrategy, Component, DestroyRef, effect, inject, input, output, signal } from '@angular/core';
import { FormSubmitDelivery, FormSubmitSubmission } from '../../services/formsubmit-delivery';
import { HttpClient } from '@angular/common/http';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize, timeout } from 'rxjs';
import { DateTime } from 'luxon';

export function reservationPeriod(control: AbstractControl): ValidationErrors | null {
  const { startDate, endDate } = control.value;
  const startTime = '08:00';
  const endTime = '08:00';
  if (!startDate || !startTime || !endDate || !endTime) return null;
  const start = DateTime.fromISO(`${startDate}T${startTime}`, { zone: 'America/Sao_Paulo' });
  const end = DateTime.fromISO(`${endDate}T${endTime}`, { zone: 'America/Sao_Paulo' });
  if (!start.isValid || !end.isValid) return { invalidPeriod: true };
  if (start.toMillis() <= Date.now()) return { pastStart: true };
  return end.toMillis() - start.toMillis() < 24 * 60 * 60 * 1000 ? { minimumPeriod: true } : null;
}
interface Receipt { submission?: FormSubmitSubmission | null; id: string; status: string; startAt: string; endAt: string; cancellationToken: string; notifications?: { customer?: { status: string }; manager?: { status: string } }; links?: { contract: string | null; pix: string | null }; }
@Component({
  selector: 'app-pre-reservation',
  imports: [ReactiveFormsModule],
  templateUrl: './pre-reservation.html',
  styleUrl: './pre-reservation.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PreReservation {
  readonly selectedDate = input('');
  readonly created = output<void>();
  private readonly delivery = inject(FormSubmitDelivery);
  private readonly document = inject(DOCUMENT);
  private readonly receiptKey = 'familia-tx-pre-reservation';
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);
  private readonly builder = inject(FormBuilder);
  protected readonly ready = signal(false);
  protected readonly sending = signal(false);
  protected readonly attempted = signal(false);
  protected readonly error = signal('');
  protected readonly receipt = signal<Receipt | null>(null);
  protected readonly today = DateTime.now().setZone('America/Sao_Paulo').toISODate()!;
  protected readonly form = this.builder.nonNullable.group({
    name: ['', [Validators.required, Validators.pattern(/\S/), Validators.minLength(2), Validators.maxLength(120)]],
    phone: ['', [Validators.required, Validators.pattern(/^(?=(?:\D*\d){10,15}\D*$)[+()\d\s.-]+$/), Validators.maxLength(30)]],
    email: ['', [Validators.required, Validators.email, Validators.maxLength(254)]],
    startDate: ['', Validators.required],
    endDate: ['', Validators.required],
  }, { validators: reservationPeriod });

  constructor() {
    afterNextRender(() => { this.restoreReceipt(); this.ready.set(true); });
    effect(() => {
      const date = this.selectedDate();
      if (date && !this.form.controls.startDate.dirty && !this.sending()) {
        this.form.patchValue({ startDate: date, endDate: DateTime.fromISO(date).plus({ days: 1 }).toISODate()! });
      }
    });
  }
  protected invalid(field: keyof typeof this.form.controls): boolean { const control = this.form.controls[field]; return control.invalid && control.touched; }
  private saveReceipt(receipt: Receipt): void {
    try { this.document.defaultView?.sessionStorage.setItem(this.receiptKey, JSON.stringify(receipt)); } catch { /* The visible protocol remains available if storage is disabled. */ }
  }
  private restoreReceipt(): void {
    try {
      const saved = this.document.defaultView?.sessionStorage.getItem(this.receiptKey);
      if (!saved) return;
      const receipt = JSON.parse(saved) as Receipt;
      if (typeof receipt.id === 'string' && typeof receipt.cancellationToken === 'string') this.receipt.set(receipt);
      else this.document.defaultView?.sessionStorage.removeItem(this.receiptKey);
    } catch { /* Ignore invalid or unavailable local storage. */ }
  }
  private forward(receipt: Receipt): void {
    if (!receipt.submission) { this.error.set('Pré-reserva registrada. Não foi possível preparar o FormSubmit; guarde o protocolo e fale com a equipe.'); return; }
    try { this.delivery.submit(receipt.submission); }
    catch { this.error.set('Pré-reserva registrada. Clique em continuar envio para concluir a verificação no FormSubmit.'); }
  }
  protected resumeNotification(): void {
    const receipt = this.receipt();
    if (!receipt || this.sending()) return;
    this.sending.set(true); this.error.set('');
    this.http.get<{ submission: FormSubmitSubmission }>(`/api/pre-reservations/${encodeURIComponent(receipt.id)}/notification-form`, { headers: { 'X-Cancellation-Token': receipt.cancellationToken } }).pipe(timeout(15000), takeUntilDestroyed(this.destroyRef), finalize(() => this.sending.set(false))).subscribe({
      next: response => { const next = { ...receipt, submission: response.submission }; this.receipt.set(next); this.saveReceipt(next); this.forward(next); },
      error: () => this.error.set('Não foi possível continuar o envio. Consulte a agenda ou fale com a equipe antes de tentar novamente.'),
    });
  }
  protected submit(): void {
    if (this.sending()) return;
    this.attempted.set(true);
    this.error.set('');
    this.form.markAllAsTouched();
    this.form.updateValueAndValidity();
    if (this.form.invalid) return;
    this.receipt.set(null);
    this.sending.set(true);
    const values = Object.fromEntries(Object.entries(this.form.getRawValue()).map(([key, value]) => [key, value.trim()]));
    this.http.post<Receipt>('/api/pre-reservations', values).pipe(timeout(30000), takeUntilDestroyed(this.destroyRef), finalize(() => this.sending.set(false))).subscribe({
      next: receipt => {
        this.receipt.set(receipt);
        this.saveReceipt(receipt);
        this.form.reset();
        this.attempted.set(false);
        this.created.emit();
        this.forward(receipt);
      },
      error: error => {
        this.error.set(error.status === 409 ? 'Esse período acabou de ficar indisponível. Escolha outras datas ou horários.' : error.status === 429 ? 'Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente.' : error.status === 400 ? 'Confira os dados e escolha um período futuro de pelo menos 24 horas.' : 'Não foi possível confirmar o registro da pré-reserva. Atualize a agenda antes de tentar novamente.');
        this.created.emit();
      },
    });
  }
}
