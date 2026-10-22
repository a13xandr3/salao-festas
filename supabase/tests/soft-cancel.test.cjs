const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');

test('reservation cancellation preserves history', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql as 'select null::uuid';
    grant usage on schema public to anon, authenticated, service_role;`);
  for (const name of ['202610190001_booking.sql', '202610200001_gmail.sql', '202610200002_email_queue.sql', '202610210001_soft_cancel_reservation.sql'])
    await db.exec(readFileSync('supabase/migrations/' + name, 'utf8'));
  const migration = readFileSync('supabase/migrations/202610210001_soft_cancel_reservation.sql', 'utf8');
  const call = async (name, args = []) => (await db.query(
    `select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) as result`, args,
  )).rows[0].result;
  const input = { name: 'Cliente Teste', phone: '11999999999', email: 'soft-cancel@example.com', startDate: '2038-09-01', endDate: '2038-09-02' };
  const reservation = await call('booking_create_reservation', [input]);
  const other = await call('booking_create_reservation', [{ ...input, startDate: '2038-09-02', endDate: '2038-09-03' }]);
  const original = (await db.query('select * from public."preReservations" where id=$1', [reservation.id])).rows[0];

  await t.test('invalid ownership cannot change a record or its pending notifications', async () => {
    await db.exec('set role anon');
    for (const token of [null, '', 'invalid', 'b'.repeat(64)])
      await assert.rejects(call('booking_cancel_reservation', [reservation.id, token]), e => e.code === 'PT404');
    await assert.rejects(call('booking_cancel_reservation', ['00000000-0000-4000-8000-000000000001', reservation.notificationToken]), e => e.code === 'PT404');
    await db.exec('reset role');
    assert.equal((await db.query('select status from public."preReservations" where id=$1', [reservation.id])).rows[0].status, 'pending_payment');
    assert.ok((await db.query('select status from booking_private.email_deliveries where record_id=$1', [reservation.id])).rows.every(r => r.status === 'pending'));
  });
  await t.test('an anonymous owner updates only status and releases the period', async () => {
    await db.exec('set role anon');
    assert.deepEqual(await call('booking_cancel_reservation', [reservation.id, reservation.notificationToken]), { cancelled: true });
    const calendar = await call('booking_availability', ['2038-09']);
    assert.equal(calendar.days.find(d => d.date === '2038-09-01').status, 'free');
    assert.equal(calendar.days.find(d => d.date === '2038-09-02').status, 'reserved');
    await assert.rejects(db.query('select * from public."preReservations"'), e => e.code === '42501');
    await db.exec('reset role');
    const preserved = (await db.query('select * from public."preReservations" where id=$1', [reservation.id])).rows[0];
    assert.deepEqual(preserved, { ...original, status: 'cancelled' });
    assert.equal((await db.query('select status from public."preReservations" where id=$1', [other.id])).rows[0].status, 'pending_payment');
    assert.ok((await db.query('select status from booking_private.email_deliveries where record_id=$1', [reservation.id])).rows.every(r => r.status === 'cancelled'));
  });
  await t.test('cancelled records cannot be used again for cancellation, contract or email requests', async () => {
    await assert.rejects(call('booking_cancel_reservation', [reservation.id, reservation.notificationToken]), e => e.code === 'PT404');
    await assert.rejects(call('booking_owned_reservation', [reservation.id, reservation.notificationToken, true]), e => e.code === 'PT409');
    await db.exec('set role service_role');
    await assert.rejects(call('booking_request_email', ['reservation', reservation.id, reservation.notificationToken]), e => e.code === 'PT409');
    await db.exec('reset role');
  });
  await t.test('allows a new reservation for the released period without erasing the old record', async () => {
    const replacement = await call('booking_create_reservation', [input]);
    assert.notEqual(replacement.id, reservation.id);
    assert.equal((await db.query('select count(*)::integer n from public."preReservations"')).rows[0].n, 3);
  });
  await t.test('supports confirmed reservations and preserves sent email history', async () => {
    await db.query('update public."preReservations" set status=$1 where id=$2', ['confirmed', other.id]);
    await db.query("update booking_private.email_deliveries set status='sent' where record_id=$1 and role='manager'", [other.id]);
    await db.exec('set role anon');
    await call('booking_cancel_reservation', [other.id, other.notificationToken]);
    await db.exec('reset role');
    const statuses = (await db.query('select role,status from booking_private.email_deliveries where record_id=$1 order by role', [other.id])).rows;
    assert.deepEqual(statuses, [{ role: 'customer', status: 'cancelled' }, { role: 'manager', status: 'sent' }]);
  });
  await t.test('reapplying the migration preserves rows and permissions', async () => {
    await db.exec(migration);
    assert.equal((await db.query('select count(*)::integer n from public."preReservations"')).rows[0].n, 3);
    await db.exec('set role anon');
    const active = await call('booking_create_reservation', [{ ...input, startDate: '2038-10-01', endDate: '2038-10-02' }]);
    assert.deepEqual(await call('booking_cancel_reservation', [active.id, active.notificationToken]), { cancelled: true });
  });
});
