const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');

test('technical retention preserves business records and email deduplication', async t => {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
    create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;
    grant usage on schema public,auth to anon,authenticated,service_role;
    create schema cron;
    create table cron.job_run_details(runid bigint generated always as identity, status text, end_time timestamptz);
    begin;`);
  const migration = 'supabase/migrations/202610230006_technical_retention.sql';
  for (const file of readdirSync('supabase/migrations').filter(f => f.endsWith('.sql')).sort()) {
    await db.exec(readFileSync('supabase/migrations/' + file, 'utf8'));
  }
  // Keep boundary timestamps identical across fixture creation and execution.
  await db.exec('begin');
  const purge = async (dryRun = true, size = 5000) =>
    (await db.query('select booking_private.purge_technical_data($1,$2) result', [dryRun, size])).rows[0].result;
  const count = async table => Number((await db.query(`select count(*) n from ${table}`)).rows[0].n);
  const contact = (await db.query(`select public.booking_create_contact($1) result`, [{
    name:'Retention Test',phone:'11999999999',email:'retention@example.com',message:'Preservar',
  }])).rows[0].result;
  const reservation = (await db.query(`select public.booking_create_reservation($1) result`, [{
    name:'Retention Test',phone:'11999999999',email:'booking@example.com',startDate:'2038-12-10',endDate:'2038-12-12',
  }])).rows[0].result;
  const admin = randomUUID();
  await db.query('insert into auth.users(id) values($1)', [admin]);
  await db.query('insert into booking_private.admins(user_id) values($1)', [admin]);
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({sub:admin,aal:'aal2'})]);
  await db.query('select public.booking_finance_post($1)', [{
    key:randomUUID(),kind:'expense',amount:'80',occurredOn:'2020-01-01',category:'limpeza',description:'Preservar financeiro',
  }]);
  await db.exec(`insert into cron.job_run_details(status,end_time) values
    ('succeeded',now()-interval '8 days'),('succeeded',now()-interval '7 days'),
    ('failed',now()-interval '31 days'),('failed',now()-interval '8 days'),
    ('running',now()-interval '90 days'),('running',null),('unknown',now()-interval '90 days');
    insert into booking_private.rate_limits values
      ('expired',1,now()-interval '2 days'),('recent',1,now()-interval '1 hour'),
      ('boundary',1,now()-interval '1 day'),('active',1,now()+interval '1 hour');`);
  for (const [key,status,age] of [
    ['sent-old','sent',8],['cancelled-old','cancelled',8],['sent-recent','sent',1],
    ['sent-boundary','sent',7],['pending-old','pending',90],['sending-old','sending',90],['failed-old','failed',90],
  ]) {
    await db.query(`insert into booking_private.email_deliveries
      (delivery_key,record_id,kind,role,status,claim_id,lease_until,attempts,updated_at,attachment)
      values($1,$2,'contract','manager',$3,$4,now()+interval '1 hour',1,now()-make_interval(days=>$5),decode('25504446','hex'))`,
    [key,reservation.id,status,randomUUID(),age]);
  }
  await db.query("update booking_private.email_deliveries set status='sent',updated_at=now()-interval '90 days' where record_id=$1",[contact.id]);
  const rateLimits = await count('booking_private.rate_limits');
  const businessCounts = [await count('public.contacts'),await count('public."preReservations"'),await count('public.financial_transactions')];
  const emails = await count('booking_private.email_deliveries');

  await t.test('dry run reports eligible records without changing any data', async () => {
    assert.deepEqual(await purge(), {dryRun:true,skipped:false,batchSize:5000,cronRuns:2,expiredRateLimits:1,terminalEmailAttachments:2});
    assert.equal(await count('cron.job_run_details'),7);
    assert.equal((await db.query('select count(*) n from booking_private.email_deliveries where attachment is not null')).rows[0].n,7);
  });
  await t.test('execution is bounded, preserves active work and is repeatable', async () => {
    const first = await purge(false,1);
    assert.equal(first.cronRuns,1); assert.equal(first.terminalEmailAttachments,1);
    const second = await purge(false);
    assert.equal(second.cronRuns,1); assert.equal(second.terminalEmailAttachments,1);
    assert.equal(second.expiredRateLimits,0);
    assert.equal((await purge(false)).cronRuns,0);
    assert.equal(await count('cron.job_run_details'),5);
    assert.equal(await count('booking_private.rate_limits'),rateLimits-1);
    assert.equal(await count('booking_private.email_deliveries'),emails);
    assert.deepEqual([await count('public.contacts'),await count('public."preReservations"'),await count('public.financial_transactions')],businessCounts);
    const retained = (await db.query('select delivery_key from booking_private.email_deliveries where attachment is not null order by delivery_key')).rows.map(row=>row.delivery_key);
    assert.deepEqual(retained,['failed-old','pending-old','sending-old','sent-boundary','sent-recent']);
    const result = (await db.query('select public.booking_request_email($1,$2,$3) result',['contact',contact.id,contact.deliveryToken])).rows[0].result;
    assert.equal(result.sent,true); assert.equal(await count('booking_private.email_deliveries'),emails);
  });
  await t.test('rejects invalid limits and cannot be invoked by application roles', async () => {
    for (const [dryRun,size] of [[false,null],[false,0],[false,-1],[false,10001],[null,5000]]) {
      await db.exec('savepoint invalid_input');
      await assert.rejects(purge(dryRun,size),error=>error.code==='P0001');
      await db.exec('rollback to savepoint invalid_input; release savepoint invalid_input');
    }
    for (const role of ['anon','authenticated','service_role']) {
      // Savepoints let us recover from deliberate permission failures inside the transaction.
      await db.exec(`savepoint permission_check; set local role ${role}`);
      await assert.rejects(purge(false),error=>error.code==='42501');
      await db.exec('rollback to savepoint permission_check; release savepoint permission_check');
    }
  });
  await db.exec('rollback');
  await t.test('migration can be reapplied without pg_cron installed', async () => {
    await db.exec(readFileSync(migration,'utf8'));
    assert.equal((await purge()).dryRun,true);
  });
});
