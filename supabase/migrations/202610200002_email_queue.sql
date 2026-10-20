-- Apply after 202610200001_gmail.sql. Queue writes commit with the source record.
begin;

alter table booking_private.email_deliveries
  add column if not exists next_attempt_at timestamptz not null default now(),
  add column if not exists attachment bytea;
create index if not exists booking_email_due
  on booking_private.email_deliveries(next_attempt_at) where status <> 'sent';

create or replace function booking_private.queue_record_email()
returns trigger language plpgsql security definer set search_path = '' as $$
declare operation text; recipient text;
begin
  operation := case when tg_table_name = 'contacts' then 'contact' else 'reservation' end;
  if tg_op = 'DELETE' then
    update booking_private.email_deliveries set status = 'cancelled', attachment = null
      where record_id = old.id and status <> 'sent';
    return old;
  end if;
  if (operation = 'contact' and to_jsonb(new)->>'emailProvider' <> 'gmail')
    or (operation = 'reservation' and to_jsonb(new)->>'notificationProvider' <> 'gmail') then
    return new;
  end if;
  foreach recipient in array case when operation = 'contact' then array['manager'] else array['manager','customer'] end loop
    insert into booking_private.email_deliveries
      (delivery_key, record_id, kind, role, status, claim_id, lease_until, attempts)
      values (operation || ':' || new.id::text || ':' || recipient || ':', new.id,
        operation, recipient, 'pending', gen_random_uuid(), now(), 0)
      on conflict (delivery_key) do nothing;
  end loop;
  return new;
end;
$$;
revoke all on function booking_private.queue_record_email() from public, anon, authenticated, service_role;
drop trigger if exists booking_contact_email_queue on public.contacts;
create trigger booking_contact_email_queue after insert or delete on public.contacts
  for each row execute function booking_private.queue_record_email();
drop trigger if exists booking_reservation_email_queue on public."preReservations";
create trigger booking_reservation_email_queue after insert or delete on public."preReservations"
  for each row execute function booking_private.queue_record_email();

-- Recover previously pending Gmail notifications; never resend FormSubmit history.
insert into booking_private.email_deliveries
  (delivery_key, record_id, kind, role, status, claim_id, lease_until, attempts)
select 'contact:' || id::text || ':manager:', id, 'contact', 'manager', 'pending', gen_random_uuid(), now(), 0
  from public.contacts where "emailProvider" = 'gmail' and "emailStatus" <> 'sent'
on conflict (delivery_key) do nothing;
insert into booking_private.email_deliveries
  (delivery_key, record_id, kind, role, status, claim_id, lease_until, attempts)
select 'reservation:' || r.id::text || ':' || recipient || ':', r.id, 'reservation', recipient,
  'pending', gen_random_uuid(), now(), 0
  from public."preReservations" r cross join unnest(array['manager','customer']) recipient
  where r."notificationProvider" = 'gmail' and r.status in ('pending_payment','confirmed')
    and coalesce(r.notifications->recipient->>'status', '') <> 'sent'
on conflict (delivery_key) do nothing;

-- Called only by the public Edge Function, after validating the request format.
create or replace function public.booking_request_email(
  p_kind text, p_id uuid, p_token text, p_fingerprint text default '', p_attachment text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare payload jsonb; pdf bytea; key text; recipient text; delivered boolean;
begin
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' then
    raise sqlstate 'PT404' using message = 'Solicitação inválida.';
  end if;
  if p_kind = 'contact' then
    select to_jsonb(c) into payload from public.contacts c where id = p_id
      and "emailDeliveryTokenHash" = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  elsif p_kind in ('reservation','contract') then
    payload := public.booking_owned_reservation(p_id, p_token, p_kind = 'contract');
  else raise sqlstate 'PT400' using message = 'Operação inválida.';
  end if;
  if payload is null then raise sqlstate 'PT404' using message = 'Solicitação inválida.'; end if;
  if p_kind = 'contract' then
    if p_attachment is null or length(p_attachment) > 13981016 or p_fingerprint !~ '^[a-f0-9]{64}$' then
      raise sqlstate 'PT400' using message = 'PDF inválido.';
    end if;
    begin pdf := decode(p_attachment, 'base64');
    exception when invalid_parameter_value then raise sqlstate 'PT400' using message = 'PDF inválido.'; end;
    if octet_length(pdf) > 10485760 or substring(pdf from 1 for 5) <> convert_to('%PDF-', 'UTF8')
      or encode(sha256(pdf), 'hex') <> p_fingerprint then
      raise sqlstate 'PT400' using message = 'PDF inválido.';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(p_id::text, 1));
    key := 'contract:' || p_id::text || ':manager:' || p_fingerprint;
    if not exists(select 1 from booking_private.email_deliveries where delivery_key = key)
      and (select count(*) from booking_private.email_deliveries where record_id = p_id and kind = 'contract') >= 5 then
      raise sqlstate 'PT429' using message = 'Limite de PDFs distintos atingido.';
    end if;
  elsif p_fingerprint is distinct from '' or p_attachment is not null then
    raise sqlstate 'PT400' using message = 'Anexo não permitido.';
  end if;
  foreach recipient in array case when p_kind = 'reservation' then array['manager','customer'] else array['manager'] end loop
    key := p_kind || ':' || p_id::text || ':' || recipient || ':' || p_fingerprint;
    insert into booking_private.email_deliveries
      (delivery_key, record_id, kind, role, status, claim_id, lease_until, attempts, attachment)
      values (key,p_id,p_kind,recipient,'pending',gen_random_uuid(),now(),0,pdf)
      on conflict (delivery_key) do update set attachment = excluded.attachment,
        status = 'pending', next_attempt_at = now()
      where booking_private.email_deliveries.kind = 'contract'
        and booking_private.email_deliveries.status <> 'sent'
        and booking_private.email_deliveries.attachment is null;
  end loop;
  select bool_and(status = 'sent') into delivered from booking_private.email_deliveries
    where record_id = p_id and kind = p_kind
      and (p_kind <> 'contract' or delivery_key = key);
  return jsonb_build_object('sent', delivered, 'queued', not delivered);
end;
$$;

-- One atomic claim per call. Expired leases are recoverable after worker shutdown.
create or replace function public.booking_next_email()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare job booking_private.email_deliveries; payload jsonb;
begin
  select * into job from booking_private.email_deliveries
    where (status in ('pending','failed') and next_attempt_at <= now()
      or status = 'sending' and lease_until < now())
    order by next_attempt_at, delivery_key for update skip locked limit 1;
  if not found then return null; end if;
  if job.kind = 'contact' then
    select to_jsonb(c) - 'emailDeliveryTokenHash' into payload from public.contacts c where id = job.record_id;
  else
    select to_jsonb(r) - 'cancellationTokenHash' into payload from public."preReservations" r
      where id = job.record_id and status in ('pending_payment','confirmed');
  end if;
  if payload is null or (job.kind = 'contract' and job.attachment is null) then
    update booking_private.email_deliveries set status = 'cancelled', attachment = null
      where delivery_key = job.delivery_key;
    return jsonb_build_object('skipped', true);
  end if;
  update booking_private.email_deliveries set status = 'sending', claim_id = gen_random_uuid(),
    lease_until = now() + interval '3 minutes', attempts = attempts + 1, updated_at = now()
    where delivery_key = job.delivery_key returning * into job;
  return jsonb_build_object('claimId',job.claim_id,'kind',job.kind,'role',job.role,'record',payload,
    'attachment',case when job.attachment is null then null else encode(job.attachment,'base64') end);
end;
$$;

create or replace function public.booking_finish_email(p_claim uuid, p_sent boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare delivery booking_private.email_deliveries;
begin
  update booking_private.email_deliveries set status = case when p_sent then 'sent' else 'failed' end,
    next_attempt_at = now() + make_interval(secs => least(21600, 60 * power(2, least(attempts - 1, 10)))::integer),
    attachment = case when p_sent then null else attachment end,
    updated_at = now() where claim_id = p_claim and status = 'sending' returning * into delivery;
  if not found then raise sqlstate 'PT409' using message = 'Envio não está mais ativo.'; end if;
  if delivery.kind = 'contact' then
    update public.contacts set "emailProvider" = 'gmail', "emailStatus" = delivery.status where id = delivery.record_id;
  elsif delivery.kind = 'reservation' then
    update public."preReservations" set "notificationProvider" = 'gmail',
      notifications = jsonb_set(coalesce(notifications, '{}'::jsonb), array[delivery.role],
        jsonb_build_object('provider','gmail','status',delivery.status)) where id = delivery.record_id;
  end if;
end;
$$;

-- The former synchronous claim API is no longer used.
revoke all on function public.booking_claim_email(text,uuid,text,text,text) from public, anon, authenticated, service_role;
revoke all on function public.booking_request_email(text,uuid,text,text,text), public.booking_next_email(),
  public.booking_finish_email(uuid,boolean) from public, anon, authenticated;
grant execute on function public.booking_request_email(text,uuid,text,text,text), public.booking_next_email(),
  public.booking_finish_email(uuid,boolean) to service_role;
notify pgrst, 'reload schema';
commit;
