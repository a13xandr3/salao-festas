begin;
do $$ begin
  if to_regclass('public.pre_reservas_canceladas') is null then
    execute 'create view public.pre_reservas_canceladas with (security_invoker=true) as select id,name,email,phone,"startDate","endDate",status,"createdAt" from public."preReservations" where status=''cancelled''';
  end if;
end $$;
revoke all on public.pre_reservas_canceladas from public,anon;
grant select on public.pre_reservas_canceladas to authenticated;
-- Preserve negotiated prices and authors without granting direct access to customers.
create table if not exists booking_private.finance_price_changes (
  id uuid primary key default gen_random_uuid(), reservation_id uuid not null references public."preReservations"(id),
  old_daily_rate numeric(12,2), new_daily_rate numeric(12,2) not null,
  reason text not null, created_by uuid not null references auth.users(id), created_at timestamptz not null default now()
);
revoke all on booking_private.finance_price_changes from public,anon,authenticated;

create or replace function booking_private.finance_price_snapshot()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op='INSERT' then
    new."stayDays":=new."endDate"-new."startDate";
    new."dailyRate":=coalesce(new."dailyRate",(select daily_rate from booking_private.finance_control where singleton));
    new."totalAmount":=new."stayDays"*new."dailyRate";
  elsif (new."startDate",new."endDate") is distinct from (old."startDate",old."endDate") then
    raise sqlstate 'PT409' using message='O período registrado não pode ser alterado.';
  elsif old."totalAmount" is not null and (new."stayDays",new."dailyRate",new."totalAmount") is distinct from (old."stayDays",old."dailyRate",old."totalAmount") then
    if not booking_private.is_admin() or old.status<>'pending_payment' or old."paymentConfirmedAt" is not null
      or exists(select 1 from public.financial_transactions where reservation_id=old.id and kind in ('receipt','refund')) then
      raise sqlstate 'PT409' using message='Não é possível negociar uma reserva confirmada ou com pagamentos registrados.';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.booking_finance_negotiate(p_id uuid,p_daily_rate text,p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public."preReservations"; rate numeric;
begin
  if not booking_private.is_admin() then raise sqlstate 'PT403' using message='Acesso restrito.'; end if;
  if p_daily_rate is null or p_daily_rate !~ '^[0-9]{1,8}([.][0-9]{1,2})?$' or p_daily_rate::numeric<=0
    or p_reason is null or length(trim(p_reason)) not between 1 and 500 then
    raise sqlstate 'PT400' using message='Informe diária positiva com até duas casas decimais e o motivo da negociação.';
  end if;
  perform 1 from booking_private.finance_control where singleton for update;
  select * into r from public."preReservations" where id=p_id for update;
  if not found then raise sqlstate 'PT404' using message='Pré-reserva não encontrada.'; end if;
  if r.status<>'pending_payment' or r."paymentConfirmedAt" is not null
    or exists(select 1 from public.financial_transactions where reservation_id=p_id and kind in ('receipt','refund')) then
    raise sqlstate 'PT409' using message='Negocie o valor antes de aprovar ou registrar pagamentos.';
  end if;
  rate:=p_daily_rate::numeric;
  if rate*(r."endDate"-r."startDate")>9999999999.99 then raise sqlstate 'PT400' using message='Valor acima do limite.'; end if;
  if r."dailyRate" is distinct from rate then
    insert into booking_private.finance_price_changes(reservation_id,old_daily_rate,new_daily_rate,reason,created_by)
      values(p_id,r."dailyRate",rate,trim(p_reason),auth.uid());
    update public."preReservations" set "dailyRate"=rate,"stayDays"="endDate"-"startDate","totalAmount"=rate*("endDate"-"startDate") where id=p_id;
  end if;
  return jsonb_build_object('id',p_id,'totalAmount',rate*(r."endDate"-r."startDate"));
end;
$$;

create or replace function public.booking_finance_approve(p_id uuid)
returns jsonb language sql security definer set search_path = '' as $$
  select public.booking_confirm_payment(p_id);
$$;

-- Filter cancelled records before counting and pagination, retaining all financial totals.
create or replace function public.booking_finance_overview(p_month text,p_reservation_page integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb; first_day date; records jsonb; total integer;
begin
  result:=public.booking_finance_dashboard(p_month,0,p_reservation_page);
  first_day:=booking_private.finance_month(p_month);
  select count(*) into total from public.finance_receivables
    where "startDate">=first_day and "startDate"<(first_day+interval '1 month')::date and status<>'cancelled';
  select coalesce(jsonb_agg(to_jsonb(x) order by x."startDate",x."reservationId"),'[]'::jsonb) into records
    from (select * from public.finance_receivables where "startDate">=first_day and "startDate"<(first_day+interval '1 month')::date
      and status<>'cancelled' order by "startDate","reservationId" limit 50 offset p_reservation_page*50) x;
  return (result-'transactions'-'transactionCount')||jsonb_build_object('reservations',records,'reservationCount',total);
end;
$$;
revoke all on function public.booking_finance_negotiate(uuid,text,text),public.booking_finance_approve(uuid),public.booking_finance_overview(text,integer) from public,anon,authenticated;
grant execute on function public.booking_finance_negotiate(uuid,text,text),public.booking_finance_approve(uuid),public.booking_finance_overview(text,integer) to authenticated;
notify pgrst,'reload schema';
commit;
