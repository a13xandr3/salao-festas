const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');

test('manual payment approves only the amount supplied and preserves partial balances', async t => {
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
  const receipt = [booking.id, '300', today, 'PIX-PARTIAL', randomUUID()];
  assert.equal((await call('booking_finance_approve', receipt)).status, 'pending_payment');
  await call('booking_finance_approve', receipt);
  let data=await call('booking_finance_overview',['2038-11']);
  assert.equal(data.reservations[0].received,300);assert.equal(data.reservations[0].amountDue,500);
  await assert.rejects(call('booking_finance_approve',[booking.id]), e=>e.code==='42501');
  for(const amount of ['0','-1','1.234','NaN','501']) {
    await assert.rejects(call('booking_finance_approve',[booking.id,amount,today,'INVALID-'+amount,randomUUID()]),e=>['PT400','PT409'].includes(e.code));
  }
  await assert.rejects(call('booking_finance_approve',[booking.id,'100',today,'',randomUUID()]),e=>e.code==='PT400');
  await assert.rejects(call('booking_finance_approve',[booking.id,'300',today,'PIX-PARTIAL',randomUUID()]),e=>e.code==='PT409');
  assert.equal((await call('booking_finance_approve',[booking.id,'500',today,'PIX-FINAL',randomUUID()])).status,'confirmed');
  data=await call('booking_finance_overview',['2038-11']);
  assert.equal(data.reservations[0].received,800);assert.equal(data.reservations[0].amountDue,0);
  const dashboard=await call('booking_finance_dashboard',[today.slice(0,7)]);assert.equal(dashboard.transactionCount,2);
  await db.exec('reset role');
  const next=await call('booking_create_reservation',[{...person,startDate:'2038-11-03',endDate:'2038-11-04'}]);
  await claims();await call('booking_finance_cancel',[next.id]);
  await assert.rejects(call('booking_finance_approve',[next.id,'400',today,'CANCELLED',randomUUID()]),e=>e.code==='PT404');
  for(const [id,aal] of [[admin,'aal1'],[outsider,'aal2']]) {
    await claims(id,aal);await assert.rejects(call('booking_finance_approve',receipt),e=>e.code==='PT403');
  }
});
