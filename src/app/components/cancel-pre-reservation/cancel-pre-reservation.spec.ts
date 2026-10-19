import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { CancelPreReservation } from './cancel-pre-reservation';
describe('CancelPreReservation', () => {
  beforeEach(async () => { await TestBed.configureTestingModule({ imports: [CancelPreReservation], providers: [provideHttpClient(), provideHttpClientTesting()] }).compileComponents(); });
  afterEach(() => { TestBed.inject(HttpTestingController).verify(); history.replaceState(null, '', '/'); });
  it('is hidden without the individual email link', () => {
    const fixture = TestBed.createComponent(CancelPreReservation); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('form')).toBeNull();
  });
  it('requires explicit confirmation and sends the owner token in a header', () => {
    history.replaceState(null, '', '/#cancelar-pre-reserva?id=my-id&token=' + 'a'.repeat(64));
    const fixture = TestBed.createComponent(CancelPreReservation); fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    element.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController); http.expectNone('/api/pre-reservations/my-id');
    element.querySelector<HTMLInputElement>('#cancel-confirm')!.click();
    element.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); fixture.detectChanges();
    const request = http.expectOne('/api/pre-reservations/my-id');
    expect(request.request.method).toBe('DELETE'); expect(request.request.headers.get('X-Cancellation-Token')).toBe('a'.repeat(64));
    request.flush(null, { status: 204, statusText: 'No Content' }); fixture.detectChanges();
    expect(element.textContent).toContain('cancelada e o período foi liberado');
  });
});
