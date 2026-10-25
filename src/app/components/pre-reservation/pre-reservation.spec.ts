import { provideTestConfig, rpcUrl, testReservation } from '../../testing/supabase';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { EmailService } from '../../shared/email/email.service';
import { of, Subject, throwError } from 'rxjs';
import { FormControl, FormGroup } from '@angular/forms';
import { PreReservation, reservationPeriod } from './pre-reservation';

const dialogIsOpen = (element: HTMLElement) =>
  element.querySelector('dialog')!.hasAttribute('open');

describe('PreReservation', () => {

  beforeEach(async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2028-02-01T12:00:00Z'));
    await TestBed.configureTestingModule({
      imports: [PreReservation],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTestConfig(),
        { provide: EmailService, useValue: { send: jest.fn(() => of({ sent: true })) } },
      ],
    }).compileComponents();
  });
  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
    sessionStorage.clear();
    jest.useRealTimers();
  });
  function setup() {
    const fixture = TestBed.createComponent(PreReservation);
    fixture.componentRef.setInput('selectedDate', '2028-02-28');
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const dialog = element.querySelector<HTMLDialogElement>('dialog')!;
    dialog.showModal = jest.fn(() => dialog.setAttribute('open', ''));
    dialog.close = jest.fn(() => dialog.removeAttribute('open'));
    const fill = (endDate = '2028-02-29') => {
      for (const [id, value] of Object.entries({
        name: 'Maria Silva',
        phone: '(11) 99999-9999',
        email: 'maria@example.com',
        'start-date': '2028-02-28',
        'end-date': endDate,
      })) {
        const input = element.querySelector<HTMLInputElement>(`#pre-${id}`)!;
        input.value = value;
        input.dispatchEvent(new Event('input'));
      }
      fixture.detectChanges();
    };
    const submit = () => {
      element
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      fixture.detectChanges();
    };
    return { fixture, element, fill, submit, http: TestBed.inject(HttpTestingController) };
  }
  it('uses the selected calendar date and defaults the end to the next day', () => {
    const { element } = setup();
    expect(element.querySelector<HTMLInputElement>('#pre-start-date')!.value).toBe('2028-02-28');
    expect(element.querySelector<HTMLInputElement>('#pre-end-date')!.value).toBe('2028-02-29');
  });
  it('blocks missing customer fields and periods shorter than 24 hours', () => {
    const { submit, http, element, fill } = setup();
    submit();
    http.expectNone(rpcUrl('booking_create_reservation'));
    expect(element.querySelectorAll('.invalid-feedback')).toHaveLength(3);
    fill('2028-02-28');
    submit();
    http.expectNone(rpcUrl('booking_create_reservation'));
    expect(element.textContent).toContain('pelo menos uma diária');
  });
  it('accepts exactly 24 hours, prevents double submits and keeps reservation details out of the page', () => {
    const { submit, http, element, fill, fixture } = setup();
    fill();
    submit();
    submit();
    const request = http.expectOne(rpcUrl('booking_create_reservation'));
    expect(TestBed.inject(EmailService).send).not.toHaveBeenCalled();
    expect(request.request.method).toBe('POST');
    expect(request.request.body.p_input.startDate).toBe('2028-02-28');
    expect(element.querySelector<HTMLButtonElement>('button')!.disabled).toBe(true);
    request.flush({ ...testReservation, id: 'test-protocol' });
    fixture.detectChanges();
    expect(element.querySelector('.alert-success')).toBeNull();
    expect(element.textContent).not.toContain('Baixar contrato PDF');
    expect(element.textContent).not.toContain('Consultar Pix');
    expect(element.querySelector('form')).toBeNull();
    expect(element.querySelector('app-cancel-pre-reservation')).toBeNull();
    expect(element.textContent).not.toContain('test-protocol');
    expect(dialogIsOpen(element)).toBe(true);
    expect(element.textContent).toContain('Pré-reserva feita com sucesso.');
    expect(TestBed.inject(EmailService).send).toHaveBeenCalledTimes(1);
    element.querySelector<HTMLButtonElement>('dialog button')!.click();
    fixture.detectChanges();
    expect(dialogIsOpen(element)).toBe(false);
    expect(element.querySelector('form')).toBeNull();
    expect(TestBed.inject(EmailService).send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(sessionStorage.getItem('familia-tx-pre-reservation')!).id).toBe(
      'test-protocol',
    );
  });
  it('does not impose a maximum stay and preserves the form on conflicts', () => {
    const { submit, http, element, fill, fixture } = setup();
    fill('2030-03-01');
    submit();
    http
      .expectOne(rpcUrl('booking_create_reservation'))
      .flush({}, { status: 409, statusText: 'Conflict' });
    fixture.detectChanges();
    expect(element.textContent).toContain('acabou de ficar indisponível');
    expect(element.querySelector<HTMLInputElement>('#pre-name')!.value).toBe('Maria Silva');
  });
  it('keeps the form hidden after a previous success until another date is requested', () => {
    sessionStorage.setItem(
      'familia-tx-pre-reservation',
      JSON.stringify({
        ...testReservation,
        cancellationToken: testReservation.notificationToken,
        links: { contract: 'https://example.com/contract.pdf', pix: 'https://example.com/pix' },
      }),
    );
    const { element } = setup();
    expect(TestBed.inject(EmailService).send).toHaveBeenCalledWith(expect.objectContaining({
      id: testReservation.id, token: testReservation.notificationToken,
    }));
    expect(element.querySelector('form')).toBeNull();
    expect(dialogIsOpen(element)).toBe(false);
    expect(element.querySelector('.alert-success')).toBeNull();
    expect(element.textContent).not.toContain(testReservation.id);
  });

  it('opens a fresh form for another date after submitting without redisplaying the receipt', () => {
    const { submit, http, fill, fixture, element } = setup();
    fill();
    submit();
    http.expectOne(rpcUrl('booking_create_reservation')).flush(testReservation);
    fixture.detectChanges();
    expect(element.querySelector('form')).toBeNull();
    element.querySelector<HTMLButtonElement>('dialog button')!.click();
    fixture.componentInstance.openForDate('2028-02-28');
    fixture.detectChanges();
    expect(element.querySelector('form')).toBeNull();
    fixture.componentRef.setInput('selectedDate', '2028-03-02');
    fixture.detectChanges();
    expect(element.querySelector('form')).toBeNull();
    fixture.componentInstance.openForDate('2028-03-02');
    fixture.detectChanges();
    expect(element.querySelector<HTMLInputElement>('#pre-start-date')!.value).toBe('2028-03-02');
    expect(element.querySelector<HTMLInputElement>('#pre-end-date')!.value).toBe('2028-03-03');
    expect(element.querySelector<HTMLInputElement>('#pre-name')!.value).toBe('');
    expect(sessionStorage.getItem('familia-tx-pre-reservation')).toBeNull();
  });

  it('offers a retry without exposing details or creating another reservation if forwarding fails', () => {
    const delivery = TestBed.inject(EmailService).send as jest.Mock;
    delivery.mockReturnValueOnce(throwError(() => new Error('SMTP unavailable')));
    const { submit, http, fill, fixture, element } = setup();
    fill();
    submit();
    http.expectOne(rpcUrl('booking_create_reservation')).flush(testReservation);
    fixture.detectChanges();
    expect(element.querySelector('form')).toBeNull();
    expect(element.textContent).not.toContain(testReservation.id);
    element.querySelector<HTMLButtonElement>('dialog button')!.click();
    fixture.detectChanges();
    const retry = element.querySelector<HTMLButtonElement>('.btn-outline-dark')!;
    expect(retry.textContent).toContain('Tentar enviar');
    retry.click();
    fixture.detectChanges();
    http.expectNone(rpcUrl('booking_create_reservation'));
    expect(delivery).toHaveBeenCalledTimes(2);
    expect(element.querySelector('.alert-success')).toBeNull();
  });
  it('does not email after a database failure', () => {
    const { submit, http, fill } = setup();
    fill();
    submit();
    http.expectOne(rpcUrl('booking_create_reservation')).flush({}, { status: 503, statusText: 'Unavailable' });
    expect(TestBed.inject(EmailService).send).not.toHaveBeenCalled();
  });

  it('keeps the new reservation locked while queue acknowledgement is pending', () => {
    const pending = new Subject<{ sent: boolean; queued: boolean }>();
    const delivery = TestBed.inject(EmailService).send as jest.Mock;
    delivery.mockReturnValue(pending);
    const { submit, http, fill, fixture, element } = setup();
    fill();
    submit();
    http.expectOne(rpcUrl('booking_create_reservation')).flush(testReservation);
    fixture.detectChanges();
    expect(delivery).toHaveBeenCalledTimes(1);
    fixture.componentInstance.openForDate('2028-03-02');
    fixture.detectChanges();
    expect(element.querySelector('form')).toBeNull();
    pending.next({ sent: false, queued: true });
    pending.complete();
    element.querySelector<HTMLButtonElement>('dialog button')!.click();
    fixture.componentInstance.openForDate('2028-03-02');
    fixture.detectChanges();
    expect(element.querySelector('form')).not.toBeNull();
    expect(delivery).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid dates and accepts incomplete periods for required-field validation', () => {
    const group = (startDate: string, endDate: string) => new FormGroup({ startDate: new FormControl(startDate), endDate: new FormControl(endDate) });
    expect(reservationPeriod(group('', '2028-03-01'))).toBeNull();
    expect(reservationPeriod(group('invalid', '2028-03-01'))).toEqual({ invalidPeriod: true });
    expect(reservationPeriod(group('2028-03-01', 'invalid'))).toEqual({ invalidPeriod: true });
    expect(reservationPeriod(group('2028-01-01', '2028-03-01'))).toEqual({ pastStart: true });
  });
  it('ignores retry and closing requests when no receipt or open dialog exists', () => {
    const { fixture, element } = setup();
    fixture.componentInstance['resumeNotification']();
    fixture.componentInstance['closeSuccess']();
    expect(TestBed.inject(EmailService).send).not.toHaveBeenCalled();
    expect(element.querySelector('dialog')!.close).not.toHaveBeenCalled();
  });
  it('does not duplicate forwarding while an email acknowledgement is pending', () => {
    const pending = new Subject<{ sent: boolean }>();
    (TestBed.inject(EmailService).send as jest.Mock).mockReturnValue(pending);
    const { fill, submit, http, fixture } = setup();
    fill(); submit(); http.expectOne(rpcUrl('booking_create_reservation')).flush(testReservation);
    fixture.componentInstance['resumeNotification']();
    expect(TestBed.inject(EmailService).send).toHaveBeenCalledTimes(1);
    pending.next({ sent: true }); pending.complete();
  });
  it.each([400, 429])('reports the reservation-specific HTTP %s error', (status) => {
    const { fill, submit, http, fixture, element } = setup();
    fill(); submit(); http.expectOne(rpcUrl('booking_create_reservation')).flush({}, { status, statusText: 'Failure' });
    fixture.detectChanges();
    expect(element.textContent).toContain(status === 400 ? 'Confira os dados' : 'Muitas tentativas');
    expect(element.querySelector('form')).not.toBeNull();
  });

  function saveReceipt() {
    sessionStorage.setItem('familia-tx-pre-reservation', JSON.stringify({
      ...testReservation,
      cancellationToken: testReservation.notificationToken,
      links: { contract: 'https://example.com/contract.pdf', pix: 'https://example.com/pix' },
    }));
  }
  it.each([404, 409])('discards stale receipt after HTTP %s and does not retry it on refresh', (status) => {
    saveReceipt();
    const delivery = TestBed.inject(EmailService).send as jest.Mock;
    delivery.mockReturnValueOnce(throwError(() => ({ status })));
    const { fixture, element } = setup();
    expect(sessionStorage.getItem('familia-tx-pre-reservation')).toBeNull();
    expect(element.querySelector('.alert-danger')).toBeNull();
    expect(element.querySelector('.btn-outline-dark')).toBeNull();
    fixture.componentInstance.openForDate('2028-02-28'); fixture.detectChanges();
    expect(element.querySelector('form')).not.toBeNull();
    fixture.destroy(); delivery.mockClear();
    const refreshed = setup();
    expect(delivery).not.toHaveBeenCalled();
    expect(refreshed.element.querySelector('.alert-danger')).toBeNull();
  });
  it('hides the notice and retry button while retrying and keeps them hidden after acknowledgement', () => {
    saveReceipt();
    const delivery = TestBed.inject(EmailService).send as jest.Mock;
    const pending = new Subject<{ sent: boolean; queued: boolean }>();
    delivery.mockReturnValueOnce(throwError(() => ({ status: 503 }))).mockReturnValueOnce(pending);
    const { fixture, element, http } = setup();
    expect(element.textContent).toContain('Não foi possível confirmar o envio');
    expect(element.textContent).not.toContain('está na fila');
    element.querySelector<HTMLButtonElement>('.btn-outline-dark')!.click(); fixture.detectChanges();
    expect(element.querySelector('.alert-danger')).toBeNull();
    expect(element.querySelector('.btn-outline-dark')).toBeNull();
    pending.next({ sent: false, queued: true }); pending.complete(); fixture.detectChanges();
    expect(element.querySelector('.alert-danger')).toBeNull();
    http.expectNone(rpcUrl('booking_create_reservation'));
  });
  it('clears memory and session and cancels an in-flight notification only for the cancelled reservation', () => {
    saveReceipt();
    const pending = new Subject<{ sent: boolean }>();
    (TestBed.inject(EmailService).send as jest.Mock).mockReturnValue(pending);
    const { fixture, element } = setup();
    fixture.componentInstance.clearCancelledReceipt('another-id');
    expect(pending.observed).toBe(true);
    expect(sessionStorage.getItem('familia-tx-pre-reservation')).not.toBeNull();
    fixture.componentInstance.clearCancelledReceipt(testReservation.id); fixture.detectChanges();
    expect(pending.observed).toBe(false);
    pending.error({ status: 503 }); fixture.detectChanges();
    expect(element.querySelector('.alert-danger')).toBeNull();
    expect(element.querySelector('form')).toBeNull();
    expect(sessionStorage.getItem('familia-tx-pre-reservation')).toBeNull();
    fixture.componentInstance.openForDate('2028-02-28'); fixture.detectChanges();
    expect(element.querySelector('form')).not.toBeNull();
  });
  it('allows a retry after another recoverable failure without claiming the email was queued', () => {
    saveReceipt();
    (TestBed.inject(EmailService).send as jest.Mock).mockReturnValue(throwError(() => ({ status: 503 })));
    const { fixture, element } = setup();
    element.querySelector<HTMLButtonElement>('.btn-outline-dark')!.click(); fixture.detectChanges();
    expect(element.querySelector('.alert-danger')!.textContent).toContain('Tente novamente');
    expect(element.querySelector('.btn-outline-dark')).not.toBeNull();
  });

  it.each([
    ['', ''], ['1', '(1'], ['18', '(18)'], ['189', '(18) 9'],
    ['1899655549', '(18) 9965-5549'], ['18996555494', '(18) 99655-5494'],
    ['(18) 99655-5494', '(18) 99655-5494'], ['abc18996555494123', '(18) 99655-5494'],
  ])('masks the phone input %s as %s', (value, expected) => {
    const { element, fixture } = setup();
    const input = element.querySelector<HTMLInputElement>('#pre-phone')!;
    input.value = value; input.dispatchEvent(new Event('input')); fixture.detectChanges();
    expect(input.value).toBe(expected);
    expect(fixture.componentInstance['form'].controls.phone.value).toBe(expected);
    expect(input.placeholder).toBe('(99) 99999-9999');
  });
  it('keeps the caret near the edited digit instead of moving it to the end', () => {
    const { element } = setup();
    const input = element.querySelector<HTMLInputElement>('#pre-phone')!;
    input.value = '(18) 98655-5494'; input.setSelectionRange(7, 7);
    input.dispatchEvent(new Event('input'));
    expect(input.selectionStart).toBe(7);
  });

  it('formats the phone safely when the browser does not expose a caret', () => {
    const {element,fixture}=setup();const input=element.querySelector<HTMLInputElement>('#pre-phone')!;
    input.value='18996555494';jest.spyOn(input,'selectionStart','get').mockReturnValue(null);
    input.dispatchEvent(new Event('input'));fixture.detectChanges();
    expect(input.value).toBe('(18) 99655-5494');expect(fixture.componentInstance['form'].controls.phone.value).toBe(input.value);
  });

});
