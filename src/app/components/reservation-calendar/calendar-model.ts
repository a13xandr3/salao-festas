export interface Availability {
  days?: { date: string; status: 'free' | 'reserved' }[];
  month: string;
  timeZone: string;
  opensAt: string;
  closesAt: string;
  slotMinutes: number;
  reservations: { date: string; start: string; end: string; status?: string }[];
}
export interface Slot { start: string; end: string; reserved: boolean; preReserved?: boolean; past: boolean; }
export function localNow(date = new Date()): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const get = (key: string) => parts.find(part => part.type === key)!.value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
}
export function monthDays(month: string): (string | null)[] {
  const [year, number] = month.split('-').map(Number);
  const offset = new Date(Date.UTC(year, number - 1, 1)).getUTCDay();
  const total = new Date(Date.UTC(year, number, 0)).getUTCDate();
  const days: (string | null)[] = Array(offset).fill(null);
  for (let day = 1; day <= total; day++) days.push(`${month}-${String(day).padStart(2, '0')}`);
  while (days.length % 7) days.push(null);
  return days;
}
const minutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
const formatTime = (value: number) => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
export function daySlots(date: string, data: Availability, now: { date: string; time: string }): Slot[] {
  const slots: Slot[] = [];
  for (let start = minutes(data.opensAt); start < minutes(data.closesAt); start += data.slotMinutes) {
    const first = formatTime(start);
    const end = formatTime(start + data.slotMinutes);
    const matches = data.reservations.filter(item => item.date === date && item.start < end && item.end > first);
    slots.push({ start: first, end, reserved: matches.length > 0, preReserved: matches.some(item => item.status === 'pre_reserved'), past: date < now.date || (date === now.date && first <= now.time) });
  }
  return slots;
}
