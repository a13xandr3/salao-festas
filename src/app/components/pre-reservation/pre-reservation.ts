import { ReservationSession } from '../../services/reservation-session';
import { ReservationReceipt } from '../../services/booking.models';
import { SupabaseApi } from '../../services/supabase-api';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { EmailService } from '../../shared/email/email.service';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize, Subscription, timeout } from 'rxjs';
import { DateTime } from 'luxon';

export function reservationPeriod(control: AbstractControl): ValidationErrors | null {
  const { startDate, endDate } = control.value;
  const startTime = '08:00';
  const endTime = '08:00';
  if (!startDate || !endDate) return null;
  const start = DateTime.fromISO(`${startDate}T${startTime}`, { zone: 'America/Sao_Paulo' });
  const end = DateTime.fromISO(`${endDate}T${endTime}`, { zone: 'America/Sao_Paulo' });
  if (!start.isValid || !end.isValid) return { invalidPeriod: true };
  if (start.toMillis() <= Date.now()) return { pastStart: true };
  return end.toMillis() - start.toMillis() < 24 * 60 * 60 * 1000 ? { minimumPeriod: true } : null;
}

const reservationErrors: Record<number, string> = {
  400: 'Confira os dados e escolha um período futuro de pelo menos 24 horas.',
  409: 'Esse período acabou de ficar indisponível. Escolha outras datas ou horários.',
  429: 'Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente.',
};

function reservationError(status: number): string {
  return (
    reservationErrors[status] ??
    'Não foi possível confirmar o registro da pré-reserva. Atualize a agenda antes de tentar novamente.'
  );
}

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
  private readonly successDialog =
    viewChild.required<ElementRef<HTMLDialogElement>>('successDialog');
  private readonly delivery = inject(EmailService);
  private readonly session = inject(ReservationSession);
  private readonly api = inject(SupabaseApi);
  private readonly destroyRef = inject(DestroyRef);
  private readonly builder = inject(FormBuilder);
  private notification?: Subscription;
  protected readonly ready = signal(false);
  protected readonly formVisible = signal(true);
  protected readonly sending = signal(false);
  protected readonly attempted = signal(false);
  protected readonly error = signal('');
  protected readonly receipt = signal<ReservationReceipt | null>(null);
  protected readonly today = DateTime.now().setZone('America/Sao_Paulo').toISODate()!;
  protected readonly form = this.builder.nonNullable.group(
    {
      name: [
        '',
        [
          Validators.required,
          Validators.pattern(/\S/),
          Validators.minLength(2),
          Validators.maxLength(120),
        ],
      ],
      phone: [
        '',
        [
          Validators.required,
          Validators.pattern(/^(?=(?:\D*\d){10,15}\D*$)[+()\d\s.-]+$/),
          Validators.maxLength(30),
        ],
      ],
      email: ['', [Validators.required, Validators.email, Validators.maxLength(254)]],
      startDate: ['', Validators.required],
      endDate: ['', Validators.required],
    },
    { validators: reservationPeriod },
  );

  constructor() {
    afterNextRender(() => {
      const receipt = this.session.read();
      this.receipt.set(receipt);
      this.formVisible.set(!receipt);
      this.ready.set(true);
      if (receipt) this.forward(receipt);
    });
    effect(() => {
      const date = this.selectedDate();
      if (date && !this.form.controls.startDate.dirty && !this.sending()) {
        this.form.patchValue({
          startDate: date,
          endDate: DateTime.fromISO(date).plus({ days: 1 }).toISODate()!,
        });
      }
    });
  }
  openForDate(date: string): void {
    if (this.sending()) return;
    const receipt = this.receipt();
    if (
      receipt &&
      date === DateTime.fromISO(receipt.startAt).setZone('America/Sao_Paulo').toISODate()
    )
      return;
    if (receipt) this.session.clear(receipt.id);
    this.receipt.set(null);
    this.error.set('');
    this.attempted.set(false);
    this.form.reset({
      startDate: date,
      endDate: DateTime.fromISO(date).plus({ days: 1 }).toISODate()!,
    });
    this.formVisible.set(true);
  }

  clearCancelledReceipt(id: string): void {
    if (this.receipt()?.id !== id) return;
    this.notification?.unsubscribe();
    this.session.clear(id);
    this.receipt.set(null);
    this.error.set('');
    this.sending.set(false);
    this.formVisible.set(false);
    this.attempted.set(false);
    this.form.reset();
  }

  protected closeSuccess(): void {
    const dialog = this.successDialog().nativeElement;
    if (!dialog.open) return;
    dialog.close();
  }

  protected maskPhone(event: Event): void {
    const input = event.target as HTMLInputElement;
    const digitsBeforeCursor = input.value.slice(0, input.selectionStart!).replace(/\D/g, '').length;
    const digits = input.value.replace(/\D/g, '').slice(0, 11);
    const split = digits.length > 10 ? 7 : 6;
    let formatted = digits ? `(${digits.slice(0, 2)}` : '';
    if (digits.length >= 2) formatted += ')';
    if (digits.length > 2) formatted += ` ${digits.slice(2, split)}`;
    if (digits.length > split) formatted += `-${digits.slice(split)}`;
    input.value = formatted;
    this.form.controls.phone.setValue(formatted);
    const position = [...formatted].reduce((cursor, character, index) =>
      /\d/.test(character) && formatted.slice(0, index + 1).replace(/\D/g, '').length <= digitsBeforeCursor
        ? index + 1 : cursor, 0);
    input.setSelectionRange(position, position);
  }

  protected invalid(field: keyof typeof this.form.controls): boolean {
    const control = this.form.controls[field];
    return control.invalid && control.touched;
  }
  private forward(receipt: ReservationReceipt): void {
    if (this.sending()) return;
    this.sending.set(true);
    this.error.set('');
    this.notification = this.delivery
      .send({ kind: 'reservation', id: receipt.id, token: receipt.cancellationToken })
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.sending.set(false)),
      )
      .subscribe({
        error: (error: { status?: number }) => {
          if (error.status === 404 || error.status === 409) {
            this.clearCancelledReceipt(receipt.id);
            return;
          }
          this.error.set('Não foi possível confirmar o envio do e-mail. Tente novamente.');
        },
      });
  }

  protected resumeNotification(): void {
    const receipt = this.receipt();
    if (receipt) this.forward(receipt);
  }

  protected submit(): void {
    if (this.sending() || !this.formVisible()) return;
    this.attempted.set(true);
    this.error.set('');
    this.form.markAllAsTouched();
    this.form.updateValueAndValidity();
    if (this.form.invalid) return;
    this.receipt.set(null);
    this.sending.set(true);
    const values = this.form.getRawValue();
    this.api
      .createReservation(values)
      .pipe(timeout(30000), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (receipt) => {
          this.receipt.set(receipt);
          this.session.save(receipt);
          this.formVisible.set(false);
          this.form.reset();
          this.attempted.set(false);
          this.sending.set(false);
          this.forward(receipt);
          this.created.emit();
          this.successDialog().nativeElement.showModal();
        },
        error: (error) => {
          this.sending.set(false);
          this.error.set(reservationError(error.status));
          this.created.emit();
        },
      });
  }
}
