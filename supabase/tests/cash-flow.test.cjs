const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync,readdirSync } = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const { randomUUID } = require('node:crypto');

test('cash flow preserves money, authorization and reservation history', async t => {
  const db=new PGlite();t.after(()=>db.close());
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);
    create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
    create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;
    grant usage on schema public,auth to anon,authenticated,service_role;`);
  const migration=readFileSync('supabase/migrations/202610220003_cash_flow.sql','utf8');
  for(const file of readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')&&f<'202610220003_cash_flow.sql').sort())await db.exec(readFileSync('supabase/migrations/'+file,'utf8'));
  const call=async(name,args=[]) => (await db.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args)).rows[0].result;
  const person={name:'Finance Test',phone:'11999999999',email:'finance@example.com',startDate:'2038-11-01',endDate:'2038-11-03'};
  const legacy=await call('booking_create_reservation',[person]);
  await db.query('update public."preReservations" set status=$1,"paymentConfirmedAt"=now() where id=$2',['confirmed',legacy.id]);
  await db.exec(migration);
  for(const file of readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')&&f>'202610220003_cash_flow.sql').sort())await db.exec(readFileSync('supabase/migrations/'+file,'utf8'));
  const admin=randomUUID(),outsider=randomUUID();
  await db.query('insert into auth.users(id) values($1),($2)',[admin,outsider]);await db.query('insert into booking_private.admins(user_id) values($1)',[admin]);
  const claims=async(sub=admin,aal='aal2')=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub,aal})]);await db.exec('set role authenticated');};
  const today=(await db.query("select to_char((now() at time zone 'America/Sao_Paulo')::date,'YYYY-MM-DD') d")).rows[0].d;
  const month=today.slice(0,7);
  const post=(input)=>call('booking_finance_post',[{key:randomUUID(),kind:'expense',amount:'10.00',occurredOn:today,description:'Test',...input}]);
  let reservation;
  await t.test('legacy confirmations do not invent contracted prices or receipts',async()=>{
    await claims();const data=await call('booking_finance_dashboard',['2038-11']);
    assert.equal(data.summary.unpricedCount,1);assert.equal(data.summary.unreconciledCount,1);
    assert.equal(data.reservations[0].totalAmount,null);assert.equal(data.transactionCount,0);
  });
  await t.test('new reservations capture their days and the current R$400 daily rate',async()=>{
    await db.exec('reset role');reservation=await call('booking_create_reservation',[{...person,email:'new@example.com',startDate:'2038-11-03',endDate:'2038-11-05'}]);
    assert.equal(reservation.stayDays,2);assert.equal(reservation.dailyRate,400);assert.equal(reservation.totalAmount,800);
    await db.exec('update booking_private.finance_control set daily_rate=450');
    const row=(await db.query('select "totalAmount"::text amount from public."preReservations" where id=$1',[reservation.id])).rows[0];assert.equal(row.amount,'800.00');
    await claims();
  });
  await t.test('anonymous, AAL1 and non-admin users cannot access financial data or RPCs',async()=>{
    await db.exec('reset role;set role anon');await assert.rejects(call('booking_finance_dashboard',[month]),e=>e.code==='42501');
    for(const [id,aal] of [[admin,'aal1'],[outsider,'aal2']]){
      await claims(id,aal);assert.equal((await db.query('select * from public.finance_cash_flow')).rows.length,0);
      await assert.rejects(call('booking_finance_dashboard',[month]),e=>e.code==='PT403');
      await assert.rejects(post({}),e=>e.code==='PT403');
      await assert.rejects(call('booking_finance_price',[legacy.id,'250']),e=>e.code==='PT403');
    }await claims();
  });
  await t.test('legacy pricing is explicit, immutable and retry-safe',async()=>{
    await assert.rejects(post({kind:'receipt',reservationId:legacy.id,amount:'100',reference:'legacy-ref'}),e=>e.code==='PT409');
    assert.equal((await call('booking_finance_price',[legacy.id,'250.00'])).totalAmount,500);
    assert.equal((await call('booking_finance_price',[legacy.id,'250'])).totalAmount,500);
    await assert.rejects(call('booking_finance_price',[legacy.id,'300']),e=>e.code==='PT409');
    await assert.rejects(call('booking_finance_price',[randomUUID(),'250']),e=>e.code==='PT404');
    for(const rate of [null,'0','-1','NaN','1.234','abc'])await assert.rejects(call('booking_finance_price',[legacy.id,rate]),e=>e.code==='PT400');
  });
  await t.test('partial receipts, idempotency and bank-reference uniqueness protect against duplicate cash',async()=>{
    const input={key:randomUUID(),kind:'receipt',reservationId:reservation.id,amount:'250.10',occurredOn:today,description:'Primeira parcela',reference:'PIX-001'};
    const first=await call('booking_finance_post',[input]);assert.deepEqual(await call('booking_finance_post',[input]),first);
    await assert.rejects(call('booking_finance_post',[{...input,amount:'251'}]),e=>e.code==='PT409');
    await assert.rejects(call('booking_finance_post',[{...input,key:randomUUID(),reference:'pix-001'}]),e=>e.code==='PT409');
    let data=await call('booking_finance_dashboard',['2038-11']);let row=data.reservations.find(r=>r.reservationId===reservation.id);
    assert.equal(row.amountDue,549.90);assert.equal(row.status,'pending_payment');
    await assert.rejects(post({kind:'receipt',reservationId:reservation.id,amount:'550',reference:'too-much'}),e=>e.code==='PT409');
    await post({kind:'receipt',reservationId:reservation.id,amount:'549.90',reference:'PIX-002'});
    data=await call('booking_finance_dashboard',['2038-11']);row=data.reservations.find(r=>r.reservationId===reservation.id);
    assert.equal(row.amountDue,0);assert.equal(row.status,'confirmed');assert.equal(row.received,800);
  });
  await t.test('expenses, adjustments, refunds and balances are exact and append-only',async()=>{
    await post({kind:'opening_in',amount:'100.00',description:'Saldo anterior'});
    await post({kind:'opening_out',amount:'20.00',description:'Ajuste de saldo'});
    await post({kind:'expense',reservationId:reservation.id,amount:'50.25',description:'Limpeza'});
    await post({kind:'refund',reservationId:reservation.id,amount:'100.10',description:'Devolução parcial'});
    const data=await call('booking_finance_dashboard',[month]);
    assert.equal(data.summary.income,900);assert.equal(data.summary.expenses,170.35);assert.equal(data.summary.closingBalance,729.65);
    await assert.rejects(post({kind:'refund',reservationId:reservation.id,amount:'700.00'}),e=>e.code==='PT409');
    const next=(await db.query("select to_char(($1::date+interval '1 month'),'YYYY-MM') m",[month+'-01'])).rows[0].m;
    const following=await call('booking_finance_dashboard',[next]);assert.equal(following.summary.openingBalance,729.65);assert.equal(following.summary.closingBalance,729.65);
    await assert.rejects(db.query('delete from public.financial_transactions'),e=>e.code==='42501');
    await assert.rejects(db.query('update public.financial_transactions set amount=1'),e=>e.code==='42501');
    await assert.rejects(db.query("insert into public.financial_transactions(kind) values('expense')"),e=>e.code==='42501');
    assert.equal((await call('booking_finance_dashboard',['2038-11'])).reservations.find(r=>r.reservationId===reservation.id).status,'pending_payment');
  });
  await t.test('cancellation removes the forecast but preserves receipts and permits only funded refunds',async()=>{
    await db.exec('reset role;set role anon');await call('booking_cancel_reservation',[reservation.id,reservation.notificationToken]);await claims();
    await post({kind:'refund',reservationId:reservation.id,amount:'699.90',description:'Devolução do restante'});
    const data=await call('booking_finance_dashboard',['2038-11']);const row=data.reservations.find(r=>r.reservationId===reservation.id);
    assert.equal(row.status,'cancelled');assert.equal(row.amountDue,0);assert.equal(row.refundableAmount,0);assert.equal(row.received,800);assert.equal(row.refunded,800);
    await assert.rejects(post({kind:'refund',reservationId:reservation.id,amount:'0.01'}),e=>e.code==='PT409');
  });
  await t.test('administrative payment confirmation writes a single receipt in the same transaction',async()=>{
    const result=await call('booking_confirm_payment',[legacy.id]);assert.equal(result.status,'confirmed');
    await call('booking_confirm_payment',[legacy.id]);
    const data=await call('booking_finance_dashboard',['2038-11']);assert.equal(data.reservations.find(r=>r.reservationId===legacy.id).received,500);
  });
  await t.test('invalid amounts, dates, protocols, fields and pagination are rejected without writes',async()=>{
    for(const input of [{amount:'0'},{amount:'-1'},{amount:'1.001'},{amount:1},{amount:'NaN'},{occurredOn:'2099-01-01'},{occurredOn:'2026-02-30'},{kind:'forged'},{description:''},{key:'bad'},{reservationId:'bad'},{unexpected:true},{kind:'receipt'},{kind:'receipt',reservationId:legacy.id,reference:''}])
      await assert.rejects(post(input),e=>e.code==='PT400');
    await assert.rejects(post({reservationId:randomUUID()}),e=>e.code==='PT404');
    await assert.rejects(call('booking_finance_dashboard',['bad']),e=>e.code==='PT400');
    await assert.rejects(call('booking_finance_dashboard',[month,-1]),e=>e.code==='PT400');
    await assert.rejects(call('booking_finance_dashboard',[month,0,-1]),e=>e.code==='PT400');
  });
  await t.test('pagination does not truncate totals and reapplying the migration preserves history',async()=>{
    for(let i=0;i<51;i++)await post({amount:'0.01',description:'Pagination '+i});
    const a=await call('booking_finance_dashboard',[month]);const b=await call('booking_finance_dashboard',[month,1]);
    assert.equal(a.transactions.length,50);assert.ok(b.transactions.length>0);assert.deepEqual(a.summary,b.summary);
    assert.equal(new Set([...a.transactions,...b.transactions].map(r=>r.id)).size,a.transactionCount);
    await db.exec('reset role');await db.exec(migration);await claims();
    const after=await call('booking_finance_dashboard',[month]);assert.equal(after.transactionCount,a.transactionCount);assert.deepEqual(after.summary,a.summary);
  });
});
