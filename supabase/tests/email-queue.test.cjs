const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');

test('durable Gmail outbox', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql as 'select null::uuid';
    grant usage on schema public to anon, authenticated, service_role;`);
  for (const name of ['202610190001_booking.sql','202610200001_gmail.sql','202610200002_email_queue.sql'])
    await db.exec(readFileSync('supabase/migrations/' + name, 'utf8'));
  await db.exec(readFileSync('supabase/migrations/202610200002_email_queue.sql', 'utf8'));
  const call = async (name, args = []) => (await db.query(
    `select public.${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) as result`, args,
  )).rows[0].result;
  const asRole = (role = '') => db.exec('reset role;' + (role ? `set role ${role};` : ''));
  const person = { name: 'Teste Fila', phone: '11999999999', email: 'queue@example.com' };
  let reservation;
  let contact;

  await t.test('commits two reservation jobs with the record, without any browser email call', async () => {
    await asRole('anon');
    reservation = await call('booking_create_reservation', [{ ...person, startDate: '2038-05-01', endDate: '2038-05-02' }]);
    await asRole();
    const jobs = (await db.query('select role, status, attempts from booking_private.email_deliveries where record_id=$1 order by role', [reservation.id])).rows;
    assert.deepEqual(jobs, [{ role: 'customer', status: 'pending', attempts: 0 }, { role: 'manager', status: 'pending', attempts: 0 }]);
    await db.exec('begin');
    const transient = await call('booking_create_contact', [{ ...person, message: 'Rollback' }]);
    await db.exec('rollback');
    assert.equal((await db.query('select count(*)::integer n from booking_private.email_deliveries where record_id=$1', [transient.id])).rows[0].n, 0);
    await assert.rejects(call('booking_create_reservation', [{ ...person, startDate: '2038-05-01', endDate: '2038-05-03' }]), e => e.code === 'PT409');
    assert.equal((await db.query('select count(*)::integer n from booking_private.email_deliveries')).rows[0].n, 2);
  });
  await t.test('a worker restart only reclaims expired leases and preserves already-sent roles', async () => {
    await asRole('service_role');
    const first = await call('booking_next_email');
    const second = await call('booking_next_email');
    assert.notEqual(first.claimId, second.claimId);
    assert.equal(await call('booking_next_email'), null);
    await call('booking_finish_email', [first.claimId, true]);
    await asRole();
    await db.query("update booking_private.email_deliveries set lease_until=now()-interval '1 minute' where claim_id=$1", [second.claimId]);
    await asRole('service_role');
    const recovered = await call('booking_next_email');
    assert.equal(recovered.role, second.role);
    assert.notEqual(recovered.claimId, second.claimId);
    await assert.rejects(call('booking_finish_email', [second.claimId, true]), e => e.code === 'PT409');
    await call('booking_finish_email', [recovered.claimId, true]);
    const status = await call('booking_request_email', ['reservation', reservation.id, reservation.notificationToken, '', null]);
    assert.deepEqual(status, { sent: true, queued: false });
    assert.equal(await call('booking_next_email'), null);
  });
  await t.test('contacts survive loss of browser state and retry beyond five SMTP failures with backoff', async () => {
    await asRole('anon');
    contact = await call('booking_create_contact', [{ ...person, message: 'Consulta' }]);
    await asRole('service_role');
    for (let i = 0; i < 6; i++) {
      const job = await call('booking_next_email');
      assert.equal(job.kind, 'contact');
      await call('booking_finish_email', [job.claimId, false]);
      assert.equal(await call('booking_next_email'), null);
      await asRole();
      const state = (await db.query('select attempts, next_attempt_at > now() delayed from booking_private.email_deliveries where record_id=$1', [contact.id])).rows[0];
      assert.equal(state.attempts, i + 1);
      assert.equal(state.delayed, true);
      await db.query("update booking_private.email_deliveries set next_attempt_at=now()-interval '1 second' where record_id=$1", [contact.id]);
      await asRole('service_role');
    }
    const recovered = await call('booking_next_email');
    await call('booking_finish_email', [recovered.claimId, true]);
    assert.equal((await call('booking_request_email', ['contact', contact.id, contact.deliveryToken, '', null])).sent, true);
  });
  await t.test('PDFs are durable, validated, idempotent and removed after SMTP acceptance', async () => {
    const pdf = Buffer.from('%PDF-1.7\nContrato');
    const fingerprint = createHash('sha256').update(pdf).digest('hex');
    const args = ['contract', reservation.id, reservation.notificationToken, fingerprint, pdf.toString('base64')];
    const queued = await call('booking_request_email', args);
    assert.deepEqual(queued, { queued: true, sent: false });
    await call('booking_request_email', args);
    const job = await call('booking_next_email');
    assert.equal(Buffer.from(job.attachment, 'base64').toString(), pdf.toString());
    await call('booking_finish_email', [job.claimId, false]);
    await asRole();
    const stored = (await db.query("select count(*)::integer n, bool_and(attachment is not null) retained from booking_private.email_deliveries where kind='contract'")).rows[0];
    assert.deepEqual(stored, { n: 1, retained: true });
    await db.exec("update booking_private.email_deliveries set next_attempt_at=now() where kind='contract'");
    await asRole('service_role');
    await call('booking_finish_email', [(await call('booking_next_email')).claimId, true]);
    assert.equal((await call('booking_request_email', args)).sent, true);
    await asRole();
    assert.equal((await db.query("select attachment from booking_private.email_deliveries where kind='contract'")).rows[0].attachment, null);
    await asRole('service_role');
    await assert.rejects(call('booking_request_email', ['contract', reservation.id, reservation.notificationToken, '0'.repeat(64), pdf.toString('base64')]), e => e.code === 'PT400');
  });
  await t.test('public roles cannot read or consume the queue, and capabilities are checked', async () => {
    await asRole('anon');
    await assert.rejects(call('booking_next_email'), e => e.code === '42501');
    await assert.rejects(call('booking_request_email', ['contact', contact.id, contact.deliveryToken, '', null]), e => e.code === '42501');
    await assert.rejects(db.query('select * from booking_private.email_deliveries'), e => e.code === '42501');
    await asRole('service_role');
    await assert.rejects(call('booking_request_email', ['contact', contact.id, 'b'.repeat(64), '', null]), e => e.code === 'PT404');
    await assert.rejects(call('booking_claim_email', ['contact', contact.id, contact.deliveryToken, 'manager', '']), e => e.code === '42501');
  });
  await t.test('deleting the source cancels pending jobs', async () => {
    await asRole('anon');
    const doomed = await call('booking_create_reservation', [{ ...person, startDate: '2038-06-01', endDate: '2038-06-02' }]);
    await call('booking_cancel_reservation', [doomed.id, doomed.notificationToken]);
    await asRole();
    const states = (await db.query('select status from booking_private.email_deliveries where record_id=$1', [doomed.id])).rows;
    assert.deepEqual(states, [{ status: 'cancelled' }, { status: 'cancelled' }]);
    await asRole('service_role');
    assert.equal(await call('booking_next_email'), null);
  });
  await t.test('scheduler SQL wakes after insertion and its failures preserve the reservation', async () => {
    await asRole();
    // Hosted-only extensions are replaced with local SQL stubs; no network calls are made.
    await db.exec(`create schema vault; create table vault.decrypted_secrets(name text, decrypted_secret text);
      insert into vault.decrypted_secrets values ('booking_email_worker_token', repeat('w',64));
      create schema net; create table net.calls(url text, headers jsonb);
      create function net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds integer)
        returns bigint language plpgsql as $$ begin insert into net.calls values (url,headers); return 1; end $$;
      create schema cron; create table cron.jobs(name text primary key, schedule text, command text);
      create function cron.schedule(text,text,text) returns bigint language sql as $$
        insert into cron.jobs values ($1,$2,$3) on conflict(name) do update set schedule=$2,command=$3 returning 1::bigint;
      $$;`);
    const setup = readFileSync('supabase/setup-email-worker.sql', 'utf8').replace(/^create extension .*;$/gm, '');
    await db.exec(setup);
    await db.exec(setup);
    assert.equal((await db.query('select count(*)::integer n from cron.jobs')).rows[0].n, 1);
    const queued = await call('booking_create_reservation', [{ ...person, startDate: '2038-07-01', endDate: '2038-07-02' }]);
    assert.equal((await db.query('select count(*)::integer n from net.calls')).rows[0].n, 2);
    await db.exec(`create or replace function net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds integer)
      returns bigint language plpgsql as $$ begin raise exception 'Network unavailable'; end $$;`);
    const persisted = await call('booking_create_reservation', [{ ...person, startDate: '2038-08-01', endDate: '2038-08-02' }]);
    assert.notEqual(persisted.id, queued.id);
    const states = (await db.query('select status from booking_private.email_deliveries where record_id=$1', [persisted.id])).rows;
    assert.deepEqual(states, [{ status: 'pending' }, { status: 'pending' }]);
  });
});
