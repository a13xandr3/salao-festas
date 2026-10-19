-- Execute in the Supabase SQL Editor as the project owner.
-- Existing contacts and preReservations rows are preserved.
begin;

create schema if not exists booking_private;
revoke all on schema booking_private from public, anon, authenticated;

create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  name text not null, phone text not null, email text not null, message text not null,
  "createdAt" timestamptz not null default now(),
  "emailProvider" text not null default 'formsubmit',
  "emailStatus" text not null default 'not_tracked'
);
create table if not exists public."preReservations" (
  id uuid primary key default gen_random_uuid(),
  "cancellationTokenHash" text not null, "notificationToken" text not null,
  notifications jsonb not null,
  name text not null, phone text not null, email text not null,
  "startDate" date not null, "startTime" time not null default '08:00',
  "endDate" date not null, "endTime" time not null default '08:00',
  "startAt" timestamptz not null, "endAt" timestamptz not null,
  "timeZone" text not null default 'America/Sao_Paulo',
  status text not null default 'pending_payment',
  "createdAt" timestamptz not null default now(),
  "notificationProvider" text not null default 'formsubmit'
);
alter table public."preReservations" add column if not exists "paymentConfirmedAt" timestamptz;

-- Also applies when tables were created manually through Table Editor.
alter table public.contacts
  alter column id set default gen_random_uuid(),
  alter column "createdAt" set default now(),
  alter column "emailProvider" set default 'formsubmit',
  alter column "emailStatus" set default 'not_tracked';
alter table public."preReservations"
  alter column id set default gen_random_uuid(),
  alter column "createdAt" set default now(),
  alter column "startTime" set default '08:00',
  alter column "endTime" set default '08:00',
  alter column "timeZone" set default 'America/Sao_Paulo',
  alter column status set default 'pending_payment',
  alter column "notificationProvider" set default 'formsubmit',
  alter column notifications set default '{"customer":{"provider":"formsubmit","status":"awaiting_formsubmit"},"manager":{"provider":"formsubmit","status":"awaiting_formsubmit"}}'::jsonb;

do $$ begin
  alter table public."preReservations" add constraint booking_valid_period check (
    "startAt" is not null and "endAt" is not null
    and "startTime" = time '08:00' and "endTime" = time '08:00'
    and "timeZone" = 'America/Sao_Paulo'
    and "endAt" - "startAt" >= interval '24 hours'
    and mod(extract(epoch from ("endAt" - "startAt")), 86400) = 0
    and "startAt" = (("startDate" + "startTime") at time zone 'America/Sao_Paulo')
    and "endAt" = (("endDate" + "endTime") at time zone 'America/Sao_Paulo')
  );
exception when duplicate_object or duplicate_table then null; end $$;

do $$ begin
  -- The database resolves concurrent attempts; checkout is an open boundary.
  alter table public."preReservations" add constraint booking_no_overlap
    exclude using gist (tstzrange("startAt", "endAt", '[)') with &&)
    where (status in ('pending_payment', 'confirmed'));
exception when duplicate_object or duplicate_table then null; end $$;

create table if not exists booking_private.admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);
create table if not exists booking_private.rate_limits (
  bucket text primary key, attempts integer not null, expires_at timestamptz not null
);
alter table booking_private.admins enable row level security;
alter table booking_private.rate_limits enable row level security;
revoke all on all tables in schema booking_private from public, anon, authenticated;

create or replace function booking_private.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from booking_private.admins where user_id = auth.uid());
$$;
revoke all on function booking_private.is_admin() from public, anon, authenticated;
grant usage on schema booking_private to authenticated;
grant execute on function booking_private.is_admin() to authenticated;

-- Replace any permissive policies previously created in Table Editor.
do $$ declare item record; begin
  for item in select schemaname, tablename, policyname from pg_policies
    where schemaname = 'public' and tablename in ('contacts', 'preReservations')
  loop
    execute format('drop policy %I on %I.%I', item.policyname, item.schemaname, item.tablename);
  end loop;
end $$;
alter table public.contacts enable row level security;
alter table public."preReservations" enable row level security;
revoke all on public.contacts, public."preReservations" from public, anon, authenticated;
grant select, update, delete on public.contacts to authenticated;
grant select, delete on public."preReservations" to authenticated;
create policy booking_admin_contacts on public.contacts for all to authenticated
  using ((select booking_private.is_admin())) with check ((select booking_private.is_admin()));
create policy booking_admin_reservations on public."preReservations" for all to authenticated
  using ((select booking_private.is_admin())) with check ((select booking_private.is_admin()));

create or replace function booking_private.validate_person(p_input jsonb)
returns void language plpgsql set search_path = '' as $$
begin
  if p_input is null or jsonb_typeof(p_input) <> 'object'
     or jsonb_typeof(p_input->'name') is distinct from 'string'
     or jsonb_typeof(p_input->'phone') is distinct from 'string'
     or jsonb_typeof(p_input->'email') is distinct from 'string'
     or char_length(trim(p_input->>'name')) not between 2 and 120
     or char_length(p_input->>'phone') > 30
     or (p_input->>'phone') !~ '^[+()0-9[:space:].-]+$'
     or regexp_replace(p_input->>'phone', '[^0-9]', '', 'g') !~ '^[0-9]{10,15}$'
     or char_length(p_input->>'email') > 254
     or trim(p_input->>'email') !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
  then raise sqlstate 'PT400' using message = 'Informe nome, telefone com DDD e e-mail válidos.'; end if;
end;
$$;

create or replace function booking_private.limit_submission(p_email text, p_kind text)
returns void language plpgsql set search_path = '' as $$
declare total integer; bucket_key text;
begin
  -- Limits per normalized email and operation, not a substitute for an anti-bot service.
  bucket_key := p_kind || ':' || encode(sha256(convert_to(lower(trim(p_email)), 'UTF8')), 'hex')
    || ':' || floor(extract(epoch from now()) / 900)::text;
  delete from booking_private.rate_limits where expires_at < now();
  insert into booking_private.rate_limits values (bucket_key, 1, now() + interval '15 minutes')
    on conflict (bucket) do update set attempts = booking_private.rate_limits.attempts + 1
    returning attempts into total;
  if total > 5 then raise sqlstate 'PT429' using message = 'Muitas tentativas. Aguarde alguns minutos.'; end if;
end;
$$;

create or replace function public.booking_create_contact(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare contact_id uuid;
begin
  perform booking_private.validate_person(p_input);
  if exists (select 1 from jsonb_object_keys(p_input) k where k not in ('name','phone','email','message'))
    or jsonb_typeof(p_input->'message') is distinct from 'string'
    or char_length(trim(p_input->>'message')) not between 1 and 2000
  then raise sqlstate 'PT400' using message = 'Mensagem inválida ou campo não permitido.'; end if;
  perform booking_private.limit_submission(p_input->>'email', 'contact');
  insert into public.contacts (name, phone, email, message, "emailProvider", "emailStatus")
    values (trim(p_input->>'name'), trim(p_input->>'phone'), trim(p_input->>'email'), trim(p_input->>'message'), 'formsubmit', 'not_tracked')
    returning id into contact_id;
  return jsonb_build_object('id', contact_id);
end;
$$;

create or replace function public.booking_create_reservation(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare record public."preReservations"; start_date date; end_date date;
  starts_at timestamptz; ends_at timestamptz; token text;
begin
  perform booking_private.validate_person(p_input);
  if exists (select 1 from jsonb_object_keys(p_input) k where k not in ('name','phone','email','startDate','endDate'))
    or jsonb_typeof(p_input->'startDate') is distinct from 'string'
    or jsonb_typeof(p_input->'endDate') is distinct from 'string'
    or (p_input->>'startDate') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or (p_input->>'endDate') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  then raise sqlstate 'PT400' using message = 'Datas inválidas ou campo não permitido.'; end if;
  begin
    start_date := (p_input->>'startDate')::date;
    end_date := (p_input->>'endDate')::date;
  exception when datetime_field_overflow or invalid_datetime_format then
    raise sqlstate 'PT400' using message = 'Datas inválidas.';
  end;
  starts_at := (start_date + time '08:00') at time zone 'America/Sao_Paulo';
  ends_at := (end_date + time '08:00') at time zone 'America/Sao_Paulo';
  if starts_at <= now() or end_date <= start_date then
    raise sqlstate 'PT400' using message = 'Escolha um período futuro de pelo menos 24 horas.';
  end if;
  perform booking_private.limit_submission(p_input->>'email', 'reservation');
  token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public."preReservations" (
    "cancellationTokenHash", "notificationToken", name, phone, email,
    "startDate", "startTime", "endDate", "endTime", "startAt", "endAt", "timeZone", status,
    notifications, "notificationProvider"
  ) values (
    encode(sha256(convert_to(token, 'UTF8')), 'hex'), token,
    trim(p_input->>'name'), trim(p_input->>'phone'), trim(p_input->>'email'),
    start_date, '08:00', end_date, '08:00', starts_at, ends_at, 'America/Sao_Paulo', 'pending_payment',
    '{"customer":{"provider":"formsubmit","status":"awaiting_formsubmit"},"manager":{"provider":"formsubmit","status":"awaiting_formsubmit"}}'::jsonb,
    'formsubmit'
  ) returning * into record;
  return to_jsonb(record) - 'cancellationTokenHash';
exception when exclusion_violation then
  raise sqlstate 'PT409' using message = 'O período escolhido já está reservado.';
end;
$$;

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
      where r.status in ('pending_payment','confirmed')
        and r."startAt" < ((d::date + 1 + time '08:00') at time zone 'America/Sao_Paulo')
        and r."endAt" > ((d::date + time '08:00') at time zone 'America/Sao_Paulo')
    ) then 'reserved' else 'free' end) order by d)
  into days from generate_series(first_day::timestamp, (last_day - 1)::timestamp, interval '1 day') d;
  return jsonb_build_object('month', p_month, 'days', days, 'timeZone', 'America/Sao_Paulo',
    'opensAt', '08:00', 'closesAt', '22:00', 'slotMinutes', 60, 'reservations', '[]'::jsonb);
end;
$$;

create or replace function public.booking_owned_reservation(p_id uuid, p_token text, p_contract boolean default false)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare record public."preReservations";
begin
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' then
    raise sqlstate 'PT404' using message = 'Pré-reserva ou código inválido.';
  end if;
  select * into record from public."preReservations" where id = p_id
    and "cancellationTokenHash" = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  if not found then raise sqlstate 'PT404' using message = 'Pré-reserva ou código inválido.'; end if;
  if record.status <> 'pending_payment' and not (p_contract and record.status = 'confirmed') then
    raise sqlstate 'PT409' using message = 'A pré-reserva não está ativa para esta operação.';
  end if;
  return (to_jsonb(record) - 'cancellationTokenHash') || jsonb_build_object('notificationToken', p_token);
end;
$$;

create or replace function public.booking_cancel_reservation(p_id uuid, p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' then
    raise sqlstate 'PT404' using message = 'Pré-reserva ou código inválido.';
  end if;
  delete from public."preReservations" where id = p_id
    and "cancellationTokenHash" = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  if not found then raise sqlstate 'PT404' using message = 'Pré-reserva ou código inválido.'; end if;
  return jsonb_build_object('cancelled', true);
end;
$$;

create or replace function public.booking_confirm_payment(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare record public."preReservations";
begin
  if not booking_private.is_admin() then raise sqlstate 'PT403' using message = 'Acesso restrito.'; end if;
  update public."preReservations" set status = 'confirmed', "paymentConfirmedAt" = coalesce("paymentConfirmedAt", now())
    where id = p_id and status in ('pending_payment','confirmed') returning * into record;
  if not found then raise sqlstate 'PT404' using message = 'Pré-reserva ativa não encontrada.'; end if;
  return jsonb_build_object('id', record.id, 'status', record.status, 'paymentConfirmedAt', record."paymentConfirmedAt");
end;
$$;

revoke all on function booking_private.validate_person(jsonb), booking_private.limit_submission(text,text) from public, anon, authenticated;
revoke all on function public.booking_create_contact(jsonb), public.booking_create_reservation(jsonb),
  public.booking_availability(text), public.booking_owned_reservation(uuid,text,boolean),
  public.booking_cancel_reservation(uuid,text), public.booking_confirm_payment(uuid) from public, anon, authenticated;
grant execute on function public.booking_create_contact(jsonb), public.booking_create_reservation(jsonb),
  public.booking_availability(text), public.booking_owned_reservation(uuid,text,boolean),
  public.booking_cancel_reservation(uuid,text) to anon, authenticated;
grant execute on function public.booking_confirm_payment(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
