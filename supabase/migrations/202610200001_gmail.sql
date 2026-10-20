-- Apply after 202610190001_booking.sql. Existing records are preserved.
begin;
alter table public.contacts add column if not exists "emailDeliveryTokenHash" text;
alter table public.contacts alter column "emailProvider" set default 'gmail';
alter table public.contacts alter column "emailStatus" set default 'pending';
alter table public."preReservations" alter column "notificationProvider" set default 'gmail';
alter table public."preReservations" alter column notifications set default '{"customer":{"provider":"gmail","status":"pending"},"manager":{"provider":"gmail","status":"pending"}}'::jsonb;
create table if not exists booking_private.email_deliveries (
  delivery_key text primary key,
  record_id uuid not null,
  kind text not null,
  role text not null,
  status text not null,
  claim_id uuid not null,
  lease_until timestamptz not null,
  attempts integer not null,
  updated_at timestamptz not null default now()
);
alter table booking_private.email_deliveries enable row level security;
revoke all on booking_private.email_deliveries from public, anon, authenticated;
create or replace function public.booking_create_contact(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare contact_id uuid; token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  perform booking_private.validate_person(p_input);
  if exists (select 1 from jsonb_object_keys(p_input) k where k not in ('name','phone','email','message'))
    or jsonb_typeof(p_input->'message') is distinct from 'string'
    or char_length(trim(p_input->>'message')) not between 1 and 2000
  then raise sqlstate 'PT400' using message = 'Mensagem inválida ou campo não permitido.'; end if;
  perform booking_private.limit_submission(p_input->>'email', 'contact');
  insert into public.contacts (name, phone, email, message, "emailProvider", "emailStatus", "emailDeliveryTokenHash")
    values (trim(p_input->>'name'), trim(p_input->>'phone'), trim(p_input->>'email'), trim(p_input->>'message'), 'gmail', 'pending', encode(sha256(convert_to(token, 'UTF8')), 'hex'))
    returning id into contact_id;
  return jsonb_build_object('id', contact_id, 'deliveryToken', token);
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
    '{"customer":{"provider":"gmail","status":"pending"},"manager":{"provider":"gmail","status":"pending"}}'::jsonb,
    'gmail'
  ) returning * into record;
  return to_jsonb(record) - 'cancellationTokenHash';
exception when exclusion_violation then
  raise sqlstate 'PT409' using message = 'O período escolhido já está reservado.';
end;
$$;


create or replace function public.booking_claim_email(p_kind text, p_id uuid, p_token text, p_role text, p_fingerprint text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare payload jsonb; key text; claim uuid := gen_random_uuid(); previous text;
begin
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' then
    raise sqlstate 'PT404' using message = 'Solicitação inválida.';
  end if;
  if p_kind = 'contact' and p_role = 'manager' and p_fingerprint = '' then
    select to_jsonb(c) - 'emailDeliveryTokenHash' into payload from public.contacts c
      where id = p_id and "emailDeliveryTokenHash" = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  elsif (p_kind = 'reservation' and p_role in ('customer','manager') and p_fingerprint = '')
    or (p_kind = 'contract' and p_role = 'manager' and p_fingerprint ~ '^[a-f0-9]{64}$') then
    payload := public.booking_owned_reservation(p_id, p_token, p_kind = 'contract');
  else
    raise sqlstate 'PT400' using message = 'Operação inválida.';
  end if;
  if payload is null then raise sqlstate 'PT404' using message = 'Solicitação inválida.'; end if;
  key := p_kind || ':' || p_id::text || ':' || p_role || ':' || p_fingerprint;
  if p_kind = 'contract' then perform pg_advisory_xact_lock(hashtextextended(p_id::text, 1)); end if;
  -- Maximum five distinct attachment deliveries per reservation; identical PDFs are idempotent.
  if p_kind = 'contract' and not exists(select 1 from booking_private.email_deliveries where delivery_key = key)
    and (select count(*) from booking_private.email_deliveries where record_id = p_id and kind = 'contract') >= 5 then
    raise sqlstate 'PT429' using message = 'Limite de envios do contrato atingido.';
  end if;
  insert into booking_private.email_deliveries (delivery_key,record_id,kind,role,status,claim_id,lease_until,attempts)
    values (key,p_id,p_kind,p_role,'sending',claim,now() + interval '2 minutes',1)
    on conflict (delivery_key) do update set status = 'sending', claim_id = claim,
      lease_until = now() + interval '2 minutes', attempts = booking_private.email_deliveries.attempts + 1, updated_at = now()
    where booking_private.email_deliveries.status <> 'sent'
      and (booking_private.email_deliveries.status <> 'sending' or booking_private.email_deliveries.lease_until < now())
      and booking_private.email_deliveries.attempts < 5
    returning status into previous;
  if not found then
    select status into previous from booking_private.email_deliveries where delivery_key = key;
    if previous = 'sent' then return jsonb_build_object('alreadySent', true); end if;
    raise sqlstate 'PT429' using message = 'Envio em andamento ou limite de tentativas atingido.';
  end if;
  return jsonb_build_object('alreadySent', false, 'claimId', claim, 'record', payload);
end;
$$;

create or replace function public.booking_finish_email(p_claim uuid, p_sent boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare delivery booking_private.email_deliveries;
begin
  update booking_private.email_deliveries set status = case when p_sent then 'sent' else 'failed' end,
    updated_at = now() where claim_id = p_claim and status = 'sending' returning * into delivery;
  if not found then raise sqlstate 'PT409' using message = 'Envio não está mais ativo.'; end if;
  if delivery.kind = 'contact' then
    update public.contacts set "emailProvider" = 'gmail', "emailStatus" = delivery.status where id = delivery.record_id;
  elsif delivery.kind = 'reservation' then
    update public."preReservations" set "notificationProvider" = 'gmail',
      notifications = jsonb_set(coalesce(notifications, '{}'::jsonb), array[delivery.role],
        jsonb_build_object('provider','gmail','status',delivery.status))
      where id = delivery.record_id;
  end if;
end;
$$;
revoke all on function public.booking_claim_email(text,uuid,text,text,text), public.booking_finish_email(uuid,boolean) from public, anon, authenticated;
grant execute on function public.booking_claim_email(text,uuid,text,text,text), public.booking_finish_email(uuid,boolean) to service_role;
notify pgrst, 'reload schema';
commit;
