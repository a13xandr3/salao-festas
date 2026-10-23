-- Administrative soft cancellation: keep financial history and reject paid reservations.
begin;
create or replace function public.booking_finance_cancel(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public."preReservations"; received numeric;
begin
  if not booking_private.is_admin() then raise sqlstate 'PT403' using message='Acesso restrito.'; end if;
  perform 1 from booking_private.finance_control where singleton for update;
  select * into r from public."preReservations" where id=p_id for update;
  if not found then raise sqlstate 'PT404' using message='Pré-reserva não encontrada.'; end if;
  if r.status='cancelled' then return jsonb_build_object('cancelled',true); end if;
  select coalesce(sum(amount),0) into received from public.financial_transactions where reservation_id=p_id and kind='receipt';
  if r.status<>'pending_payment' or r."paymentConfirmedAt" is not null
    or (r."totalAmount" is not null and received>=r."totalAmount") then
    raise sqlstate 'PT409' using message='Uma reserva já confirmada não pode ser excluída pelo fluxo de caixa.';
  end if;
  update public."preReservations" set status='cancelled' where id=p_id;
  update booking_private.email_deliveries set status='cancelled',attachment=null,updated_at=now()
    where record_id=p_id and status<>'sent';
  return jsonb_build_object('cancelled',true);
end;
$$;
revoke all on function public.booking_finance_cancel(uuid) from public,anon,authenticated;
grant execute on function public.booking_finance_cancel(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
