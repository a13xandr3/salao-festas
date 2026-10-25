/** Testa a propriedade da reserva, a validação do PDF e o pedido de envio. */
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
  it('does not submit a PDF before reservation ownership is confirmed', async () => {
    history.replaceState(null,'','/#enviar-contrato?id=my-id&token='+'a'.repeat(64));
    const fixture=TestBed.createComponent(ContractUpload);fixture.detectChanges();
    const control=fixture.componentInstance as unknown as {loaded:()=>boolean;attachment:File;fileValid:{set:(value:boolean)=>void};submit:(event:Event)=>void};
    control.attachment=new File(['%PDF-test'],'signed.pdf');control.fileValid.set(true);
    control.submit(new Event('submit',{cancelable:true}));
    const http=TestBed.inject(HttpTestingController);http.expectNone(emailUrl);
    http.expectOne(rpcUrl('booking_owned_reservation')).flush(testReservation);
    expect(control.loaded()).toBe(true);
  });
  /** Prepara um formulário de contrato com a propriedade da reserva confirmada. */
  function loaded() {
    history.replaceState(null, '', '/#enviar-contrato?id=my-id&token=' + 'a'.repeat(64));
    const fixture = TestBed.createComponent(ContractUpload); fixture.detectChanges();
    TestBed.inject(HttpTestingController).expectOne(rpcUrl('booking_owned_reservation')).flush(testReservation);
    fixture.detectChanges();
    return { fixture, input: fixture.nativeElement.querySelector('input') as HTMLInputElement };
  }
  /** Cria um arquivo PDF fictício e permite simular a leitura do seu cabeçalho. */
  function pdf(name = 'signed.pdf', header: () => Promise<string> = async () => '%PDF-') {
    const file = new File(['%PDF-test'], name);
    Object.defineProperty(file, 'slice', { value: () => ({ text: header }) });
    return file;
  }
  /** Simula a escolha de arquivos pelo campo de upload. */
  function select(input: HTMLInputElement, files: File[] | null) {
    Object.defineProperty(input, 'files', { value: files, configurable: true });
    input.dispatchEvent(new Event('change'));
  }
  it('reports ownership lookup failures without displaying an upload form', () => {
    history.replaceState(null, '', '/#enviar-contrato?id=my-id&token=' + 'a'.repeat(64));
    const fixture = TestBed.createComponent(ContractUpload); fixture.detectChanges();
    TestBed.inject(HttpTestingController).expectOne(rpcUrl('booking_owned_reservation')).flush({}, { status: 404, statusText: 'Not Found' });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('O link é inválido');
    expect(fixture.nativeElement.querySelector('form')).toBeNull();
  });
  it('ignores an empty selection and blocks submission without an attachment', async () => {
    const { fixture, input } = loaded(); select(input, null); await fixture.whenStable();
    fixture.componentInstance['submit'](new Event('submit', { cancelable: true }));
    expect(fixture.componentInstance['fileValid']()).toBe(false);
    TestBed.inject(HttpTestingController).expectNone(emailUrl);
  });
  it('blocks submission without an individual link', () => {
    const fixture = TestBed.createComponent(ContractUpload); fixture.detectChanges();
    const event = new Event('submit', { cancelable: true });
    fixture.componentInstance['submit'](event); expect(event.defaultPrevented).toBe(true);
    TestBed.inject(HttpTestingController).expectNone(emailUrl);
  });
  it.each(['size', 'extension', 'header'])('rejects a PDF with invalid %s', async (reason) => {
    const { fixture, input } = loaded();
    const file = pdf(reason === 'extension' ? 'signed.txt' : 'signed.pdf', async () => reason === 'header' ? 'wrong' : '%PDF-');
    if (reason === 'size') Object.defineProperty(file, 'size', { value: 10 * 1024 * 1024 + 1 });
    select(input, [file]); await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Selecione um PDF válido');
    expect(fixture.nativeElement.querySelector('button').disabled).toBe(true);
  });
  it('accepts the exact ten-megabyte limit and uppercase extension', async () => {
    const { fixture, input } = loaded(); const file = pdf('signed.PDF');
    Object.defineProperty(file, 'size', { value: 10 * 1024 * 1024 });
    select(input, [file]); await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('button').disabled).toBe(false);
  });
  it('reports read errors for the current selection', async () => {
    const { fixture, input } = loaded(); select(input, [pdf('signed.pdf', async () => { throw new Error('read failed'); })]);
    await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Não foi possível ler o arquivo');
  });
  it.each([false, true])('ignores a stale asynchronous read, rejected=%s', async (rejected) => {
    const { fixture, input } = loaded();
    let resolve!: (value: string) => void, reject!: (reason: Error) => void;
    const pending = new Promise<string>((yes, no) => { resolve = yes; reject = no; });
    select(input, [pdf('old.pdf', () => pending)]);
    select(input, [pdf('new.pdf')]);
    await Promise.resolve();
    if (rejected) reject(new Error('old read failed')); else resolve('%PDF-');
    await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.componentInstance['fileValid']()).toBe(true);
    expect(fixture.nativeElement.querySelector('.alert-danger')).toBeNull();
  });
  it('prevents duplicate sends, preserves the selected file on failure and retries', async () => {
    const { fixture, input } = loaded(); select(input, [pdf()]); await fixture.whenStable();
    /** Dispara o envio do formulário no teste. */
    const submit = () => fixture.componentInstance['submit'](new Event('submit', { cancelable: true }));
    submit(); submit();
    const http = TestBed.inject(HttpTestingController);
    http.expectOne(emailUrl).flush({}, { status: 503, statusText: 'Unavailable' });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Não foi possível enviar o contrato');
    expect(fixture.componentInstance['sending']()).toBe(false);
    submit(); http.expectOne(emailUrl).flush({ sent: true }); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('form')).toBeNull();
  });

});
