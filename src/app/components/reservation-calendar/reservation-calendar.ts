import { SupabaseApi } from '../../services/supabase-api';
import { DOCUMENT } from '@angular/common';
import { ContractUpload } from '../contract-upload/contract-upload';
import { CancelPreReservation } from '../cancel-pre-reservation/cancel-pre-reservation';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { interval, Subscription, timeout } from 'rxjs';
import { PreReservation } from '../pre-reservation/pre-reservation';
import { calendarDays, dateLabel, localNow } from './calendar-model';
import { Availability } from '../../services/booking.models';

@Component({
  selector: 'app-reservation-calendar',
  imports: [PreReservation, CancelPreReservation, ContractUpload],
  templateUrl: './reservation-calendar.html',
  styleUrl: './reservation-calendar.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReservationCalendar {
  private readonly preReservation = viewChild(PreReservation);
  private readonly document = inject(DOCUMENT);
  protected readonly linkAction = signal(false);
  private readonly api = inject(SupabaseApi);
  private readonly destroyRef = inject(DestroyRef);
  private request?: Subscription;
  protected readonly now = signal(localNow());
  protected readonly month = signal(this.now().date.slice(0, 7));
  protected readonly selected = signal(this.now().date);
  protected readonly data = signal<Availability | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal(false);
  protected readonly weekdays = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  protected readonly monthLabel = computed(() =>
    new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
      new Date(`${this.month()}-01T12:00:00Z`),
    ),
  );
  protected readonly selectedLabel = computed(() => dateLabel(this.selected()));
  protected readonly days = computed(() => calendarDays(this.month(), this.data(), this.now()));
  private readonly selectedDay = computed(() =>
    this.days().find((day) => day.date === this.selected()),
  );
  protected readonly selectedFree = computed(
    () => this.selectedDay()?.status === 'free' && !this.selectedDay()?.past,
  );
  protected readonly unavailableReason = computed(() => {
    const day = this.selectedDay();
    if (day?.status === 'pre_reserved') return 'Pré-reservado, aguardando confirmação do pagamento. Escolha outra data livre no calendário.';
    if (day?.status === 'reserved') return 'Reservado. Escolha outra data livre no calendário.';
    if (day?.past) return 'Indisponível. Escolha uma data futura.';
    return 'Disponibilidade não consultada. Atualize a agenda antes de reservar.';
  });

  constructor() {
    afterNextRender(() => {
      this.linkAction.set(
        /^#(cancelar-pre-reserva|enviar-contrato|contrato-enviado)/.test(
          this.document.defaultView?.location.hash || '',
        ),
      );
      this.load();
      interval(30000)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe(() => this.load());
    });
  }
  protected onCancelled(id: string): void {
    this.preReservation()?.clearCancelledReceipt(id);
    this.load();
  }

  protected openReservation(): void {
    if (!this.selectedFree()) return;
    this.linkAction.set(false);
    this.preReservation()?.openForDate(this.selected());
  }

  protected changeMonth(direction: number): void {
    const [year, month] = this.month().split('-').map(Number);
    const next = new Date(Date.UTC(year, month - 1 + direction, 1)).toISOString().slice(0, 7);
    if (next < this.now().date.slice(0, 7)) return;
    this.month.set(next);
    this.selected.set(next === this.now().date.slice(0, 7) ? this.now().date : `${next}-01`);
    this.load();
  }
  protected select(date: string): void {
    this.selected.set(date);
    this.now.set(localNow());
  }
  protected load(): void {
    this.request?.unsubscribe();
    this.now.set(localNow());
    this.loading.set(true);
    this.error.set(false);
    this.data.set(null);
    this.request = this.api
      .availability(this.month())
      .pipe(timeout(10000), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          this.data.set(data);
          this.loading.set(false);
        },
        error: () => {
          this.error.set(true);
          this.loading.set(false);
        },
      });
  }
}
