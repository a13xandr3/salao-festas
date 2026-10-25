const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');

test('expense exclusion preserves audit and updates all totals without deleting receipts', async t => {
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
  const month=today.slice(0,7);
  const input={key:randomUUID(),kind:'expense',amount:'80',occurredOn:today,description:'Lançamento por engano',category:'limpeza'};
  const expense=await call('booking_finance_post',[input]);
  const receipt=await post(booking.id,'receipt','100');
  const refund=await post(booking.id,'refund','10');
  for(const entry of [receipt,refund])await assert.rejects(call('booking_finance_delete_expense',[entry.id]),e=>e.code==='PT409');
  await assert.rejects(call('booking_finance_delete_expense',[randomUUID()]),e=>e.code==='PT404');
  for(const [id,aal] of [[admin,'aal1'],[outsider,'aal2']]){await claims(id,aal);await assert.rejects(call('booking_finance_delete_expense',[expense.id]),e=>e.code==='PT403');}
  await db.exec('reset role;set role anon');await assert.rejects(call('booking_finance_delete_expense',[expense.id]),e=>e.code==='42501');
  await claims();
  assert.equal((await call('booking_finance_expenses',[month])).total,80);
  assert.equal((await call('booking_finance_dashboard',[month])).summary.closingBalance,10);
  assert.equal((await call('booking_finance_delete_expense',[expense.id])).deleted,true);
  let report=await call('booking_finance_expenses',[month]);assert.equal(report.total,0);assert.equal(report.count,0);assert.deepEqual(report.entries,[]);
  const dashboard=await call('booking_finance_dashboard',[month]);assert.equal(dashboard.summary.expenses,10);assert.equal(dashboard.summary.closingBalance,90);assert.equal(dashboard.transactionCount,2);assert.equal(dashboard.transactions.length,2);
  const audited=(await db.query('select * from public.financial_transactions where id=$1',[expense.id])).rows[0];
  assert.equal(Number(audited.amount),80);assert.equal(audited.description,'Lançamento por engano');assert.equal(audited.voided_by,admin);assert.ok(audited.voided_at);
  await call('booking_finance_delete_expense',[expense.id]);
  assert.deepEqual((await db.query('select * from public.financial_transactions where id=$1',[expense.id])).rows[0],audited);
  await call('booking_finance_post',[input]);report=await call('booking_finance_expenses',[month]);assert.equal(report.count,0);
  await assert.rejects(db.query('update public.financial_transactions set voided_at=null where id=$1',[expense.id]),e=>e.code==='42501');
  await db.exec('reset role');await db.exec(readFileSync('supabase/migrations/202610250001_delete_expense.sql','utf8'));
});
