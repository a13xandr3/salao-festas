-- Excluded expenses remain in the audit trail and cease contributing to the cash book.
begin;
alter table public.financial_transactions
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid references auth.users(id);
do $$ begin
  alter table public.financial_transactions add constraint finance_expense_void_check check (
    (voided_at is null and voided_by is null) or (kind='expense' and voided_at is not null and voided_by is not null)
  );
exception when duplicate_object then null; end $$;

create or replace function public.booking_finance_delete_expense(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare entry public.financial_transactions;
begin
  if not booking_private.is_admin() then raise sqlstate 'PT403' using message='Acesso restrito.'; end if;
  perform 1 from booking_private.finance_control where singleton for update;
  select * into entry from public.financial_transactions where id=p_id for update;
  if not found then raise sqlstate 'PT404' using message='Despesa não encontrada.'; end if;
  if entry.kind<>'expense' then raise sqlstate 'PT409' using message='Somente despesas podem ser excluídas por esta ação.'; end if;
  if entry.voided_at is null then
    update public.financial_transactions set voided_at=now(),voided_by=auth.uid() where id=p_id;
  end if;
  return jsonb_build_object('deleted',true);
end;
$$;
revoke all on function public.booking_finance_delete_expense(uuid) from public,anon,authenticated;
grant execute on function public.booking_finance_delete_expense(uuid) to authenticated;

create or replace view public.finance_cash_flow with (security_invoker=true) as
select t.id,t.reservation_id as "reservationId",r.name,t.kind,t.amount,t.category,t.occurred_on as "occurredOn",
  t.description,t.external_reference as "externalReference",t.created_by as "createdBy",t.created_at as "createdAt",
  case when t.kind in ('receipt','opening_in') then t.amount else -t.amount end as "signedAmount"
from public.financial_transactions t left join public."preReservations" r on r.id=t.reservation_id where t.voided_at is null;
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
  select count(*) into entry_count from public.financial_transactions where voided_at is null and occurred_on>=first_day and occurred_on<last_day;
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

create or replace function public.booking_finance_expenses(p_month text,p_page integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare first_day date; last_day date; total numeric; records jsonb; entry_count integer;
begin
  if not booking_private.is_admin() then raise sqlstate 'PT403' using message='Acesso restrito.'; end if;
  first_day:=booking_private.finance_month(p_month); last_day:=(first_day+interval '1 month')::date;
  if p_page is null or p_page not between 0 and 100000 then raise sqlstate 'PT400' using message='Página inválida.'; end if;
  select coalesce(sum(amount),0),count(*) into total,entry_count from public.financial_transactions
    where voided_at is null and kind='expense' and occurred_on>=first_day and occurred_on<last_day;
  select coalesce(jsonb_agg(to_jsonb(x) order by x."occurredOn" desc,x."createdAt" desc,x.id),'[]'::jsonb) into records
    from (select id,occurred_on as "occurredOn",description,amount,created_at as "createdAt" from public.financial_transactions
      where voided_at is null and kind='expense' and occurred_on>=first_day and occurred_on<last_day
      order by occurred_on desc,created_at desc,id limit 50 offset p_page*50) x;
  return jsonb_build_object('month',p_month,'total',total,'count',entry_count,'entries',records);
end;
$$;
revoke all on function public.booking_finance_expenses(text,integer) from public,anon,authenticated;
grant execute on function public.booking_finance_expenses(text,integer) to authenticated;
notify pgrst,'reload schema';
commit;
