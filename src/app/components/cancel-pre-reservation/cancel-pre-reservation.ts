import { ReservationSession } from '../../services/reservation-session';
import { SupabaseApi } from '../../services/supabase-api';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  output,
  signal,
} from '@angular/core';
import { reservationLink } from '../../services/reservation-link';
import { DOCUMENT } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize, timeout } from 'rxjs';
@Component({
  selector: 'app-cancel-pre-reservation',
  imports: [ReactiveFormsModule],
  templateUrl: './cancel-pre-reservation.html',
  styleUrl: './cancel-pre-reservation.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CancelPreReservation {
  readonly cancelled = output<string>();
  private readonly api = inject(SupabaseApi);
  private readonly destroyRef = inject(DestroyRef);
  private readonly document = inject(DOCUMENT);
  private readonly session = inject(ReservationSession);
  private readonly builder = inject(FormBuilder);
  protected readonly visible = signal(false);
  protected readonly sending = signal(false);
  protected readonly feedback = signal('');
  protected readonly success = signal(false);
  protected readonly form = this.builder.nonNullable.group({
    id: ['', Validators.required],
    token: ['', [Validators.required, Validators.pattern(/^[a-f0-9]{64}$/)]],
    confirm: [false, Validators.requiredTrue],
  });
  constructor() {
    afterNextRender(() => {
      const link = reservationLink(this.document, 'cancelar-pre-reserva');
      if (link) {
        this.form.patchValue(link);
        this.visible.set(true);
      }
    });
  }

  protected submit(): void {
    if (this.sending()) return;
    this.form.markAllAsTouched();
    this.feedback.set('');
    this.success.set(false);
    if (this.form.invalid) return;
    this.sending.set(true);
    const { id, token } = this.form.getRawValue();
    this.api
      .cancelReservation(id.trim(), token.trim())
      .pipe(
        timeout(15000),
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.sending.set(false)),
      )
      .subscribe({
        next: () => {
          this.success.set(true);
          this.feedback.set('Sua pré-reserva foi cancelada e o período foi liberado.');
          this.form.reset();
          this.session.clear(id);
          this.cancelled.emit(id);
        },
        error: (error) =>
          this.feedback.set(
            error.status === 404
              ? 'Confira o protocolo e o código de cancelamento. A pré-reserva pode já ter sido cancelada.'
              : 'Não foi possível cancelar. Seus dados foram preservados; tente novamente.',
          ),
      });
  }
}
