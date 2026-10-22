const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');

test('public calendar distinguishes pending and confirmed payments', async (t) => {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql as 'select null::uuid';
    grant usage on schema public to anon, authenticated, service_role;`);
  for (const file of ['202610190001_booking.sql', '202610200001_gmail.sql', '202610200002_email_queue.sql', '202610210001_soft_cancel_reservation.sql', '202610220001_availability_payment_status.sql'])
    await db.exec(readFileSync('supabase/migrations/' + file, 'utf8'));
  const call = async (name, args) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
  const person = { name: 'Calendar Test', phone: '11999999999', email: 'calendar@example.com', startDate: '2038-02-27', endDate: '2038-03-01' };
  await db.exec('set role anon');
  const record = await call('booking_create_reservation', [person]);
  const february = await call('booking_availability', ['2038-02']);
  assert.equal(february.days.find(day => day.date === '2038-02-27').status, 'pre_reserved');
  assert.equal(february.days.find(day => day.date === '2038-02-28').status, 'pre_reserved');
  assert.equal(february.days.find(day => day.date === '2038-02-26').status, 'free');
  assert.equal((await call('booking_availability', ['2038-03'])).days[0].status, 'free');
  assert.ok(february.days.every(day => Object.keys(day).sort().join(',') === 'date,status'));
  await db.exec('reset role');
  await db.query('update public."preReservations" set status=$1 where id=$2', ['confirmed', record.id]);
  await db.exec('set role anon');
  assert.equal((await call('booking_availability', ['2038-02'])).days.find(day => day.date === '2038-02-27').status, 'reserved');
  await call('booking_cancel_reservation', [record.id, record.notificationToken]);
  assert.equal((await call('booking_availability', ['2038-02'])).days.find(day => day.date === '2038-02-27').status, 'free');
  await db.exec('reset role');
  await db.exec(readFileSync('supabase/migrations/202610220001_availability_payment_status.sql', 'utf8'));
  assert.equal((await db.query('select status from public."preReservations" where id=$1', [record.id])).rows[0].status, 'cancelled');
  await assert.rejects(call('booking_availability', ['invalid']), error => error.code === 'PT400');
});
