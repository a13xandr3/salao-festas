begin;
-- Retire the no-amount operation. No payment is inferred from clicking Approve.
create or replace function public.booking_finance_approve(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  raise sqlstate 'PT400' using message='Informe manualmente valor pago, data e identificador do comprovante.';
end;
$$;

create or replace function public.booking_finance_approve(p_id uuid,p_amount text,p_occurred_on text,p_reference text,p_key uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public."preReservations"; result jsonb;
begin
  if not booking_private.is_admin() then raise sqlstate 'PT403' using message='Acesso restrito.'; end if;
  perform 1 from booking_private.finance_control where singleton for update;
  select * into r from public."preReservations" where id=p_id for update;
  if not found or r.status not in ('pending_payment','confirmed') then
    raise sqlstate 'PT404' using message='Pré-reserva ativa não encontrada.';
  end if;
  result:=public.booking_finance_post(jsonb_build_object('key',p_key,'reservationId',p_id,'kind','receipt',
    'amount',p_amount,'occurredOn',p_occurred_on,'reference',p_reference,
    'description','Recebimento informado manualmente pelo gestor','category','locacao'));
  select * into r from public."preReservations" where id=p_id;
  return result||jsonb_build_object('status',r.status);
end;
$$;
revoke all on function public.booking_finance_approve(uuid) from public,anon,authenticated;
revoke all on function public.booking_finance_approve(uuid,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.booking_finance_approve(uuid,text,text,text,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
