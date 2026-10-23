const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');

test('financial cancellation preserves history and rejects confirmed reservations', async t => {
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
  await post(booking.id, 'receipt', '100');
  assert.equal((await call('booking_finance_cancel', [booking.id])).cancelled, true);
  assert.equal((await call('booking_finance_cancel', [booking.id])).cancelled, true);
  const data = await call('booking_finance_dashboard', ['2038-11']);
  assert.equal(data.reservations[0].status, 'cancelled'); assert.equal(data.reservations[0].received, 100); assert.equal(data.reservations[0].amountDue, 0);
  await db.exec('reset role');
  assert.equal((await db.query("select count(*)::int n from booking_private.email_deliveries where record_id=$1 and status<>'cancelled'", [booking.id])).rows[0].n, 0);
  const next = await call('booking_create_reservation', [person]);
  await claims(); await post(next.id, 'receipt', '800');
  await assert.rejects(call('booking_finance_cancel', [next.id]), e => e.code === 'PT409');
  await post(next.id, 'refund', '100');
  await assert.rejects(call('booking_finance_cancel', [next.id]), e => e.code === 'PT409');
  await db.exec('reset role');
  await db.query('update public."preReservations" set "paymentConfirmedAt"=now() where id=$1', [next.id]);
  await claims(); await assert.rejects(call('booking_finance_cancel', [next.id]), e => e.code === 'PT409');
});
