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
    expect(days.find((day) => day.date === '2028-02-28')?.status).toBe('unknown');
    expect(days.find((day) => day.date === '2028-02-29')?.status).toBe('free');
  });
  it('blocks a daily check-in from 08h onward in São Paulo', () => {
    const days = calendarDays('2028-02', null, { date: '2028-02-28', time: '08:00' });
    expect(days.find((day) => day.date === '2028-02-28')?.past).toBe(true);
    expect(days.find((day) => day.date === '2028-02-29')?.past).toBe(false);
  });
});
