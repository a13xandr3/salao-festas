-- Public calendar exposes occupancy/payment status only, never customer data.
begin;

create or replace function public.booking_availability(p_month text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare first_day date; last_day date; days jsonb;
begin
  if p_month is null or p_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' or left(p_month, 4) = '0000' then
    raise sqlstate 'PT400' using message = 'Informe o mês no formato AAAA-MM.';
  end if;
  first_day := (p_month || '-01')::date;
  last_day := (first_day + interval '1 month')::date;
  select jsonb_agg(jsonb_build_object('date', to_char(d, 'YYYY-MM-DD'), 'status',
    case when exists (
      select 1 from public."preReservations" r
      where r.status = 'confirmed'
        and r."startAt" < ((d::date + 1 + time '08:00') at time zone 'America/Sao_Paulo')
        and r."endAt" > ((d::date + time '08:00') at time zone 'America/Sao_Paulo')
    ) then 'reserved' when exists (
      select 1 from public."preReservations" r
      where r.status = 'pending_payment'
        and r."startAt" < ((d::date + 1 + time '08:00') at time zone 'America/Sao_Paulo')
        and r."endAt" > ((d::date + time '08:00') at time zone 'America/Sao_Paulo')
    ) then 'pre_reserved' else 'free' end) order by d)
  into days from generate_series(first_day::timestamp, (last_day - 1)::timestamp, interval '1 day') d;
  return jsonb_build_object('month', p_month, 'days', days, 'timeZone', 'America/Sao_Paulo',
    'opensAt', '08:00', 'closesAt', '22:00', 'slotMinutes', 60, 'reservations', '[]'::jsonb);
end;
$$;

notify pgrst, 'reload schema';
commit;
