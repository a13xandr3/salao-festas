begin;
create or replace function public.booking_finance_expenses(p_month text,p_page integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare first_day date; last_day date; total numeric; records jsonb; entry_count integer;
begin
  if not booking_private.is_admin() then raise sqlstate 'PT403' using message='Acesso restrito.'; end if;
  first_day:=booking_private.finance_month(p_month); last_day:=(first_day+interval '1 month')::date;
  if p_page is null or p_page not between 0 and 100000 then raise sqlstate 'PT400' using message='Página inválida.'; end if;
  select coalesce(sum(amount),0),count(*) into total,entry_count from public.financial_transactions
    where kind='expense' and occurred_on>=first_day and occurred_on<last_day;
  select coalesce(jsonb_agg(to_jsonb(x) order by x."occurredOn" desc,x."createdAt" desc,x.id),'[]'::jsonb) into records
    from (select id,occurred_on as "occurredOn",description,amount,created_at as "createdAt" from public.financial_transactions
      where kind='expense' and occurred_on>=first_day and occurred_on<last_day
      order by occurred_on desc,created_at desc,id limit 50 offset p_page*50) x;
  return jsonb_build_object('month',p_month,'total',total,'count',entry_count,'entries',records);
end;
$$;
revoke all on function public.booking_finance_expenses(text,integer) from public,anon,authenticated;
grant execute on function public.booking_finance_expenses(text,integer) to authenticated;
notify pgrst,'reload schema';
commit;
