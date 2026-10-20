const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');

test('Gmail migration protects capabilities and records accepted deliveries', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql as 'select null::uuid';
    grant usage on schema public to anon, authenticated, service_role;`);
  await db.exec(readFileSync('supabase/migrations/202610190001_booking.sql', 'utf8'));
  const migration = readFileSync('supabase/migrations/202610200001_gmail.sql', 'utf8');
  await db.exec(migration);
  await db.exec(migration);
  const call = async (name, args) =>
    (
      await db.query(
        `select public.${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) as result`,
        args,
      )
    ).rows[0].result;
  await db.exec('set role anon');
  const contact = await call('booking_create_contact', [
    {
      name: 'Contato Gmail',
      phone: '11999999999',
      email: 'contact@example.com',
      message: 'Consulta',
    },
  ]);
  assert.match(contact.deliveryToken, /^[a-f0-9]{64}$/);
  await assert.rejects(
    call('booking_claim_email', ['contact', contact.id, contact.deliveryToken, 'manager', '']),
    (error) => error.code === '42501',
  );
  await db.exec('reset role; set role service_role');
  await assert.rejects(
    call('booking_claim_email', ['contact', contact.id, 'b'.repeat(64), 'manager', '']),
    (error) => error.code === 'PT404',
  );
  const claimed = await call('booking_claim_email', [
    'contact',
    contact.id,
    contact.deliveryToken,
    'manager',
    '',
  ]);
  assert.equal(claimed.record.email, 'contact@example.com');
  assert.equal(claimed.record.emailDeliveryTokenHash, undefined);
  await assert.rejects(
    call('booking_claim_email', ['contact', contact.id, contact.deliveryToken, 'manager', '']),
    (error) => error.code === 'PT429',
  );
  await call('booking_finish_email', [claimed.claimId, false]);
  const retry = await call('booking_claim_email', [
    'contact',
    contact.id,
    contact.deliveryToken,
    'manager',
    '',
  ]);
  assert.notEqual(retry.claimId, claimed.claimId);
  await call('booking_finish_email', [retry.claimId, true]);
  assert.equal(
    (
      await call('booking_claim_email', [
        'contact',
        contact.id,
        contact.deliveryToken,
        'manager',
        '',
      ])
    ).alreadySent,
    true,
  );
  await db.exec('reset role');
  assert.equal(
    (await db.query('select "emailStatus" from public.contacts where id=$1', [contact.id])).rows[0]
      .emailStatus,
    'sent',
  );
  await db.exec('set role anon');
  const record = await call('booking_create_reservation', [
    {
      name: 'Reserva Gmail',
      phone: '11999999999',
      email: 'reservation@example.com',
      startDate: '2038-04-01',
      endDate: '2038-04-02',
    },
  ]);
  assert.equal(record.notifications.customer.provider, 'gmail');
  assert.equal(record.notifications.customer.status, 'pending');
  await db.exec('reset role; set role service_role');
  const manager = await call('booking_claim_email', [
    'reservation',
    record.id,
    record.notificationToken,
    'manager',
    '',
  ]);
  await call('booking_finish_email', [manager.claimId, true]);
  const customer = await call('booking_claim_email', [
    'reservation',
    record.id,
    record.notificationToken,
    'customer',
    '',
  ]);
  assert.equal(customer.alreadySent, false);
  await call('booking_finish_email', [customer.claimId, true]);
  await assert.rejects(
    call('booking_claim_email', ['contact', contact.id, contact.deliveryToken, 'customer', '']),
    (error) => error.code === 'PT400',
  );
  await db.exec('reset role');
  const state = (
    await db.query('select notifications from public."preReservations" where id=$1', [record.id])
  ).rows[0].notifications;
  assert.equal(state.customer.status, 'sent');
  assert.equal(state.manager.status, 'sent');
  await db.exec('set role service_role');
  for (const character of ['0','1','2','3','4']) {
    const pdf = await call('booking_claim_email', ['contract', record.id, record.notificationToken, 'manager', character.repeat(64)]);
    await call('booking_finish_email', [pdf.claimId, true]);
  }
  assert.equal((await call('booking_claim_email', ['contract', record.id, record.notificationToken, 'manager', '0'.repeat(64)])).alreadySent, true);
  await assert.rejects(call('booking_claim_email', ['contract', record.id, record.notificationToken, 'manager', '5'.repeat(64)]), error => error.code === 'PT429');
  await db.exec('reset role');

});
