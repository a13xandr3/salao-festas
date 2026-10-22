import { calendarDays, localNow, monthDays } from './calendar-model';
describe('reservation calendar calculations', () => {
  it('uses São Paulo dates across the UTC day boundary', () => {
    expect(localNow(new Date('2028-03-01T01:30:00Z'))).toEqual({
      date: '2028-02-29',
      time: '22:30',
    });
  });
  it('places all days in complete weeks and supports leap years', () => {
    const days = monthDays('2028-02');
    expect(days.length % 7).toBe(0);
    expect(days.filter(Boolean)).toHaveLength(29);
    expect(days[0]).toBeNull();
    expect(days[2]).toBe('2028-02-01');
  });
  it('does not invent availability when an API response is missing a date', () => {
    const days = calendarDays(
      '2028-02',
      { month: '2028-02', days: [{ date: '2028-02-29', status: 'free' }] },
      { date: '2028-02-28', time: '07:00' },
    );
    expect(days.find((day) => day.date === '2028-02-28')?.status).toBe('unavailable');
    expect(days.find((day) => day.date === '2028-02-29')?.status).toBe('free');
  });
  it('blocks today and past days even before check-in time', () => {
    const days = calendarDays('2028-02', null, { date: '2028-02-28', time: '08:00' });
    expect(days.find((day) => day.date === '2028-02-28')?.past).toBe(true);
    expect(days.find((day) => day.date === '2028-02-29')?.past).toBe(false);
  });
  it('starts a Sunday month without padding and ends on complete weeks', () => {
    const days = monthDays('2026-02');
    expect(days[0]).toBe('2026-02-01');
    expect(days).toHaveLength(28);
    const beforeCheckin = calendarDays('2026-02', null, { date: '2026-02-01', time: '07:59' });
    expect(beforeCheckin[0].past).toBe(true);
    expect(beforeCheckin[0].description).toBe('1 de fevereiro de 2026: Indisponível');
  });

  it.each([
    ['2028-02-27', 'free', 'Indisponível'],
    ['2028-02-27', 'reserved', 'Reservado'],
    ['2028-02-27', 'pre_reserved', 'Pré-reservado'],
    ['2028-02-28', 'free', 'Indisponível'],
    ['2028-02-28', 'reserved', 'Reservado'],
    ['2028-02-28', 'pre_reserved', 'Pré-reservado'],
    ['2028-02-29', 'free', 'Livre'],
    ['2028-02-29', 'reserved', 'Reservado'],
    ['2028-02-29', 'pre_reserved', 'Pré-reservado'],
  ] as const)('labels %s with API status %s as %s', (date, status, label) => {
    const days = calendarDays('2028-02', { month: '2028-02', days: [{ date, status }] }, { date: '2028-02-28', time: '07:00' });
    const day = days.find(day => day.date === date)!;
    expect(day.label).toBe(label);
    expect(day.description).toContain(label);
    expect(day.past).toBe(date <= '2028-02-28');
  });
  it('keeps unqueried future days unknown', () => {
    const day = calendarDays('2028-02', null, { date: '2028-02-28', time: '07:00' }).find(day => day.date === '2028-02-29')!;
    expect(day.status).toBe('unknown'); expect(day.label).toBe('—');
  });

});
