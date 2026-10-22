import { emailUrl, provideTestConfig, rpcUrl } from '../../testing/supabase';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Contact } from './contact';

describe('Contact with Gmail', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Contact],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideTestConfig()],
    }).compileComponents();
  });
  afterEach(() => TestBed.inject(HttpTestingController).verify());
  function setup() {
    const fixture = TestBed.createComponent(Contact);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const fill = (message = 'Consulta de evento') => {
      for (const [id, value] of Object.entries({
        name: 'Maria Silva',
        phone: '11999999999',
        email: 'maria@example.com',
        message,
      })) {
        const input = element.querySelector<HTMLInputElement>(`#contact-${id}`)!;
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
    const advance = async () => {
      for (let i = 0; i < 8; i++) await Promise.resolve();
      fixture.detectChanges();
    };
    return { fixture, element, fill, submit, advance, http: TestBed.inject(HttpTestingController) };
  }
  it('rejects missing fields and oversized messages before any request', () => {
    const { fill, submit, element, http } = setup();
    submit();
    expect(element.querySelectorAll('.invalid-feedback')).toHaveLength(4);
    fill('x'.repeat(2001));
    submit();
    http.expectNone(rpcUrl('booking_create_contact'));
    http.expectNone(emailUrl);
  });
  it('persists once, sends Gmail through the shared service, and resets only after success', async () => {
    const { fill, submit, advance, http, element } = setup();
    fill();
    submit();
    submit();
    http
      .expectOne(rpcUrl('booking_create_contact'))
      .flush({ id: 'contact-id', deliveryToken: 'a'.repeat(64) });
    await advance();
    const email = http.expectOne(emailUrl);
    expect(email.request.body.get('kind')).toBe('contact');
    expect(email.request.body.get('id')).toBe('contact-id');
    expect(email.request.body.get('token')).toBe('a'.repeat(64));
    email.flush({ sent: true });
    await advance();
    expect(element.textContent).toContain('registrada e enviada');
    expect(element.querySelector<HTMLInputElement>('#contact-name')!.value).toBe('');
  });
  it('does not send email if persistence fails', async () => {
    const { fill, submit, advance, http, element } = setup();
    fill();
    submit();
    http
      .expectOne(rpcUrl('booking_create_contact'))
      .flush({}, { status: 503, statusText: 'Unavailable' });
    await advance();
    http.expectNone(emailUrl);
    expect(element.querySelector<HTMLInputElement>('#contact-name')!.value).toBe('Maria Silva');
    expect(element.textContent).toContain('Não foi possível registrar');
  });
  it('keeps delivery queued after an endpoint failure and does not require the browser token', async () => {
    const { fill, submit, advance, http, element, fixture } = setup();
    fill();
    submit();
    http.expectOne(rpcUrl('booking_create_contact'))
      .flush({ id: 'contact-id', deliveryToken: 'a'.repeat(64) });
    await advance();
    http.expectOne(emailUrl).flush({}, { status: 503, statusText: 'Unavailable' });
    await advance();
    expect(element.textContent).toContain('retomado automaticamente');
    expect(element.querySelector<HTMLInputElement>('#contact-name')!.value).toBe('');
    fixture.destroy();
    const restored = setup();
    restored.http.expectNone(rpcUrl('booking_create_contact'));
    restored.http.expectNone(emailUrl);
  });
  it('reports queue acknowledgement without claiming SMTP delivery', async () => {
    const { fill, submit, advance, http, element } = setup();
    fill(); submit();
    http.expectOne(rpcUrl('booking_create_contact')).flush({ id: 'contact-id', deliveryToken: 'a'.repeat(64) });
    await advance();
    http.expectOne(emailUrl).flush({ queued: true, sent: false }, { status: 202, statusText: 'Accepted' });
    await advance();
    expect(element.textContent).toContain('será enviada');
    expect(element.textContent).not.toContain('registrada e enviada');
  });
  it('rejects whitespace-only messages and malformed customer data without sending requests', () => {
    const { fill, submit, element, http } = setup();
    fill('   ');
    const email = element.querySelector<HTMLInputElement>('#contact-email')!;
    email.value = 'invalid'; email.dispatchEvent(new Event('input'));
    const phone = element.querySelector<HTMLInputElement>('#contact-phone')!;
    phone.value = '123'; phone.dispatchEvent(new Event('input'));
    submit();
    expect(element.querySelectorAll('.invalid-feedback')).toHaveLength(3);
    expect(element.querySelector<HTMLButtonElement>('button')!.disabled).toBe(false);
    http.expectNone(rpcUrl('booking_create_contact')); http.expectNone(emailUrl);
  });

  it.each([
    ['', ''], ['1', '(1'], ['18', '(18)'], ['189', '(18) 9'],
    ['1899655549', '(18) 9965-5549'], ['18996555494', '(18) 99655-5494'],
    ['(18) 99655-5494', '(18) 99655-5494'], ['abc18996555494123', '(18) 99655-5494'],
  ])('masks the contact phone %s as %s', (value, expected) => {
    const { element, fixture } = setup();
    const input = element.querySelector<HTMLInputElement>('#contact-phone')!;
    input.value = value; input.dispatchEvent(new Event('input')); fixture.detectChanges();
    expect(input.value).toBe(expected);
    expect(fixture.componentInstance['form'].controls.phone.value).toBe(expected);
    expect(input.placeholder).toBe('(99) 99999-9999');
    expect(input.maxLength).toBe(15);
  });
  it('preserves the cursor position when editing the contact phone', () => {
    const { element } = setup();
    const input = element.querySelector<HTMLInputElement>('#contact-phone')!;
    input.value = '(18) 98655-5494'; input.setSelectionRange(7, 7);
    input.dispatchEvent(new Event('input'));
    expect(input.selectionStart).toBe(7);
  });


});
