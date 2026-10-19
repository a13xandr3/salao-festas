import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Contact } from './contact';

const endpoint = 'https://formsubmit.co/ajax/a13xandr3ea@gmail.com';
describe('Contact with FormSubmit', () => {
  const originalFetch = globalThis.fetch;
  let send: jest.Mock;
  beforeEach(async () => {
    send = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ success: 'true' }) });
    globalThis.fetch = send;
    await TestBed.configureTestingModule({ imports: [Contact], providers: [provideHttpClient(), provideHttpClientTesting()] }).compileComponents();
  });
  afterEach(() => { TestBed.inject(HttpTestingController).verify(); globalThis.fetch = originalFetch; });

  function setup() {
    const fixture = TestBed.createComponent(Contact);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const fill = (message = 'Gostaria de conhecer o espaço.') => {
      for (const [id, value] of Object.entries({ name: 'Maria Silva', phone: '(11) 99999-9999', email: 'maria@example.com', message })) {
        const input = element.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#contact-${id}`)!;
        input.value = value;
        input.dispatchEvent(new Event('input'));
      }
      fixture.detectChanges();
    };
    const submit = () => { element.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); fixture.detectChanges(); };
    const advance = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); fixture.detectChanges(); };
    return { fixture, element, fill, submit, advance, http: TestBed.inject(HttpTestingController) };
  }
  it('blocks empty submissions and shows errors for all required fields', () => {
    const { element, submit, http } = setup(); submit();
    expect(send).not.toHaveBeenCalled(); http.expectNone('/api/contacts');
    expect(element.querySelectorAll('.invalid-feedback')).toHaveLength(4);
  });
  it('enforces the 2000 character limit', () => {
    const { fill, submit, http } = setup(); fill('x'.repeat(2001)); submit();
    expect(send).not.toHaveBeenCalled(); http.expectNone('/api/contacts');
  });
  it('sends FormData to the reference provider once, then persists and resets', async () => {
    const { fill, submit, advance, http, element, fixture } = setup();
    fill(); submit(); submit(); await advance();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toBe(endpoint);
    const options = send.mock.calls[0][1];
    expect(options.method).toBe('POST');
    expect(options.headers.Accept).toBe('application/json');
    expect(options.body).toBeInstanceOf(FormData);
    expect(options.body.get('phone')).toBe('(11) 99999-9999');
    expect(options.body.get('_replyto')).toBe('maria@example.com');
    const req = http.expectOne('/api/contacts');
    expect(req.request.method).toBe('POST'); expect(req.request.body.name).toBe('Maria Silva');
    expect(element.querySelector<HTMLButtonElement>('button')!.disabled).toBe(true);
    req.flush({ id: '123' }); await fixture.whenStable(); fixture.detectChanges();
    expect(element.textContent).toContain('envio por e-mail e registrada');
    expect(element.querySelector<HTMLInputElement>('#contact-name')!.value).toBe('');
  });
  it('preserves the form and skips persistence when the email request fails', async () => {
    send.mockRejectedValueOnce(new Error('network error'));
    const { fill, submit, advance, http, element, fixture } = setup();
    fill(); submit(); await advance(); await fixture.whenStable(); fixture.detectChanges();
    http.expectNone('/api/contacts');
    expect(element.querySelector<HTMLInputElement>('#contact-name')!.value).toBe('Maria Silva');
    expect(element.querySelector<HTMLButtonElement>('button')!.disabled).toBe(false);
    expect(element.textContent).toContain('Não foi possível enviar');
  });
  it('rejects application-level provider failures even with HTTP 200', async () => {
    send.mockResolvedValueOnce({ ok: true, json: async () => ({ success: 'false' }) });
    const { fill, submit, advance, http, fixture, element } = setup();
    fill(); submit(); await advance(); await fixture.whenStable(); fixture.detectChanges();
    http.expectNone('/api/contacts'); expect(element.textContent).toContain('Não foi possível enviar');
  });
  it('retries only persistence after an API failure without duplicating the email', async () => {
    const { fill, submit, advance, http, element, fixture } = setup();
    fill(); submit(); await advance();
    http.expectOne('/api/contacts').flush({}, { status: 500, statusText: 'Error' });
    await fixture.whenStable(); fixture.detectChanges();
    expect(element.textContent).toContain('tentar apenas o registro');
    expect(element.querySelector<HTMLInputElement>('#contact-name')!.value).toBe('Maria Silva');
    submit(); await advance();
    expect(send).toHaveBeenCalledTimes(1);
    http.expectOne('/api/contacts').flush({ id: '123' });
    await fixture.whenStable(); fixture.detectChanges();
    expect(element.querySelector<HTMLInputElement>('#contact-name')!.value).toBe('');
  });
});
