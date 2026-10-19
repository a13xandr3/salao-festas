import { DOCUMENT } from '@angular/common';
import { ContractUpload } from '../contract-upload/contract-upload';
import { CancelPreReservation } from '../cancel-pre-reservation/cancel-pre-reservation';
import { afterNextRender, ChangeDetectionStrategy, Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { interval, Subscription, timeout } from 'rxjs';
import { PreReservation } from '../pre-reservation/pre-reservation';
import { Availability, localNow, monthDays } from './calendar-model';

@Component({
  selector: 'app-reservation-calendar',
  imports: [PreReservation, CancelPreReservation, ContractUpload],
  templateUrl: './reservation-calendar.html',
  styleUrl: './reservation-calendar.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReservationCalendar {
  private readonly document = inject(DOCUMENT);
  protected readonly linkAction = signal(false);
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);
  private request?: Subscription;
  protected readonly now = signal(localNow());
  protected readonly month = signal(this.now().date.slice(0, 7));
  protected readonly selected = signal(this.now().date);
  protected readonly data = signal<Availability | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal(false);
  protected readonly weekdays = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  protected readonly monthLabel = computed(() => new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${this.month()}-01T12:00:00Z`)));
  protected readonly selectedLabel = computed(() => this.label(this.selected()));
  protected readonly days = computed(() => monthDays(this.month()).map(date => {
    if (!date) return { date: '', number: '', status: 'unknown', past: true, description: '' };
    const status = this.data() ? this.data()!.days?.find(day => day.date === date)?.status ?? 'unknown' : 'unknown';
    const past = date < this.now().date || (date === this.now().date && this.now().time >= '08:00');
    return { date, number: String(Number(date.slice(8))), status, past, description: `${this.label(date)}: ${status === 'reserved' ? 'Reservado' : status === 'free' ? 'Livre' : 'disponibilidade não consultada'}` };
  }));
  protected readonly selectedFree = computed(() => this.days().some(day => day.date === this.selected() && day.status === 'free' && !day.past));
  protected readonly selectedReserved = computed(() => this.days().some(day => day.date === this.selected() && day.status === 'reserved'));

  constructor() {
    afterNextRender(() => {
      this.linkAction.set(/^#(cancelar-pre-reserva|enviar-contrato|contrato-enviado)/.test(this.document.defaultView?.location.hash || ''));
      this.load();
      interval(30000).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.load());
    });
  }
  protected label(date: string): string {
    return new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
  }
  protected changeMonth(direction: number): void {
    const [year, month] = this.month().split('-').map(Number);
    const next = new Date(Date.UTC(year, month - 1 + direction, 1)).toISOString().slice(0, 7);
    if (next < this.now().date.slice(0, 7)) return;
    this.month.set(next);
    this.selected.set(next === this.now().date.slice(0, 7) ? this.now().date : `${next}-01`);
    this.load();
  }
  protected select(date: string): void { this.selected.set(date); this.now.set(localNow()); }
  protected load(): void {
    this.request?.unsubscribe();
    this.now.set(localNow());
    this.loading.set(true);
    this.error.set(false);
    this.data.set(null);
    this.request = this.http.get<Availability>('/api/availability', { params: { month: this.month() } }).pipe(timeout(10000), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: data => { this.data.set(data); this.loading.set(false); },
      error: () => { this.error.set(true); this.loading.set(false); },
    });
  }
}
