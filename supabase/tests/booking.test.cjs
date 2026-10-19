const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');

// Real PostgreSQL engine in WASM: validates SQL, privileges and constraints without Docker.
test('Supabase migration and reservation security', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql as
      'select nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid';
    grant usage on schema public, auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
  `);
  const migration = readFileSync('supabase/migrations/202610190001_booking.sql', 'utf8');
  await db.exec(migration);
  const call = async (name, args) => {
    const placeholders = args.map((_, i) => `$${i + 1}`).join(',');
    return (await db.query(`select public.${name}(${placeholders}) as result`, args)).rows[0]
      .result;
  };
  const sample = {
    name: 'Cliente Teste',
    phone: '(11) 99999-9999',
    email: 'client@example.com',
    startDate: '2038-02-27',
    endDate: '2038-03-01',
  };
  let reservation;

  await t.test('migration can be reapplied and preserves existing records', async () => {
    await db.exec(
      `insert into public.contacts (name,phone,email,message) values ('Teste','11999999999','test@example.com','Histórico')`,
    );
    await db.exec(migration);
    assert.equal((await db.query('select count(*)::int n from public.contacts')).rows[0].n, 1);
  });
  await t.test('anonymous users cannot read tables or insert forged rows directly', async () => {
    await db.exec('set role anon');
    for (const query of [
      'select * from public.contacts',
      'select * from public."preReservations"',
      "insert into public.contacts(name,phone,email,message) values ('XX','11999999999','x@example.com','x')",
      'select * from booking_private.admins',
    ]) {
      await assert.rejects(db.exec(query), (error) => error.code === '42501');
    }
    await db.exec('reset role');
  });
  await t.test(
    'public creation generates tokens, timestamps and private customer data',
    async () => {
      await db.exec('set role anon');
      reservation = await call('booking_create_reservation', [sample]);
      assert.match(reservation.notificationToken, /^[a-f0-9]{64}$/);
      assert.equal(reservation.cancellationTokenHash, undefined);
      assert.equal(reservation.status, 'pending_payment');
      assert.equal(new Date(reservation.startAt).toISOString(), '2038-02-27T11:00:00.000Z');
      assert.equal(reservation.notifications.customer.status, 'awaiting_formsubmit');
      await db.exec('reset role');
    },
  );
  await t.test('database rejects overlap and permits a new check-in at checkout', async () => {
    await db.exec('set role anon');
    const attempts = await Promise.allSettled([
      call('booking_create_reservation', [
        { ...sample, startDate: '2038-03-05', endDate: '2038-03-06' },
      ]),
      call('booking_create_reservation', [
        { ...sample, startDate: '2038-03-05', endDate: '2038-03-06' },
      ]),
    ]);
    assert.equal(attempts.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(attempts.find((result) => result.status === 'rejected').reason.code, 'PT409');
    await assert.rejects(
      call('booking_create_reservation', [sample]),
      (error) => error.code === 'PT409',
    );
    await call('booking_create_reservation', [
      { ...sample, startDate: '2038-03-01', endDate: '2038-03-02' },
    ]);
    await db.exec('reset role');
  });
  await t.test(
    'public calendar contains dates and statuses only; checkout stays free',
    async () => {
      await db.exec('set role anon');
      const calendar = await call('booking_availability', ['2038-02']);
      assert.equal(calendar.days.find((day) => day.date === '2038-02-27').status, 'reserved');
      assert.equal(calendar.days.find((day) => day.date === '2038-02-26').status, 'free');
      const march = await call('booking_availability', ['2038-03']);
      assert.equal(march.days.find((day) => day.date === '2038-03-02').status, 'free');
      const json = JSON.stringify(calendar);
      for (const secret of [
        sample.name,
        sample.phone,
        sample.email,
        reservation.id,
        reservation.notificationToken,
      ])
        assert.equal(json.includes(secret), false);
      await db.exec('reset role');
    },
  );
  await t.test(
    'invalid dates, past dates, forged fields and zero-night stays are rejected',
    async () => {
      await db.exec('set role anon');
      for (const input of [
        { ...sample, startDate: '2038-02-30' },
        { ...sample, startDate: '2000-01-01' },
        { ...sample, status: 'confirmed' },
        { ...sample, endDate: sample.startDate },
        { ...sample, startTime: '09:00' },
        { ...sample, phone: '123' },
        { ...sample, startDate: null },
      ]) {
        await assert.rejects(
          call('booking_create_reservation', [input]),
          (error) => error.code === 'PT400',
        );
      }
      await assert.rejects(
        call('booking_availability', ['0000-01']),
        (error) => error.code === 'PT400',
      );
      await db.exec('reset role');
    },
  );
  await t.test('resuming forms and cancellation require the individual token', async () => {
    await db.exec('set role anon');
    for (const name of ['booking_owned_reservation', 'booking_cancel_reservation']) {
      await assert.rejects(
        call(name, [reservation.id, 'a'.repeat(64)]),
        (error) => error.code === 'PT404',
      );
    }
    const owned = await call('booking_owned_reservation', [
      reservation.id,
      reservation.notificationToken,
      true,
    ]);
    assert.equal(owned.name, sample.name);
    assert.equal(owned.cancellationTokenHash, undefined);
    assert.equal(
      (await call('booking_owned_reservation', [reservation.id, reservation.notificationToken])).id,
      reservation.id,
    );
    await db.exec('reset role');
  });
  await t.test(
    'only an allowlisted authenticated admin can confirm payment or read contacts',
    async () => {
      const admin = '00000000-0000-4000-8000-000000000001';
      await db.exec(
        `insert into auth.users values ('${admin}'); insert into booking_private.admins values ('${admin}'); set role authenticated;`,
      );
      await assert.rejects(
        call('booking_confirm_payment', [reservation.id]),
        (error) => error.code === 'PT403',
      );
      assert.equal((await db.query('select * from public.contacts')).rows.length, 0);
      await db.query("select set_config('request.jwt.claim.sub', $1, false)", [admin]);
      assert.equal((await db.query('select * from public.contacts')).rows.length, 1);
      assert.equal((await call('booking_confirm_payment', [reservation.id])).status, 'confirmed');
      await assert.rejects(
        call('booking_owned_reservation', [reservation.id, reservation.notificationToken]),
        (error) => error.code === 'PT409',
      );
      assert.equal(
        (
          await call('booking_owned_reservation', [
            reservation.id,
            reservation.notificationToken,
            true,
          ])
        ).status,
        'confirmed',
      );
      await db.exec('reset role');
      await db.query("select set_config('request.jwt.claim.sub', '', false)");
    },
  );
  await t.test(
    'owner cancellation physically deletes only their record and frees the calendar',
    async () => {
      await db.exec('set role anon');
      assert.equal(
        (await call('booking_cancel_reservation', [reservation.id, reservation.notificationToken]))
          .cancelled,
        true,
      );
      assert.equal(
        (await call('booking_availability', ['2038-02'])).days.find(
          (day) => day.date === '2038-02-27',
        ).status,
        'free',
      );
      await assert.rejects(
        call('booking_cancel_reservation', [reservation.id, reservation.notificationToken]),
        (error) => error.code === 'PT404',
      );
      await db.exec('reset role');
      assert.equal(
        (await db.query('select count(*)::int n from public."preReservations"')).rows[0].n,
        2,
      );
    },
  );
  await t.test(
    'contacts validate data, limit submissions and do not claim email delivery',
    async () => {
      await db.exec('set role anon');
      const contact = {
        name: 'Contato Teste',
        phone: '11999999999',
        email: 'limit@example.com',
        message: 'Consulta',
      };
      await assert.rejects(
        call('booking_create_contact', [{ ...contact, emailStatus: 'sent' }]),
        (error) => error.code === 'PT400',
      );
      for (let i = 0; i < 5; i++) assert.ok((await call('booking_create_contact', [contact])).id);
      await assert.rejects(
        call('booking_create_contact', [contact]),
        (error) => error.code === 'PT429',
      );
      await db.exec('reset role');
      assert.equal(
        (
          await db.query(
            `select "emailStatus" from public.contacts where email = 'limit@example.com' limit 1`,
          )
        ).rows[0].emailStatus,
        'not_tracked',
      );
    },
  );
  await t.test('administrative contacts CRUD allows only allowlisted users', async () => {
    await db.exec('set role anon');
    const input = {
      name: 'CRUD Teste',
      phone: '11999999999',
      email: 'crud@example.com',
      message: 'Original',
    };
    const created = await call('booking_create_contact', [input]);
    await assert.rejects(
      db.query('update public.contacts set message = $1 where id = $2', ['Forged', created.id]),
      (error) => error.code === '42501',
    );
    await db.exec('reset role; set role authenticated');
    assert.equal(
      (
        await db.query('update public.contacts set message = $1 where id = $2 returning id', [
          'Forged',
          created.id,
        ])
      ).rows.length,
      0,
    );
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [
      '00000000-0000-4000-8000-000000000001',
    ]);
    assert.equal(
      (await db.query('select message from public.contacts where id = $1', [created.id])).rows[0]
        .message,
      'Original',
    );
    assert.equal(
      (
        await db.query('update public.contacts set message = $1 where id = $2 returning message', [
          'Updated',
          created.id,
        ])
      ).rows[0].message,
      'Updated',
    );
    assert.equal(
      (await db.query('delete from public.contacts where id = $1 returning id', [created.id])).rows
        .length,
      1,
    );
    assert.equal(
      (await db.query('select id from public.contacts where id = $1', [created.id])).rows.length,
      0,
    );
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
  });
});
