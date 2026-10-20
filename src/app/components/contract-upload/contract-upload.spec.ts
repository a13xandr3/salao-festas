import { emailUrl, provideTestConfig, rpcUrl, testReservation } from '../../testing/supabase';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ContractUpload } from './contract-upload';
describe('ContractUpload', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ContractUpload],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideTestConfig()],
    }).compileComponents();
  });
  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
    history.replaceState(null, '', '/');
  });
  it('is hidden without the individual email link', () => {
    const fixture = TestBed.createComponent(ContractUpload);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('form')).toBeNull();
  });
  it('loads the owner reservation and sends the PDF through the Gmail function', async () => {
    history.replaceState(null, '', '/#enviar-contrato?id=my-id&token=' + 'a'.repeat(64));
    const fixture = TestBed.createComponent(ContractUpload);
    fixture.detectChanges();
    const request = TestBed.inject(HttpTestingController).expectOne(
      rpcUrl('booking_owned_reservation'),
    );
    expect(request.request.body.p_token).toBe('a'.repeat(64));
    request.flush(testReservation);
    fixture.detectChanges();
    const form = fixture.nativeElement.querySelector('form') as HTMLFormElement;
    expect(form.hasAttribute('action')).toBe(false);
    const input = form.querySelector<HTMLInputElement>('[name="attachment"]')!;
    const file = new File(['%PDF-test'], 'assinado.pdf', { type: 'application/pdf' });
    Object.defineProperty(file, 'slice', { value: () => ({ text: async () => '%PDF-' }) });
    Object.defineProperty(input, 'files', { value: [file] });
    input.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(form.querySelector<HTMLButtonElement>('button')!.disabled).toBe(false);
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    const email = TestBed.inject(HttpTestingController).expectOne(emailUrl);
    expect(email.request.body.get('kind')).toBe('contract');
    expect(email.request.body.get('attachment').name).toBe('assinado.pdf');
    email.flush({ sent: false, queued: true }, { status: 202, statusText: 'Accepted' });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Contrato recebido para envio por e-mail');
  });
});
