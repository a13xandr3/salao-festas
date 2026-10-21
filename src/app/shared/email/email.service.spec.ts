import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { EmailService } from './email.service';
import { emailUrl, provideTestConfig } from '../../testing/supabase';

describe('EmailService', () => {
  beforeEach(() =>
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideTestConfig()],
    }),
  );
  afterEach(() => TestBed.inject(HttpTestingController).verify());
  it('only sends record capabilities, without Gmail credentials or arbitrary recipients', () => {
    const received = jest.fn();
    TestBed.inject(EmailService)
      .send({ kind: 'reservation', id: 'id', token: 'a'.repeat(64) })
      .subscribe(received);
    const req = TestBed.inject(HttpTestingController).expectOne(emailUrl);
    expect(Array.from(req.request.body.keys())).toEqual(['kind', 'id', 'token']);
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush({ sent: true });
    expect(received).toHaveBeenCalledWith({ sent: true });
  });
  it('rejects a response that confirms neither delivery nor durable queueing', () => {
    const failed = jest.fn();
    TestBed.inject(EmailService)
      .send({ kind: 'contact', id: 'id', token: 'a'.repeat(64) })
      .subscribe({ error: failed });
    TestBed.inject(HttpTestingController).expectOne(emailUrl).flush({ sent: false });
    expect(failed).toHaveBeenCalled();
  });
  it('accepts durable queueing without claiming delivery', () => {
    const received = jest.fn();
    TestBed.inject(EmailService).send({ kind: 'reservation', id: 'id', token: 'a'.repeat(64) }).subscribe(received);
    TestBed.inject(HttpTestingController).expectOne(emailUrl)
      .flush({ queued: true, sent: false }, { status: 202, statusText: 'Accepted' });
    expect(received).toHaveBeenCalledWith({ queued: true, sent: false });
  });
  it('times out an unacknowledged request instead of waiting indefinitely', () => {
    jest.useFakeTimers();
    try {
      const failed = jest.fn();
      TestBed.inject(EmailService).send({ kind: 'contact', id: 'id', token: 'a'.repeat(64) }).subscribe({ error: failed });
      const request = TestBed.inject(HttpTestingController).expectOne(emailUrl);
      jest.advanceTimersByTime(30000);
      expect(failed).toHaveBeenCalledWith(expect.objectContaining({ name: 'TimeoutError' }));
      expect(request.cancelled).toBe(true);
    } finally { jest.useRealTimers(); }
  });

});
