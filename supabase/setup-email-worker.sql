-- Run as project owner AFTER deploying send-email-worker and creating its Vault secret.
-- Vault secret name: booking_email_worker_token; value: MAIL_WORKER_TOKEN from the private .env.
begin;
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

do $$ begin
  if not exists(select 1 from vault.decrypted_secrets
    where name = 'booking_email_worker_token' and length(decrypted_secret) >= 32) then
    raise exception 'Crie no Vault o secret booking_email_worker_token com o valor MAIL_WORKER_TOKEN do .env.';
  end if;
end $$;

create or replace function booking_private.wake_email_worker()
returns void language plpgsql security definer set search_path = '' as $$
declare worker_token text;
begin
  if not exists(select 1 from booking_private.email_deliveries
    where (status in ('pending','failed') and next_attempt_at <= now())
      or (status = 'sending' and lease_until < now())) then return; end if;
  select decrypted_secret into strict worker_token from vault.decrypted_secrets
    where name = 'booking_email_worker_token';
  perform net.http_post(
    url := 'https://gkuzpppvfhikzbwaodjf.supabase.co/functions/v1/send-email-worker',
    headers := jsonb_build_object('Content-Type','application/json','x-email-worker-token',worker_token),
    body := '{}'::jsonb, timeout_milliseconds := 90000
  );
end;
$$;
revoke all on function booking_private.wake_email_worker() from public, anon, authenticated, service_role;

create or replace function booking_private.notify_email_worker()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform booking_private.wake_email_worker();
  return null;
exception when others then
  -- A scheduler failure must not roll back the customer's reservation or outbox entry.
  raise warning 'Acionamento imediato indisponível; a fila será retomada pelo agendamento.';
  return null;
end;
$$;
revoke all on function booking_private.notify_email_worker() from public, anon, authenticated, service_role;
drop trigger if exists booking_email_wakeup on booking_private.email_deliveries;
create trigger booking_email_wakeup after insert on booking_private.email_deliveries
  for each statement execute function booking_private.notify_email_worker();

select cron.schedule('booking-email-retry', '* * * * *', 'select booking_private.wake_email_worker();');
select booking_private.wake_email_worker();
commit;
