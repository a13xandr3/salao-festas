import { Availability, daySlots, localNow, monthDays } from './calendar-model';
const data: Availability = { month: '2028-02', timeZone: 'America/Sao_Paulo', opensAt: '08:00', closesAt: '12:00', slotMinutes: 60, reservations: [{ date: '2028-02-29', start: '09:00', end: '11:00' }] };
describe('reservation calendar calculations', () => {
  it('uses São Paulo dates across the UTC day boundary', () => {
    expect(localNow(new Date('2028-03-01T01:30:00Z'))).toEqual({ date: '2028-02-29', time: '22:30' });
  });
  it('places all days in complete weeks and supports leap years', () => {
    const days = monthDays('2028-02');
    expect(days.length % 7).toBe(0);
    expect(days.filter(Boolean)).toHaveLength(29);
    expect(days[0]).toBeNull();
    expect(days[2]).toBe('2028-02-01');
  });
  it('blocks overlapping slots and releases the exact end of a reservation', () => {
    expect(daySlots('2028-02-29', data, { date: '2028-02-28', time: '10:00' }).map(slot => slot.reserved)).toEqual([false, true, true, false]);
  });
  it('expires slots that have already started, using local time', () => {
    expect(daySlots('2028-02-29', data, { date: '2028-02-29', time: '09:15' }).map(slot => slot.past)).toEqual([true, true, false, false]);
    expect(daySlots('2028-02-29', data, { date: '2028-03-01', time: '00:00' }).every(slot => slot.past)).toBe(true);
  });
});
