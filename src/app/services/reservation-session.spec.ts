import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { testReservation } from '../testing/supabase';
import { ReservationSession } from './reservation-session';
import { ReservationReceipt } from './booking.models';
const key = 'familia-tx-pre-reservation';
describe('ReservationSession', () => {
  afterEach(() => sessionStorage.clear());
  it('ignores malformed and incomplete storage instead of hiding the form with a broken receipt', () => {
    const session = TestBed.inject(ReservationSession);
    for (const value of [
      '{broken',
      'null',
      '{"id":"test"}',
      '{"id":"test","cancellationToken":"invalid"}',
    ]) {
      sessionStorage.setItem(key, value);
      expect(session.read()).toBeNull();
    }
  });
  it('only removes the receipt corresponding to the cancelled reservation', () => {
    const session = TestBed.inject(ReservationSession);
    const receipt: ReservationReceipt = {
      ...testReservation,
      cancellationToken: testReservation.notificationToken,
      links: { contract: '', pix: '' },
    };
    session.save(receipt);
    session.clear('another-reservation');
    expect(session.read()?.id).toBe(receipt.id);
    session.clear(receipt.id);
    expect(session.read()).toBeNull();
  });
  it('rejects receipts missing valid contract and Pix links', () => {
    const session = TestBed.inject(ReservationSession);
    for (const links of [null, {}, { contract: 123, pix: '' }, { contract: '', pix: 123 }]) {
      sessionStorage.setItem(key, JSON.stringify({ id: 'id', cancellationToken: 'a'.repeat(64), links }));
      expect(session.read()).toBeNull();
    }
  });
  it('tolerates unavailable storage while keeping the page usable', () => {
    const session = TestBed.inject(ReservationSession);
    const receipt: ReservationReceipt = {
      ...testReservation, cancellationToken: testReservation.notificationToken,
      links: { contract: '', pix: '' },
    };
    const write = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('disabled'); });
    expect(() => session.save(receipt)).not.toThrow();
    write.mockRestore();
    session.save(receipt);
    const remove = jest.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('disabled'); });
    expect(() => session.clear(receipt.id)).not.toThrow();
    remove.mockRestore();
    expect(session.read()?.id).toBe(receipt.id);
  });
  it('has no receipt when rendered without a browser window', () => {
    TestBed.configureTestingModule({ providers: [{ provide: DOCUMENT, useValue: { defaultView: null } }] });
    const session = TestBed.inject(ReservationSession);
    expect(session.read()).toBeNull();
  });

});
