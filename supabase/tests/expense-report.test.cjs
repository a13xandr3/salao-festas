const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');

test('monthly expense report filters dates and kinds without truncating totals', async t => {
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
  assert.deepEqual(await call('booking_finance_expenses',[month]),{month,total:0,count:0,entries:[]});
  for(let i=0;i<51;i++)await post(null,'expense','1.10');
  await post(booking.id,'receipt','100');await post(booking.id,'refund','20');await post(null,'opening_out','7');
  const previous=(await db.query("select to_char(date_trunc('month',$1::date)-interval '1 day','YYYY-MM-DD') d",[today])).rows[0].d;
  await call('booking_finance_post',[{key:randomUUID(),kind:'expense',amount:'88',occurredOn:previous,description:'Despesa do mês anterior',category:'limpeza'}]);
  const first=await call('booking_finance_expenses',[month]);const second=await call('booking_finance_expenses',[month,1]);
  assert.equal(first.count,51);assert.equal(first.total,56.1);assert.equal(first.entries.length,50);
  assert.equal(second.entries.length,1);assert.equal(second.total,56.1);assert.equal(second.count,51);
  assert.equal(new Set([...first.entries,...second.entries].map(row=>row.id)).size,51);
  assert.equal(first.entries[0].occurredOn,today);assert.equal(first.entries[0].description,'Test');assert.equal(first.entries[0].amount,1.1);
  assert.equal((await call('booking_finance_expenses',[previous.slice(0,7)])).total,88);
  for(const args of [['bad',0],[month,-1],[month,null],[month,100001]])await assert.rejects(call('booking_finance_expenses',args),e=>e.code==='PT400');
  for(const [id,aal] of [[admin,'aal1'],[outsider,'aal2']]){await claims(id,aal);await assert.rejects(call('booking_finance_expenses',[month]),e=>e.code==='PT403');}
  await db.exec('reset role;set role anon');await assert.rejects(call('booking_finance_expenses',[month]),e=>e.code==='42501');
});
