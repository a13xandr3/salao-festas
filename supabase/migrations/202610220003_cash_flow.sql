-- Append-only cash book. Existing reservations/payments are never guessed or backfilled.
begin;
create table if not exists booking_private.finance_control (
  singleton boolean primary key default true check (singleton),
  daily_rate numeric(12,2) not null default 400.00 check (daily_rate > 0)
);
insert into booking_private.finance_control(singleton) values(true) on conflict do nothing;
revoke all on booking_private.finance_control from public, anon, authenticated;

alter table public."preReservations" add column if not exists "stayDays" integer;
alter table public."preReservations" add column if not exists "dailyRate" numeric(12,2);
alter table public."preReservations" add column if not exists "totalAmount" numeric(12,2);
do $$ begin
  alter table public."preReservations" add constraint finance_price_consistency check (
    ("stayDays" is null and "dailyRate" is null and "totalAmount" is null)
    or ("stayDays" is not null and "dailyRate" is not null and "totalAmount" is not null
      and "stayDays" = "endDate" - "startDate" and "stayDays" > 0
      and "dailyRate" > 0 and "totalAmount" = "stayDays" * "dailyRate")
  );
exception when duplicate_object then null; end $$;
create or replace function booking_private.finance_price_snapshot()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new."stayDays" := new."endDate" - new."startDate";
    new."dailyRate" := coalesce(new."dailyRate", (select daily_rate from booking_private.finance_control where singleton));
    new."totalAmount" := new."stayDays" * new."dailyRate";
  elsif old."totalAmount" is not null and
    (new."stayDays",new."dailyRate",new."totalAmount",new."startDate",new."endDate") is distinct from
    (old."stayDays",old."dailyRate",old."totalAmount",old."startDate",old."endDate") then
    raise sqlstate 'PT409' using message = 'O valor contratado e o período já registrados não podem ser alterados.';
  end if;
  return new;
end;
$$;
drop trigger if exists finance_price_snapshot on public."preReservations";
create trigger finance_price_snapshot before insert or update on public."preReservations"
  for each row execute function booking_private.finance_price_snapshot();

create table if not exists public.financial_transactions (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid references public."preReservations"(id) on delete restrict,
  kind text not null check (kind in ('receipt','expense','refund','opening_in','opening_out')),
  amount numeric(12,2) not null check (amount > 0),
  category text not null check (category in ('locacao','limpeza','manutencao','agua','energia','fornecedores','devolucao','ajuste','outros')),
  occurred_on date not null,
  description text not null check (length(description) between 1 and 500),
  external_reference text,
  idempotency_key uuid not null unique,
  request jsonb not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (kind not in ('receipt','refund') or reservation_id is not null),
  check (kind <> 'receipt' or nullif(trim(external_reference),'') is not null)
);
create unique index if not exists finance_unique_receipt_reference
  on public.financial_transactions(lower(external_reference)) where kind='receipt';
create index if not exists finance_transaction_period on public.financial_transactions(occurred_on desc,created_at desc,id);
create index if not exists finance_transaction_reservation on public.financial_transactions(reservation_id);
alter table public.financial_transactions enable row level security;
revoke all on public.financial_transactions from public, anon, authenticated;
grant select on public.financial_transactions to authenticated;
drop policy if exists finance_admin_read on public.financial_transactions;
create policy finance_admin_read on public.financial_transactions for select to authenticated
  using ((select booking_private.is_admin()));

create or replace view public.finance_receivables with (security_invoker=true) as
select r.id as "reservationId",r.name,r."startDate",r."endDate",r.status,r."stayDays",r."dailyRate",r."totalAmount",
  coalesce(t.received,0) as received,coalesce(t.refunded,0) as refunded,
  case when r.status='cancelled' then 0 else greatest(r."totalAmount"-coalesce(t.received,0)+coalesce(t.refunded,0),0) end as "amountDue",
  greatest(coalesce(t.received,0)-coalesce(t.refunded,0),0) as "refundableAmount"
from public."preReservations" r left join lateral (
  select sum(amount) filter(where kind='receipt') as received,sum(amount) filter(where kind='refund') as refunded
  from public.financial_transactions where reservation_id=r.id
) t on true;
create or replace view public.finance_cash_flow with (security_invoker=true) as
select t.id,t.reservation_id as "reservationId",r.name,t.kind,t.amount,t.category,t.occurred_on as "occurredOn",
  t.description,t.external_reference as "externalReference",t.created_by as "createdBy",t.created_at as "createdAt",
  case when t.kind in ('receipt','opening_in') then t.amount else -t.amount end as "signedAmount"
from public.financial_transactions t left join public."preReservations" r on r.id=t.reservation_id;
revoke all on public.finance_receivables,public.finance_cash_flow from public, anon, authenticated;
grant select on public.finance_receivables,public.finance_cash_flow to authenticated;

create or replace function booking_private.finance_month(p_month text)
returns date language plpgsql immutable set search_path = '' as $$
begin
  if p_month is null or p_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' or left(p_month,4)='0000' then
    raise sqlstate 'PT400' using message='Informe o mês no formato AAAA-MM.';
  end if;
  return (p_month||'-01')::date;
end;
$$;

create or replace function public.booking_finance_dashboard(p_month text,p_page integer default 0,p_reservation_page integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare first_day date; last_day date; summary jsonb; entries jsonb; reservations jsonb; entry_count integer; reservation_count integer;
begin
  if not booking_private.is_admin() then raise sqlstate 'PT403' using message='Acesso restrito.'; end if;
  first_day := booking_private.finance_month(p_month); last_day := (first_day+interval '1 month')::date;
  if p_page is null or p_reservation_page is null or p_page not between 0 and 100000 or p_reservation_page not between 0 and 100000 then
    raise sqlstate 'PT400' using message='Página inválida.';
  end if;
  select jsonb_build_object(
    'openingBalance',coalesce(sum("signedAmount") filter(where "occurredOn"<first_day),0),
    'income',coalesce(sum("signedAmount") filter(where "occurredOn">=first_day and "signedAmount">0),0),
    'expenses',coalesce(-sum("signedAmount") filter(where "occurredOn">=first_day and "signedAmount"<0),0),
    'closingBalance',coalesce(sum("signedAmount"),0)) into summary
  from public.finance_cash_flow where "occurredOn"<last_day;
  summary := summary || (select jsonb_build_object(
    'amountDue',coalesce(sum("amountDue") filter(where status in ('pending_payment','confirmed')),0),
    'unpricedCount',count(*) filter(where "totalAmount" is null),
    'unreconciledCount',count(*) filter(where status='confirmed' and ("totalAmount" is null or received-refunded<"totalAmount")))
    from public.finance_receivables where "startDate">=first_day and "startDate"<last_day);
  select count(*) into entry_count from public.financial_transactions where occurred_on>=first_day and occurred_on<last_day;
  select coalesce(jsonb_agg(to_jsonb(x) order by x."occurredOn" desc,x."createdAt" desc,x.id),'[]'::jsonb) into entries
    from (select * from public.finance_cash_flow where "occurredOn">=first_day and "occurredOn"<last_day
      order by "occurredOn" desc,"createdAt" desc,id limit 50 offset p_page*50) x;
  select count(*) into reservation_count from public."preReservations" where "startDate">=first_day and "startDate"<last_day;
  select coalesce(jsonb_agg(to_jsonb(x) order by x."startDate",x."reservationId"),'[]'::jsonb) into reservations
    from (select * from public.finance_receivables where "startDate">=first_day and "startDate"<last_day
      order by "startDate","reservationId" limit 50 offset p_reservation_page*50) x;
  return jsonb_build_object('summary',summary,'transactions',entries,'reservations',reservations,
    'transactionCount',entry_count,'reservationCount',reservation_count);
end;
$$;

create or replace function public.booking_finance_price(p_id uuid,p_daily_rate text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public."preReservations"; rate numeric;
begin
  if not booking_private.is_admin() then raise sqlstate 'PT403' using message='Acesso restrito.'; end if;
  if p_daily_rate is null or p_daily_rate !~ '^[0-9]{1,8}([.][0-9]{1,2})?$' or p_daily_rate::numeric<=0 then
    raise sqlstate 'PT400' using message='Informe o valor da diária com até duas casas decimais.';
  end if;
  perform 1 from booking_private.finance_control where singleton for update;
  select * into r from public."preReservations" where id=p_id for update;
  if not found then raise sqlstate 'PT404' using message='Pré-reserva não encontrada.'; end if;
  rate:=p_daily_rate::numeric;
  if r."totalAmount" is not null then
    if r."dailyRate"=rate then return jsonb_build_object('id',r.id,'totalAmount',r."totalAmount"); end if;
    raise sqlstate 'PT409' using message='O valor contratado já foi definido.';
  end if;
  if rate*(r."endDate"-r."startDate")>9999999999.99 then raise sqlstate 'PT400' using message='Valor acima do limite.'; end if;
  update public."preReservations" set "dailyRate"=rate,"stayDays"="endDate"-"startDate","totalAmount"=rate*("endDate"-"startDate") where id=p_id returning * into r;
  return jsonb_build_object('id',r.id,'totalAmount',r."totalAmount");
end;
$$;

create or replace function public.booking_finance_post(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public."preReservations"; existing public.financial_transactions; entry public.financial_transactions;
  entry_key uuid; reservation uuid; amount numeric; paid numeric; effective date; kind text; description text; reference text;
begin
  if not booking_private.is_admin() then raise sqlstate 'PT403' using message='Acesso restrito.'; end if;
  if p_input is null or jsonb_typeof(p_input)<>'object'
    or exists(select 1 from jsonb_object_keys(p_input) k where k not in ('key','reservationId','kind','amount','occurredOn','description','reference','category'))
    or jsonb_typeof(p_input->'amount') is distinct from 'string'
    or coalesce(p_input->>'amount','') !~ '^[0-9]{1,8}([.][0-9]{1,2})?$'
    or coalesce(p_input->>'occurredOn','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or jsonb_typeof(p_input->'description') is distinct from 'string'
    or length(trim(p_input->>'description')) not between 1 and 500
    or coalesce(p_input->>'kind','') not in ('receipt','expense','refund','opening_in','opening_out')
    or (p_input ? 'reference' and jsonb_typeof(p_input->'reference') not in ('string','null'))
    or length(coalesce(p_input->>'reference',''))>120
    or (p_input ? 'category' and coalesce(p_input->>'category','') not in ('locacao','limpeza','manutencao','agua','energia','fornecedores','devolucao','ajuste','outros')) then
    raise sqlstate 'PT400' using message='Confira os dados da movimentação.';
  end if;
  begin
    entry_key:=(p_input->>'key')::uuid;
    reservation:=nullif(p_input->>'reservationId','')::uuid;
    effective:=(p_input->>'occurredOn')::date;
  exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format then
    raise sqlstate 'PT400' using message='Protocolo, data ou identificador inválido.';
  end;
  amount:=(p_input->>'amount')::numeric; kind:=p_input->>'kind';
  description:=trim(p_input->>'description'); reference:=nullif(trim(p_input->>'reference'),'');
  if entry_key is null or amount<=0 or effective is null or effective>(now() at time zone 'America/Sao_Paulo')::date
    or (kind in ('receipt','refund') and reservation is null) or (kind='receipt' and reference is null) then
    raise sqlstate 'PT400' using message='Informe valor positivo, data realizada, protocolo e identificador do recebimento.';
  end if;
  -- One control-row lock serializes financial writes and idempotency checks, including concurrent retries.
  perform 1 from booking_private.finance_control where singleton for update;
  select * into existing from public.financial_transactions where idempotency_key=entry_key;
  if found then
    if existing.request<>p_input then raise sqlstate 'PT409' using message='Identificador já utilizado em outra movimentação.'; end if;
    return jsonb_build_object('id',existing.id);
  end if;
  if reservation is not null then
    select * into r from public."preReservations" where id=reservation for update;
    if not found then raise sqlstate 'PT404' using message='Pré-reserva não encontrada.'; end if;
  end if;
  if kind in ('receipt','refund') then
    if r."totalAmount" is null then raise sqlstate 'PT409' using message='Defina primeiro o valor contratado da pré-reserva.'; end if;
    select coalesce(sum(case when t.kind='receipt' then t.amount when t.kind='refund' then -t.amount else 0 end),0)
      into paid from public.financial_transactions t where t.reservation_id=reservation;
    if (kind='receipt' and amount>r."totalAmount"-paid) or (kind='refund' and amount>paid) then
      raise sqlstate 'PT409' using message='Valor maior que o saldo a receber ou a devolver.';
    end if;
  end if;
  insert into public.financial_transactions(reservation_id,kind,amount,category,occurred_on,description,external_reference,idempotency_key,request,created_by)
    values(reservation,kind,amount,coalesce(p_input->>'category',case when kind='receipt' then 'locacao' when kind='refund' then 'devolucao' else 'outros' end),effective,description,reference,entry_key,p_input,auth.uid()) returning * into entry;
  if kind in ('receipt','refund') and r.status in ('pending_payment','confirmed') then
    paid:=paid+case when kind='receipt' then amount else -amount end;
    update public."preReservations" set status=case when paid="totalAmount" then 'confirmed' else 'pending_payment' end,
      "paymentConfirmedAt"=case when paid="totalAmount" then coalesce("paymentConfirmedAt",now()) else null end where id=reservation;
  end if;
  return jsonb_build_object('id',entry.id);
exception when unique_violation then
  raise sqlstate 'PT409' using message='Esse identificador de recebimento já foi registrado.';
end;
$$;

-- Existing administrative confirmation also writes the full outstanding receipt atomically.
create or replace function public.booking_confirm_payment(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public."preReservations"; paid numeric;
begin
  if not booking_private.is_admin() then raise sqlstate 'PT403' using message='Acesso restrito.'; end if;
  perform 1 from booking_private.finance_control where singleton for update;
  select * into r from public."preReservations" where id=p_id and status in ('pending_payment','confirmed') for update;
  if not found then raise sqlstate 'PT404' using message='Pré-reserva ativa não encontrada.'; end if;
  if r."totalAmount" is null then raise sqlstate 'PT409' using message='Defina primeiro o valor contratado.'; end if;
  select coalesce(sum(case when kind='receipt' then amount when kind='refund' then -amount else 0 end),0)
    into paid from public.financial_transactions where reservation_id=p_id;
  if paid<r."totalAmount" then
    perform public.booking_finance_post(jsonb_build_object('key',gen_random_uuid(),'reservationId',p_id,'kind','receipt',
      'amount',(r."totalAmount"-paid)::text,'occurredOn',(now() at time zone 'America/Sao_Paulo')::date,
      'description','Confirmação administrativa do pagamento','reference','confirmation:'||p_id::text||':'||gen_random_uuid()::text));
  end if;
  select * into r from public."preReservations" where id=p_id;
  return jsonb_build_object('id',r.id,'status',r.status,'paymentConfirmedAt',r."paymentConfirmedAt");
end;
$$;
revoke all on function booking_private.finance_month(text),booking_private.finance_price_snapshot() from public,anon,authenticated;
revoke all on function public.booking_finance_dashboard(text,integer,integer),public.booking_finance_price(uuid,text),public.booking_finance_post(jsonb) from public,anon,authenticated;
grant execute on function public.booking_finance_dashboard(text,integer,integer),public.booking_finance_price(uuid,text),public.booking_finance_post(jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
