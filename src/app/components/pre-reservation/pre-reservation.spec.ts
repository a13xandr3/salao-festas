import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { FormSubmitDelivery } from '../../services/formsubmit-delivery';
import { PreReservation } from './pre-reservation';

describe('PreReservation', () => {
  beforeEach(async () => {
    jest.useFakeTimers(); jest.setSystemTime(new Date('2028-02-01T12:00:00Z'));
    await TestBed.configureTestingModule({ imports: [PreReservation], providers: [provideHttpClient(), provideHttpClientTesting(), { provide: FormSubmitDelivery, useValue: { submit: jest.fn() } }] }).compileComponents();
  });
  afterEach(() => { TestBed.inject(HttpTestingController).verify(); sessionStorage.clear(); jest.useRealTimers(); });
  function setup() {
    const fixture = TestBed.createComponent(PreReservation); fixture.componentRef.setInput('selectedDate', '2028-02-28'); fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const fill = (endDate = '2028-02-29', endTime = '08:00') => {
      for (const [id, value] of Object.entries({ name: 'Maria Silva', phone: '(11) 99999-9999', email: 'maria@example.com', 'start-date': '2028-02-28', 'end-date': endDate })) {
        const input = element.querySelector<HTMLInputElement>(`#pre-${id}`)!; input.value = value; input.dispatchEvent(new Event('input'));
      }
      fixture.detectChanges();
    };
    const submit = () => { element.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); fixture.detectChanges(); };
    return { fixture, element, fill, submit, http: TestBed.inject(HttpTestingController) };
  }
  it('uses the selected calendar date and defaults the end to the next day', () => {
    const { element } = setup();
    expect(element.querySelector<HTMLInputElement>('#pre-start-date')!.value).toBe('2028-02-28');
    expect(element.querySelector<HTMLInputElement>('#pre-end-date')!.value).toBe('2028-02-29');
  });
  it('blocks missing customer fields and periods shorter than 24 hours', () => {
    const { submit, http, element, fill } = setup(); submit(); http.expectNone('/api/pre-reservations');
    expect(element.querySelectorAll('.invalid-feedback')).toHaveLength(3);
    fill('2028-02-28'); submit(); http.expectNone('/api/pre-reservations');
    expect(element.textContent).toContain('pelo menos uma diária');
  });
  it('accepts exactly 24 hours, prevents double submits and shows the server deadline', () => {
    const { submit, http, element, fill, fixture } = setup(); fill(); submit(); submit();
    const request = http.expectOne('/api/pre-reservations');
    expect(request.request.method).toBe('POST'); expect(request.request.body.startDate).toBe('2028-02-28');
    expect(element.querySelector<HTMLButtonElement>('button')!.disabled).toBe(true);
    request.flush({ id: 'test-protocol', status: 'pending_payment', cancellationToken: 'a'.repeat(64), submission: { action: 'https://formsubmit.co/a13xandr3ea@gmail.com', fields: { email: 'maria@example.com', _autoresponse: 'Confirmação' } } }); fixture.detectChanges();
    expect(element.textContent).toContain('aguardando pagamento');
    expect(element.querySelector('form')).toBeNull();
    expect(element.querySelector('app-cancel-pre-reservation')).toBeNull();
    expect(element.textContent).toContain('test-protocol');
    expect(TestBed.inject(FormSubmitDelivery).submit).toHaveBeenCalledTimes(1);
    expect(JSON.parse(sessionStorage.getItem('familia-tx-pre-reservation')!).id).toBe('test-protocol');
  });
  it('does not impose a maximum stay and preserves the form on conflicts', () => {
    const { submit, http, element, fill, fixture } = setup(); fill('2030-03-01'); submit();
    http.expectOne('/api/pre-reservations').flush({}, { status: 409, statusText: 'Conflict' }); fixture.detectChanges();
    expect(element.textContent).toContain('acabou de ficar indisponível');
    expect(element.querySelector<HTMLInputElement>('#pre-name')!.value).toBe('Maria Silva');
  });
});
