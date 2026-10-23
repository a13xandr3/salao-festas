begin;
alter table public."preReservations"
  add column if not exists "rejectionReason" text check ("rejectionReason" is null or length(trim("rejectionReason")) between 1 and 500),
  add column if not exists "rejectedAt" timestamptz,
  add column if not exists "rejectedBy" uuid references auth.users(id),
  add column if not exists "rejectionRefundAmount" numeric(12,2) check ("rejectionRefundAmount">=0),
  add column if not exists "rejectionRefundDate" date,
  add column if not exists "rejectionRefundReference" text,
  add column if not exists "rejectionKey" uuid unique,
  add column if not exists "rejectionChecked" boolean;

create or replace function public.booking_finance_reject(p_id uuid,p_reason text,p_refund_amount text,
  p_refund_date text,p_refund_reference text,p_checked boolean,p_key uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public."preReservations"; balance numeric; expected numeric; refund_date date;
begin
  if not booking_private.is_admin() then raise sqlstate 'PT403' using message='Acesso restrito.'; end if;
  if p_reason is null or length(trim(p_reason)) not between 1 and 500 or p_checked is distinct from true or p_key is null
    or p_refund_amount is null or p_refund_amount !~ '^[0-9]{1,10}([.][0-9]{1,2})?$' then
    raise sqlstate 'PT400' using message='Informe motivo, valor de devolução e confirmação da conferência.';
  end if;
  expected:=p_refund_amount::numeric;
  if expected>0 then
    if p_refund_date is null or p_refund_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or p_refund_reference is null or length(trim(p_refund_reference)) not between 1 and 120 then
      raise sqlstate 'PT400' using message='Informe a data e o comprovante da devolução efetuada.';
    end if;
    begin refund_date:=p_refund_date::date;
    exception when datetime_field_overflow or invalid_datetime_format then
      raise sqlstate 'PT400' using message='Data de devolução inválida.';
    end;
    if refund_date>(now() at time zone 'America/Sao_Paulo')::date then raise sqlstate 'PT400' using message='A devolução não pode ter data futura.'; end if;
  elsif p_refund_date is not null or p_refund_reference is not null then
    raise sqlstate 'PT400' using message='Sem saldo recebido, não informe dados de devolução.';
  end if;
  perform 1 from booking_private.finance_control where singleton for update;
  select * into r from public."preReservations" where id=p_id for update;
  if not found then raise sqlstate 'PT404' using message='Pré-reserva não encontrada.'; end if;
  if r.status='cancelled' then
    if r."rejectionKey"=p_key and r."rejectionReason"=trim(p_reason) and r."rejectionRefundAmount"=expected
      and r."rejectionRefundDate" is not distinct from refund_date
      and r."rejectionRefundReference" is not distinct from nullif(trim(p_refund_reference),'') then
      return jsonb_build_object('cancelled',true);
    end if;
    raise sqlstate 'PT409' using message='Esta reserva já está cancelada.';
  end if;
  if r.status not in ('pending_payment','confirmed') then raise sqlstate 'PT409' using message='Estado da reserva não permite reprovação.'; end if;
  select coalesce(sum(case when kind='receipt' then amount when kind='refund' then -amount else 0 end),0)
    into balance from public.financial_transactions where reservation_id=p_id;
  if balance<>expected then raise sqlstate 'PT409' using message='Os recebimentos mudaram. Atualize a lista e confira novamente o valor a devolver.'; end if;
  if balance>0 then
    perform public.booking_finance_post(jsonb_build_object('key',p_key,'reservationId',p_id,'kind','refund',
      'amount',balance::text,'occurredOn',p_refund_date,'reference',trim(p_refund_reference),
      'description','Devolução por reprovação: '||left(trim(p_reason),470),'category','devolucao'));
  end if;
  update public."preReservations" set status='cancelled',"paymentConfirmedAt"=r."paymentConfirmedAt",
    "rejectionReason"=trim(p_reason),"rejectedAt"=now(),"rejectedBy"=auth.uid(),
    "rejectionRefundAmount"=expected,"rejectionRefundDate"=refund_date,
    "rejectionRefundReference"=nullif(trim(p_refund_reference),''),"rejectionKey"=p_key,"rejectionChecked"=p_checked where id=p_id;
  update booking_private.email_deliveries set status='cancelled',attachment=null,updated_at=now() where record_id=p_id and status<>'sent';
  return jsonb_build_object('cancelled',true);
exception when unique_violation then raise sqlstate 'PT409' using message='Identificador já utilizado em outro lançamento.';
end;
$$;
revoke all on function public.booking_finance_reject(uuid,text,text,text,text,boolean,uuid) from public,anon,authenticated;
grant execute on function public.booking_finance_reject(uuid,text,text,text,text,boolean,uuid) to authenticated;

-- Retain the existing view columns and append the rejection details.
do $$ declare definition text; begin
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='pre_reservas_canceladas' and column_name='rejectionReason') then
    definition:=rtrim(pg_get_viewdef('public.pre_reservas_canceladas'::regclass,true),E'; \n');
    execute 'create or replace view public.pre_reservas_canceladas with (security_invoker=true) as select previous.*,r."rejectionReason",r."rejectedAt",r."rejectionRefundAmount",r."rejectionRefundDate",r."rejectionRefundReference" from ('||definition||') previous join public."preReservations" r on r.id=previous.id';
  end if;
end $$;
notify pgrst,'reload schema';
commit;
