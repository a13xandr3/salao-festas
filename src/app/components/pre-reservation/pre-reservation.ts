import { maskPhone } from '../../shared/formats/input-masks';
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

/** Valida datas futuras e exige pelo menos 24 horas no fuso de São Paulo. */
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

/** Converte o status HTTP em uma mensagem de erro adequada à pré-reserva. */
function reservationError(status: number): string {
  return (
    reservationErrors[status] ??
    'Não foi possível confirmar o registro da pré-reserva. Atualize a agenda antes de tentar novamente.'
  );
}

/** Controla o formulário, o recibo e a solicitação de e-mail da pré-reserva. */
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

  /** Restaura o recibo do cliente e sincroniza o formulário com a data escolhida. */
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
  /** Prepara uma nova solicitação para a data escolhida, preservando a reserva já enviada. */
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

  /** Descarta o recibo cancelado, interrompe sua notificação e oculta o formulário. */
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

  /** Fecha o modal de sucesso quando ele está aberto. */
  protected closeSuccess(): void {
    const dialog = this.successDialog().nativeElement;
    if (!dialog.open) return;
    dialog.close();
  }

  /** Formata o telefone digitado e atualiza o campo do formulário. */
  protected maskPhone(event: Event): void {
    this.form.controls.phone.setValue(maskPhone(event.target as HTMLInputElement));
  }

  /** Indica se o campo já foi tocado e contém um valor inválido. */
  protected invalid(field: keyof typeof this.form.controls): boolean {
    const control = this.form.controls[field];
    return control.invalid && control.touched;
  }
  /** Solicita o e-mail da reserva gravada e descarta recibos que o servidor considera inválidos. */
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

  /** Tenta novamente a notificação usando o recibo atual. */
  protected resumeNotification(): void {
    const receipt = this.receipt();
    if (receipt) this.forward(receipt);
  }

  /** Valida e grava a pré-reserva; depois solicita o e-mail e mostra o modal de sucesso. */
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
