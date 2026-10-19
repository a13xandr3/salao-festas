import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ReservationCalendar } from './reservation-calendar';

describe('ReservationCalendar', () => {
  beforeEach(async () => {
    jest.useFakeTimers(); jest.setSystemTime(new Date('2028-02-10T10:00:00Z'));
    await TestBed.configureTestingModule({ imports: [ReservationCalendar], providers: [provideHttpClient(), provideHttpClientTesting()] }).compileComponents();
  });
  afterEach(() => { TestBed.inject(HttpTestingController).verify(); jest.useRealTimers(); });
  function setup() {
    const fixture = TestBed.createComponent(ReservationCalendar); fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    const element = fixture.nativeElement as HTMLElement;
    const respond = (reservations: { date: string; start: string; end: string }[] = [], month = '2028-02') => {
      const request = http.expectOne(req => req.url === '/api/availability' && req.params.get('month') === month);
      const total = new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 0).getDate();
      const days = Array.from({ length: total }, (_, i) => { const date = `${month}-${String(i + 1).padStart(2, '0')}`; return { date, status: reservations.some(item => item.date === date) ? 'reserved' : 'free' }; });
      request.flush({ days, month, timeZone: 'America/Sao_Paulo', opensAt: '08:00', closesAt: '12:00', slotMinutes: 60, reservations }); fixture.detectChanges();
    };
    return { fixture, http, element, respond };
  }
  it('labels dates Livre and Reservado without showing an hourly grid', () => {
    const { respond, element, fixture } = setup();
    respond([{ date: '2028-02-10', start: '08:00', end: '24:00' }]);
    expect(element.querySelector('.calendar-day.selected')?.classList).toContain('full');
    expect(element.querySelector('.calendar-day.selected')?.textContent).toContain('Reservado');
    expect(element.querySelector('.slot-list')).toBeNull();
    (element.querySelector('.calendar-day[aria-label*="11 de fevereiro"]') as HTMLButtonElement).click(); fixture.detectChanges();
    expect(element.querySelector('.calendar-day.selected')?.textContent).toContain('Livre');
    expect(element.querySelector('.day-details')?.textContent).toContain('Fazer pré-reserva nesta data');
  });
  it('does not mark days available if loading fails and offers a retry', () => {
    const { element, http, fixture, respond } = setup();
    http.expectOne(req => req.url === '/api/availability').flush({}, { status: 503, statusText: 'Unavailable' }); fixture.detectChanges();
    expect(element.textContent).toContain('Não foi possível consultar');
    expect(element.querySelectorAll('.calendar-day.free')).toHaveLength(0);
    element.querySelector<HTMLButtonElement>('.refresh-button')!.click(); fixture.detectChanges(); respond();
    expect(element.querySelectorAll('.calendar-day.free').length).toBeGreaterThan(0);
  });
  it('navigates month boundaries and prevents access to past months', () => {
    const { respond, element, fixture } = setup(); respond();
    expect(element.querySelector<HTMLButtonElement>('[aria-label="Mês anterior"]')!.disabled).toBe(true);
    element.querySelector<HTMLButtonElement>('[aria-label="Próximo mês"]')!.click(); fixture.detectChanges(); respond([], '2028-03');
    expect(element.querySelector('.month-navigation h3')?.textContent).toContain('março');
    expect(element.querySelector<HTMLButtonElement>('[aria-label="Mês anterior"]')!.disabled).toBe(false);
  });
});
