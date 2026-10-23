const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');

test('simplified finance negotiates, approves atomically and separates cancelled records', async t => {
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
  for (const rate of [null, '0', '-1', '1.234', 'abc']) await assert.rejects(call('booking_finance_negotiate', [booking.id, rate, 'Desconto']), e => e.code === 'PT400');
  await assert.rejects(call('booking_finance_negotiate', [booking.id, '350', '  ']), e => e.code === 'PT400');
  await assert.rejects(call('booking_finance_negotiate', [randomUUID(), '350', 'Desconto']), e => e.code === 'PT404');
  assert.equal((await call('booking_finance_negotiate', [booking.id, '350', 'Desconto'])).totalAmount, 700);
  await call('booking_finance_negotiate', [booking.id, '350', 'Tentativa repetida']);
  await db.exec('reset role');
  assert.equal((await db.query('select count(*)::int n from booking_private.finance_price_changes')).rows[0].n, 1);
  await claims();
  await post(booking.id, 'receipt', '100');
  await assert.rejects(call('booking_finance_negotiate', [booking.id, '300', 'Novo desconto']), e => e.code === 'PT409');
  const approval=[booking.id,'600',today,'PIX-MANUAL-600',randomUUID()];
  assert.equal((await call('booking_finance_approve', approval)).status, 'confirmed');
  await call('booking_finance_approve', approval);
  let data = await call('booking_finance_overview', ['2038-11']);
  assert.equal(data.reservations[0].received, 700); assert.equal(data.reservations[0].status, 'confirmed');
  assert.equal(data.reservations[0].amountDue, 0); assert.equal(data.transactionCount, undefined);
  assert.equal((await call('booking_finance_dashboard', [today.slice(0,7)])).transactionCount, 2);
  await assert.rejects(call('booking_finance_cancel', [booking.id]), e => e.code === 'PT409');
  await assert.rejects(call('booking_finance_negotiate', [booking.id, '300', 'Desconto']), e => e.code === 'PT409');
  await db.exec('reset role');
  const next = await call('booking_create_reservation', [{...person, startDate:'2038-11-03', endDate:'2038-11-04'}]);
  await claims(); await call('booking_finance_cancel', [next.id]);
  data = await call('booking_finance_overview', ['2038-11']);
  assert.equal(data.reservationCount, 1); assert.equal(data.reservations.length, 1); assert.equal(data.reservations[0].reservationId, booking.id);
  assert.equal((await db.query('select count(*)::int n from public.pre_reservas_canceladas where id=$1', [next.id])).rows[0].n, 1);
  await assert.rejects(call('booking_finance_approve', [next.id,'100',today,'PIX-CANCELLED',randomUUID()]), e => e.code === 'PT404');
  await assert.rejects(call('booking_finance_negotiate', [next.id, '300', 'Desconto']), e => e.code === 'PT409');
  await assert.rejects(call('booking_finance_overview', ['2038-11', -1]), e => e.code === 'PT400');
  for (const [id, aal] of [[admin, 'aal1'], [outsider, 'aal2']]) {
    await claims(id, aal);
    for (const [rpc, args] of [['booking_finance_overview',['2038-11']], ['booking_finance_approve',[booking.id,'100',today,'PIX-UNAUTHORIZED',randomUUID()]], ['booking_finance_negotiate',[booking.id,'300','Desconto']]])
      await assert.rejects(call(rpc,args), e=>e.code==='PT403');
  }
});
