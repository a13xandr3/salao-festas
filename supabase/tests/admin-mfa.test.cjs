const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');

test('administrative access requires an allowlisted user and AAL2', async t => {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.jwt() returns jsonb language sql stable as
      $$select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb$$;
    create function auth.uid() returns uuid language sql stable as
      $$select (auth.jwt()->>'sub')::uuid$$;
    grant usage on schema public, auth to anon, authenticated, service_role;`);
  for (const file of readdirSync('supabase/migrations').filter(file => file.endsWith('.sql')).sort())
    await db.exec(readFileSync('supabase/migrations/' + file, 'utf8'));
  const admin = '00000000-0000-4000-8000-000000000001';
  const outsider = '00000000-0000-4000-8000-000000000002';
  await db.query('insert into auth.users(id) values ($1),($2)', [admin, outsider]);
  await db.query('insert into booking_private.admins(user_id) values ($1)', [admin]);
  const call = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
  const person = { name: 'MFA Test', phone: '11999999999', email: 'mfa@example.com', startDate: '2038-11-01', endDate: '2038-11-02' };
  const reservation = await call('booking_create_reservation', [person]);
  await call('booking_create_contact', [{ name: person.name, phone: person.phone, email: person.email, message: 'Administrative MFA test' }]);
  const claims = async (sub, aal) => db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub, aal })]);

  await t.test('anonymous requests cannot use administrative RPCs', async () => {
    await db.exec('set role anon');
    for (const rpc of ['booking_admin_access', 'booking_admin_eligible'])
      await assert.rejects(call(rpc), error => error.code === '42501');
    await db.exec('reset role');
  });
  await t.test('a password-only admin can enroll MFA but cannot read, mutate or confirm customer data', async () => {
    for (const level of [undefined, 'aal1']) {
      await claims(admin, level); await db.exec('set role authenticated');
      assert.equal(await call('booking_admin_eligible'), true);
      assert.equal(await call('booking_admin_access'), false);
      assert.equal((await db.query('select * from public.contacts')).rows.length, 0);
      assert.equal((await db.query('select * from public."preReservations"')).rows.length, 0);
      assert.equal((await db.query("update public.contacts set message='forged' returning id")).rows.length, 0);
      assert.equal((await db.query('delete from public."preReservations" returning id')).rows.length, 0);
      await assert.rejects(call('booking_confirm_payment', [reservation.id]), error => error.code === 'PT403');
      await assert.rejects(db.query('insert into booking_private.admins(user_id) values ($1)', [outsider]), error => error.code === '42501');
      await db.exec('reset role');
    }
  });
  await t.test('MFA alone never grants an outsider administrative permission', async () => {
    await claims(outsider, 'aal2'); await db.exec('set role authenticated');
    assert.equal(await call('booking_admin_eligible'), false);
    assert.equal(await call('booking_admin_access'), false);
    assert.equal((await db.query('select * from public."preReservations"')).rows.length, 0);
    await assert.rejects(call('booking_confirm_payment', [reservation.id]), error => error.code === 'PT403');
    await db.exec('reset role');
  });
  await t.test('only an AAL2 allowlisted admin can read records and confirm payment', async () => {
    await claims(admin, 'aal2'); await db.exec('set role authenticated');
    assert.equal(await call('booking_admin_access'), true);
    assert.equal((await db.query('select * from public.contacts')).rows.length, 1);
    assert.equal((await db.query('select * from public."preReservations"')).rows.length, 1);
    const result = await call('booking_confirm_payment', [reservation.id]);
    assert.equal(result.status, 'confirmed'); assert.ok(result.paymentConfirmedAt);
    await db.exec('reset role');
  });
  await t.test('revoking the allowlist blocks an existing AAL2 token and reapplying preserves records', async () => {
    await db.query('delete from booking_private.admins where user_id=$1', [admin]);
    await db.exec(readFileSync('supabase/migrations/202610220002_admin_mfa.sql', 'utf8'));
    await db.exec('set role authenticated');
    assert.equal(await call('booking_admin_access'), false);
    assert.equal((await db.query('select * from public."preReservations"')).rows.length, 0);
    await db.exec('reset role');
    assert.equal((await db.query('select count(*)::integer n from public."preReservations"')).rows[0].n, 1);
  });
});
