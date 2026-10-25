begin;
-- Aluguel Avulso is an outgoing expense, never rental revenue.
alter table public.financial_transactions drop constraint if exists financial_transactions_category_check;
alter table public.financial_transactions add constraint financial_transactions_category_check
  check (category in ('locacao','limpeza','manutencao','agua','energia','fornecedores','devolucao','ajuste','outros','aluguel_avulso'));
do $$ begin
  alter table public.financial_transactions add constraint finance_aluguel_avulso_expense_check
    check (category<>'aluguel_avulso' or kind='expense');
exception when duplicate_object then null; end $$;

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
    or (p_input->>'category'='aluguel_avulso' and p_input->>'kind'<>'expense')
    or (p_input ? 'reference' and jsonb_typeof(p_input->'reference') not in ('string','null'))
    or length(coalesce(p_input->>'reference',''))>120
    or (p_input ? 'category' and coalesce(p_input->>'category','') not in ('locacao','limpeza','manutencao','agua','energia','fornecedores','devolucao','ajuste','outros','aluguel_avulso')) then
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

notify pgrst,'reload schema';
commit;
