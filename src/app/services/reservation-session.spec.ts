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
});
