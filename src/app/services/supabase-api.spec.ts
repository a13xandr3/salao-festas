import { DOCUMENT } from '@angular/common';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { rpcUrl, testConfig, testReservation, testSite } from '../testing/supabase';
import { SupabaseApi } from './supabase-api';
import { reservationSubmission } from './reservation-submission';
import { SupabaseConfig } from './site-config';

const input = {
  name: 'Cliente Teste',
  phone: '11999999999',
  email: 'client@example.com',
  startDate: '2028-02-28',
  endDate: '2028-02-29',
};

describe('Supabase integration on GitHub Pages', () => {
  let api: SupabaseApi;
  let backend: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: DOCUMENT, useValue: { baseURI: testSite } },
      ],
    });
    api = TestBed.inject(SupabaseApi);
    backend = TestBed.inject(HttpTestingController);
  });
  afterEach(() => backend.verify());
  const configure = (value: SupabaseConfig = testConfig) =>
    backend.expectOne(`${testSite}app-config.json`).flush(value);
  const rpc = (name: string) => backend.expectOne(rpcUrl(name));

  it('calls RPC with apikey only, never a Pages API path or public-key bearer token', () => {
    const received = jest.fn();
    api.availability('2028-02').subscribe(received);
    configure();
    const request = rpc('booking_availability');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ p_month: '2028-02' });
    expect(request.request.headers.get('apikey')).toBe(testConfig.supabasePublishableKey);
    expect(request.request.headers.has('Authorization')).toBe(false);
    request.flush({ month: '2028-02', days: [{ date: '2028-02-27', status: 'reserved' }] });
    expect(received).toHaveBeenCalledWith({
      month: '2028-02',
      days: [{ date: '2028-02-27', status: 'reserved' }],
    });
  });

  it('creates a receipt with native FormSubmit and resources inside the repository path', () => {
    const received = jest.fn();
    api.createReservation(input).subscribe(received);
    configure();
    const request = rpc('booking_create_reservation');
    expect(request.request.body).toEqual({ p_input: input });
    request.flush(testReservation);
    const receipt = received.mock.calls[0][0];
    expect(receipt.cancellationToken).toBe(testReservation.notificationToken);
    expect(receipt.links).toEqual({ contract: testConfig.contractUrl, pix: testConfig.pixUrl });
    expect(receipt.submission.fields._next).toBe(`${testSite}#pre-reserva`);
    expect(receipt.submission.fields._autoresponse).toContain(
      `${testSite}#cancelar-pre-reserva?id=${testReservation.id}&token=${testReservation.notificationToken}`,
    );
    expect(receipt.submission.fields._captcha).toBeUndefined();
    expect(receipt.submission.action).not.toContain('/ajax/');
  });

  it('passes ownership token in the RPC body and builds the signed-contract form', () => {
    const received = jest.fn();
    api
      .reservationForm(testReservation.id, testReservation.notificationToken, true)
      .subscribe(received);
    configure();
    const request = rpc('booking_owned_reservation');
    expect(request.request.body).toEqual({
      p_id: testReservation.id,
      p_token: testReservation.notificationToken,
      p_contract: true,
    });
    expect(request.request.urlWithParams).not.toContain(testReservation.notificationToken);
    request.flush(testReservation);
    expect(received.mock.calls[0][0].fields._next).toBe(`${testSite}#contrato-enviado`);
    expect(received.mock.calls[0][0].fields._autoresponse).toBeUndefined();
  });

  it('resumes a form without inserting another reservation', () => {
    api.reservationForm(testReservation.id, testReservation.notificationToken).subscribe();
    configure();
    const request = rpc('booking_owned_reservation');
    expect(request.request.body.p_contract).toBe(false);
    request.flush(testReservation);
    backend.expectNone(rpcUrl('booking_create_reservation'));
  });

  it('maps cancellation and contact persistence to restricted functions', () => {
    api.cancelReservation(testReservation.id, testReservation.notificationToken).subscribe();
    configure();
    const request = rpc('booking_cancel_reservation');
    expect(request.request.body).toEqual({
      p_id: testReservation.id,
      p_token: testReservation.notificationToken,
    });
    request.flush({ cancelled: true });
    const contactInput = {
      name: 'Contato Teste',
      phone: '11999999999',
      email: 'contact@example.com',
      message: 'Consulta',
    };
    api.createContact(contactInput).subscribe();
    const contact = rpc('booking_create_contact');
    expect(contact.request.body).toEqual({ p_input: contactInput });
    contact.flush({ id: testReservation.id });
  });

  it('preserves conflict errors for the forms', () => {
    const failure = jest.fn();
    api.createReservation(input).subscribe({ error: failure });
    configure();
    rpc('booking_create_reservation').flush(
      { code: 'PT409' },
      { status: 409, statusText: 'Conflict' },
    );
    expect(failure.mock.calls[0][0].status).toBe(409);
  });

  it.each(['sb_secret_private', `eyJ.${btoa(JSON.stringify({ role: 'service_role' }))}.signature`])(
    'rejects private key %s before sending it',
    (key) => {
      const failure = jest.fn();
      api.availability('2028-02').subscribe({ error: failure });
      configure({ ...testConfig, supabasePublishableKey: key });
      expect(failure.mock.calls[0][0].status).toBe(503);
      backend.expectNone((request) => request.url.includes('/rest/v1/'));
    },
  );

  it('uses the configured manager for regular contact delivery', () => {
    const received = jest.fn();
    api.contactEndpoint().subscribe(received);
    configure();
    expect(received).toHaveBeenCalledWith('https://formsubmit.co/ajax/a13xandr3ea%40gmail.com');
  });

  it('rejects unsafe contract resources', () => {
    expect(() =>
      reservationSubmission(
        testReservation,
        { ...testConfig, contractUrl: 'javascript:alert(1)' },
        testSite,
      ),
    ).toThrow();
  });
});
