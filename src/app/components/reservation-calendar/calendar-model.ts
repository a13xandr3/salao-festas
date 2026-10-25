import { Availability } from '../../services/booking.models';

/** Data e hora no fuso utilizado pelo calendário. */
interface LocalDateTime {
  date: string;
  time: string;
}
/** Estados visuais possíveis para um dia da agenda. */
type DayStatus = 'free' | 'pre_reserved' | 'reserved' | 'unavailable' | 'unknown';
const statusLabels: Record<DayStatus, string> = {
  free: 'Livre',
  pre_reserved: 'Pré-reservado',
  reserved: 'Reservado',
  unavailable: 'Indisponível',
  unknown: '—',
};
const dateFormatter = new Intl.DateTimeFormat('pt-BR', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

/** Transforma a data em uma descrição legível em português. */
export function dateLabel(date: string): string {
  return dateFormatter.format(new Date(`${date}T12:00:00Z`));
}

/** Obtém a data e a hora atuais no fuso de São Paulo. */
export function localNow(date = new Date()): LocalDateTime {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  /** Extrai uma parte da data formatada, como ano, mês ou hora. */
  const get = (key: string) => parts.find((part) => part.type === key)!.value;
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${get('hour')}:${get('minute')}`,
  };
}

/** Monta a grade do mês com espaços vazios para completar as semanas. */
export function monthDays(month: string): (string | null)[] {
  const [year, number] = month.split('-').map(Number);
  const offset = new Date(Date.UTC(year, number - 1, 1)).getUTCDay();
  const total = new Date(Date.UTC(year, number, 0)).getUTCDate();
  const days: (string | null)[] = Array(offset).fill(null);
  for (let day = 1; day <= total; day++) days.push(`${month}-${String(day).padStart(2, '0')}`);
  while (days.length % 7) days.push(null);
  return days;
}

/** Combina disponibilidade e data atual para definir o estado e o texto de cada dia. */
export function calendarDays(month: string, availability: Availability | null, now: LocalDateTime) {
  const states = new Map(availability?.days?.map((day) => [day.date, day.status]));
  return monthDays(month).map((date) => {
    if (!date)
      return { date: '', number: '', status: 'unknown', past: true, label: '', description: '' };
    const availabilityStatus = states.get(date) ?? 'unknown';
    const occupied = availabilityStatus === 'reserved' || availabilityStatus === 'pre_reserved';
    const status: DayStatus = date <= now.date && !occupied
      ? 'unavailable' : availabilityStatus;
    const label = statusLabels[status];
    const past = date <= now.date;
    return {
      date,
      number: String(Number(date.slice(8))),
      status,
      past,
      label,
      description: `${dateLabel(date)}: ${label}`,
    };
  });
}
