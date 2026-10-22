import { DOCUMENT } from '@angular/common';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { rpcUrl, testConfig, testReservation, testSite } from '../testing/supabase';
import { SupabaseApi } from './supabase-api';
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

  it('creates a receipt without SMTP credentials or browser-generated email forms', () => {
    const received = jest.fn();
    api.createReservation(input).subscribe(received);
    configure();
    const request = rpc('booking_create_reservation');
    expect(request.request.body).toEqual({ p_input: input });
    request.flush(testReservation);
    const receipt = received.mock.calls[0][0];
    expect(receipt.cancellationToken).toBe(testReservation.notificationToken);
    expect(receipt.links).toEqual({ contract: testConfig.contractUrl, pix: testConfig.pixUrl });
    expect(receipt.submission).toBeUndefined();
  });

  it('passes ownership token in the RPC body and reads the reservation', () => {
    const received = jest.fn();
    api.ownedReservation(testReservation.id, testReservation.notificationToken).subscribe(received);
    configure();
    const request = rpc('booking_owned_reservation');
    expect(request.request.body).toEqual({
      p_id: testReservation.id,
      p_token: testReservation.notificationToken,
      p_contract: true,
    });
    expect(request.request.urlWithParams).not.toContain(testReservation.notificationToken);
    request.flush(testReservation);
    expect(received).toHaveBeenCalledWith(testReservation);
  });

  it('resumes a form without inserting another reservation', () => {
    api.ownedReservation(testReservation.id, testReservation.notificationToken).subscribe();
    configure();
    const request = rpc('booking_owned_reservation');
    expect(request.request.body.p_contract).toBe(true);
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

  it('rejects unsafe resource URLs before a database request', () => {
    const failure = jest.fn();
    api.availability('2028-02').subscribe({ error: failure });
    configure({ ...testConfig, contractUrl: 'javascript:alert(1)' });
    expect(failure.mock.calls[0][0].status).toBe(503);
    backend.expectNone((request) => request.url.includes('/rest/v1/'));
  });
  it('propagates a configuration download failure without issuing an RPC', () => {
    const failed = jest.fn(); api.availability('2028-02').subscribe({ error: failed });
    backend.expectOne(testSite + 'app-config.json').flush({}, { status: 503, statusText: 'Unavailable' });
    expect(failed.mock.calls[0][0].status).toBe(503);
    backend.expectNone(request => request.url.includes('/rest/v1/'));
  });

  it('preserves the public pending-payment status for calendar classification', () => {
    const received = jest.fn(); api.availability('2028-02').subscribe(received); configure();
    rpc('booking_availability').flush({ month: '2028-02', days: [{ date: '2028-02-28', status: 'pre_reserved' }] });
    expect(received).toHaveBeenCalledWith({ month: '2028-02', days: [{ date: '2028-02-28', status: 'pre_reserved' }] });
  });

});
