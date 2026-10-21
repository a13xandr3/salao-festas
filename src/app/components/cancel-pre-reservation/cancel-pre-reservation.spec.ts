import { provideTestConfig, rpcUrl } from '../../testing/supabase';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { CancelPreReservation } from './cancel-pre-reservation';
describe('CancelPreReservation', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CancelPreReservation],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideTestConfig()],
    }).compileComponents();
  });
  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
    history.replaceState(null, '', '/');
  });
  it('is hidden without the individual email link', () => {
    const fixture = TestBed.createComponent(CancelPreReservation);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('form')).toBeNull();
  });
  it('requires explicit confirmation and sends the owner token in the RPC body', () => {
    history.replaceState(null, '', '/#cancelar-pre-reserva?id=my-id&token=' + 'a'.repeat(64));
    const fixture = TestBed.createComponent(CancelPreReservation);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    element
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    http.expectNone(rpcUrl('booking_cancel_reservation'));
    element.querySelector<HTMLInputElement>('#cancel-confirm')!.click();
    element
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    fixture.detectChanges();
    const request = http.expectOne(rpcUrl('booking_cancel_reservation'));
    expect(request.request.method).toBe('POST');
    expect(request.request.body.p_token).toBe('a'.repeat(64));
    request.flush(null, { status: 204, statusText: 'No Content' });
    fixture.detectChanges();
    expect(element.textContent).toContain('cancelada e o período foi liberado');
  });
  it.each([404, 503])('preserves confirmation and allows retry after HTTP %s', (status) => {
    history.replaceState(null, '', '/#cancelar-pre-reserva?id=my-id&token=' + 'a'.repeat(64));
    const fixture = TestBed.createComponent(CancelPreReservation);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const cancelled = jest.fn(); fixture.componentInstance.cancelled.subscribe(cancelled);
    element.querySelector<HTMLInputElement>('#cancel-confirm')!.click();
    const submit = () => element.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    submit(); submit();
    const http = TestBed.inject(HttpTestingController);
    http.expectOne(rpcUrl('booking_cancel_reservation')).flush({}, { status, statusText: 'Failure' });
    fixture.detectChanges();
    expect(element.textContent).toContain(status === 404 ? 'Confira o protocolo' : 'Seus dados foram preservados');
    expect(element.querySelector<HTMLInputElement>('#cancel-confirm')!.checked).toBe(true);
    expect(cancelled).not.toHaveBeenCalled();
    submit(); http.expectOne(rpcUrl('booking_cancel_reservation')).flush({ cancelled: true });
    fixture.detectChanges(); expect(cancelled).toHaveBeenCalledTimes(1);
  });

});
