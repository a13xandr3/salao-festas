-- Preserve reservation history while releasing the period and stopping queued notifications.
begin;

create or replace function public.booking_cancel_reservation(p_id uuid, p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' then
    raise sqlstate 'PT404' using message = 'Pré-reserva ou código inválido.';
  end if;
  update public."preReservations" set status = 'cancelled'
    where id = p_id and status in ('pending_payment', 'confirmed')
      and "cancellationTokenHash" = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  if not found then raise sqlstate 'PT404' using message = 'Pré-reserva ou código inválido.'; end if;

  update booking_private.email_deliveries
    set status = 'cancelled', attachment = null, updated_at = now()
    where record_id = p_id and status <> 'sent';
  return jsonb_build_object('cancelled', true);
end;
$$;

notify pgrst, 'reload schema';
commit;
