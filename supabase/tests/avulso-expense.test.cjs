const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');

test('Aluguel Avulso is an expense category and can never generate income', async t => {
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
  const input={key:randomUUID(),kind:'expense',category:'aluguel_avulso',amount:'250',occurredOn:today,description:'Aluguel avulso de utensílios'};
  const expense=await call('booking_finance_post',[input]);
  const data=await call('booking_finance_dashboard',[today.slice(0,7)]);
  assert.equal(data.summary.income,0);assert.equal(data.summary.expenses,250);assert.equal(data.summary.closingBalance,-250);
  assert.equal(data.transactions[0].kind,'expense');assert.equal(data.transactions[0].category,'aluguel_avulso');assert.equal(data.transactions[0].signedAmount,-250);
  const report=await call('booking_finance_expenses',[today.slice(0,7)]);assert.equal(report.total,250);assert.equal(report.entries[0].id,expense.id);
  for(const kind of ['receipt','refund','opening_in','opening_out']) {
    await assert.rejects(call('booking_finance_post',[{...input,key:randomUUID(),kind,reservationId:booking.id,reference:randomUUID()}]),e=>e.code==='PT400');
  }
  await db.exec('reset role');
  await assert.rejects(db.query("update public.financial_transactions set kind='opening_in' where id=$1",[expense.id]),e=>e.code==='23514');
  await db.exec(readFileSync('supabase/migrations/202610250002_avulso_expense_category.sql','utf8'));
});
