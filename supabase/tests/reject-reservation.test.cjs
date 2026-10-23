const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');

test('rejection records its reason and atomically refunds the recorded balance', async t => {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
    create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;
    grant usage on schema public,auth to anon,authenticated,service_role;`);
  for (const file of readdirSync('supabase/migrations').filter(f => f.endsWith('.sql')).sort()) await db.exec(readFileSync('supabase/migrations/' + file, 'utf8'));
  const admin = randomUUID(), outsider = randomUUID();
  await db.query('insert into auth.users(id) values($1),($2)', [admin, outsider]);
  await db.query('insert into booking_private.admins(user_id) values($1)', [admin]);
  const call = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
  const claims = async (sub = admin, aal = 'aal2') => {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub, aal })]);
    await db.exec('set role authenticated');
  };
  const person = { name: 'Cancellation Test', phone: '11999999999', email: 'cancel@example.com', startDate: '2038-11-01', endDate: '2038-11-03' };
  const booking = await call('booking_create_reservation', [person]);
  await db.exec('set role anon');
  await assert.rejects(call('booking_finance_cancel', [booking.id]), e => e.code === '42501');
  for (const [id, aal] of [[admin, 'aal1'], [outsider, 'aal2']]) {
    await claims(id, aal); await assert.rejects(call('booking_finance_cancel', [booking.id]), e => e.code === 'PT403');
  }
  await claims();
  await assert.rejects(call('booking_finance_cancel', [randomUUID()]), e => e.code === 'PT404');
  const today = (await db.query("select to_char((now() at time zone 'America/Sao_Paulo')::date,'YYYY-MM-DD') d")).rows[0].d;
  const post = (id, kind, amount) => call('booking_finance_post', [{ key: randomUUID(), kind, amount, occurredOn: today, description: 'Test', reference: randomUUID(), reservationId: id }]);
  const reject=(id,reason,amount='0',date=null,reference=null,key=randomUUID(),checked=true)=>call('booking_finance_reject',[id,reason,amount,date,reference,checked,key]);
  await assert.rejects(reject(booking.id,'  '),e=>e.code==='PT400');
  await assert.rejects(reject(booking.id,'Desistência','0',null,null,randomUUID(),false),e=>e.code==='PT400');
  const key=randomUUID();await reject(booking.id,' Cliente desistiu ','0',null,null,key);
  await reject(booking.id,'Cliente desistiu','0',null,null,key);
  await assert.rejects(reject(booking.id,'Motivo alterado','0',null,null,key),e=>e.code==='PT409');
  let cancelled=(await db.query('select * from public.pre_reservas_canceladas where id=$1',[booking.id])).rows[0];
  assert.equal(cancelled.rejectionReason,'Cliente desistiu');assert.equal(Number(cancelled.rejectionRefundAmount),0);assert.ok(cancelled.rejectedAt);
  assert.equal((await call('booking_finance_overview',['2038-11'])).reservationCount,0);
  await db.exec('reset role');
  const paid=await call('booking_create_reservation',[person]);await claims();
  await call('booking_finance_approve',[paid.id,'800',today,'PIX-PAID',randomUUID()]);
  await assert.rejects(reject(paid.id,'Desistência','799',today,'REF-799'),e=>e.code==='PT409');
  for(const [date,reference] of [[null,'REF'],[today,''],['2038-11-01','REF'],['2026-02-30','REF']]) {
    await assert.rejects(reject(paid.id,'Desistência','800',date,reference),e=>e.code==='PT400');
  }
  assert.equal((await call('booking_finance_overview',['2038-11'])).reservations[0].status,'confirmed');
  const refundKey=randomUUID();await reject(paid.id,'Desistência após pagamento','800',today,'REFUND-800',refundKey);
  await reject(paid.id,'Desistência após pagamento','800',today,'REFUND-800',refundKey);
  cancelled=(await db.query('select * from public.pre_reservas_canceladas where id=$1',[paid.id])).rows[0];
  assert.equal(Number(cancelled.rejectionRefundAmount),800);
  assert.equal((await db.query('select "rejectionChecked" from public."preReservations" where id=$1',[paid.id])).rows[0].rejectionChecked,true);assert.equal(cancelled.rejectionRefundReference,'REFUND-800');
  const history=await call('booking_finance_dashboard',[today.slice(0,7)]);assert.equal(history.transactionCount,2);assert.equal(history.summary.closingBalance,0);
  assert.equal((await db.query("select count(*)::int n from public.financial_transactions where reservation_id=$1 and kind='refund'",[paid.id])).rows[0].n,1);
  await db.exec('reset role');
  const legacy=await call('booking_create_reservation',[person]);await db.query('update public."preReservations" set status=$1,"paymentConfirmedAt"=now() where id=$2',['confirmed',legacy.id]);await claims();
  await reject(legacy.id,'Conferido extrato: sem recebimento registrado');
  assert.equal((await call('booking_finance_dashboard',[today.slice(0,7)])).transactionCount,2);
  await assert.rejects(reject(randomUUID(),'Desistência'),e=>e.code==='PT404');
  for(const [id,aal] of [[admin,'aal1'],[outsider,'aal2']]) {await claims(id,aal);await assert.rejects(reject(legacy.id,'Desistência'),e=>e.code==='PT403');}
  await db.exec('reset role;set role anon');await assert.rejects(reject(legacy.id,'Desistência'),e=>e.code==='42501');
  await db.exec('reset role');await db.exec(readFileSync('supabase/migrations/202610230004_reject_reservation.sql','utf8'));
});
