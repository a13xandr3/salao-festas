const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, writeFileSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { createContactApi } = require('./contact-api.cjs');
const hour = 3600000;
const sample = { name: 'Cliente Teste', phone: '(11) 99999-9999', email: 'cliente@example.com', startDate: '2028-02-28', startTime: '08:00', endDate: '2028-02-29', endTime: '08:00' };
async function setup(t, overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'salao-pre-'));
  const database = join(dir, 'db.json');
  writeFileSync(database, JSON.stringify({ contacts: [], reservations: [] }));
  let now = Date.parse('2028-02-01T12:00:00Z');
  const options = { database, env: { CONTACTS_ADMIN_TOKEN: 'private-test' }, rateLimitEnabled: false, clock: () => now, ...overrides };
  const app = createContactApi(options);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); rmSync(dir, { recursive: true }); });
  const url = `http://127.0.0.1:${server.address().port}`;
  return { database, app, options, advance: duration => { now += duration; }, request: (path, method = 'GET', body, admin = false) => fetch(`${url}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(admin ? { Authorization: 'Bearer private-test' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }) };
}
test('stores private customer data and blocks a continuous minimum 24-hour period', async t => {
  const { request, database } = await setup(t);
  const response = await request('/pre-reservations', 'POST', sample);
  assert.equal(response.status, 201);
  const receipt = await response.json();
  assert.equal(receipt.expiresAt, undefined);
  assert.equal(Date.parse(receipt.endAt) - Date.parse(receipt.startAt), 24 * hour);
  assert.equal(receipt.name, undefined);
  const stored = JSON.parse(readFileSync(database)).preReservations[0];
  assert.equal(stored.name, sample.name); assert.equal(stored.status, 'pending_payment');
  const availability = await (await request('/availability?month=2028-02')).json();
  assert.deepEqual(availability.reservations, [
    { date: '2028-02-28', start: '08:00', end: '24:00', status: 'pre_reserved' },
    { date: '2028-02-29', start: '00:00', end: '08:00', status: 'pre_reserved' },
  ]);
  for (const value of [sample.name, sample.email, sample.phone, receipt.id]) assert.equal(JSON.stringify(availability).includes(value), false);
  assert.equal((await request('/pre-reservations')).status, 401);
  assert.equal((await request('/pre-reservations', 'GET', null, true)).status, 200);
});
test('rejects short periods, missing data, past starts, invalid dates and forged payment status', async t => {
  const { request } = await setup(t);
  for (const body of [{ ...sample, endDate: sample.startDate, endTime: '23:00' }, { ...sample, startDate: '2028-01-01' , endDate: '2028-01-02' }, { ...sample, name: ' ' }, { ...sample, phone: '123' }, { ...sample, email: 'invalid' }, { ...sample, startDate: '2028-02-30' }, { ...sample, status: 'confirmed' }]) assert.equal((await request('/pre-reservations', 'POST', body)).status, 400);
});
test('supports long stays across months without a maximum duration', async t => {
  const { request } = await setup(t);
  assert.equal((await request('/pre-reservations', 'POST', { ...sample, endDate: '2030-03-02' })).status, 201);
  const march = await (await request('/availability?month=2028-03')).json();
  assert.equal(march.reservations.length, 31);
  assert.ok(march.reservations.every(item => item.start === '00:00' && item.end === '24:00'));
});
test('serializes conflicting requests and blocks administrative bookings too', async t => {
  const { request } = await setup(t);
  const responses = await Promise.all([request('/pre-reservations', 'POST', sample), request('/pre-reservations', 'POST', sample)]);
  assert.deepEqual(responses.map(response => response.status).sort(), [201, 409]);
  assert.equal((await request('/reservations', 'POST', { date: sample.startDate, start: '12:00', end: '14:00' }, true)).status, 409);
  assert.equal((await request('/pre-reservations', 'POST', { ...sample, startDate: sample.endDate, endDate: '2028-03-01' })).status, 201);
});
test('existing confirmed reservations block public pre-reservations', async t => {
  const { request } = await setup(t);
  assert.equal((await request('/reservations', 'POST', { date: sample.startDate, start: '12:00', end: '14:00' }, true)).status, 201);
  assert.equal((await request('/pre-reservations', 'POST', sample)).status, 409);
});
test('pre-reservations do not expire and payment can be confirmed after six hours', async t => {
  const { request, advance, database } = await setup(t);
  const { id } = await (await request('/pre-reservations', 'POST', sample)).json();
  advance(48 * hour);
  assert.equal((await request('/pre-reservations', 'POST', sample)).status, 409);
  assert.equal(JSON.parse(readFileSync(database)).preReservations[0].status, 'pending_payment');
  assert.equal((await request(`/pre-reservations/${id}/confirm-payment`, 'PATCH', {})).status, 401);
  assert.equal((await request(`/pre-reservations/${id}/confirm-payment`, 'PATCH', {}, true)).status, 200);
});
test('startup removes obsolete deadlines without reviving historical expired records', async t => {
  const { request, database, options } = await setup(t);
  await request('/pre-reservations', 'POST', sample);
  const db = JSON.parse(readFileSync(database)); db.preReservations[0].expiresAt = '2020-01-01T00:00:00Z';
  writeFileSync(database, JSON.stringify(db)); createContactApi(options);
  const record = JSON.parse(readFileSync(database)).preReservations[0];
  assert.equal(record.status, 'pending_payment'); assert.equal(record.expiresAt, undefined);
});
test('owner cancellation deletes only the related record and frees the calendar date', async t => {
  const { request, database } = await setup(t);
  const receipt = await (await request('/pre-reservations', 'POST', sample)).json();
  const other = await (await request('/pre-reservations', 'POST', { ...sample, startDate: '2028-03-02', endDate: '2028-03-03' })).json();
  assert.equal((await request(`/pre-reservations/${receipt.id}`, 'DELETE')).status, 404);
  const probe = await request('/availability?month=2028-02');
  const origin = new URL(probe.url).origin;
  assert.equal((await fetch(`${origin}/pre-reservations/${receipt.id}`, { method: 'DELETE', headers: { 'X-Cancellation-Token': other.cancellationToken } })).status, 404);
  const result = await fetch(`${origin}/pre-reservations/${receipt.id}`, { method: 'DELETE', headers: { 'X-Cancellation-Token': receipt.cancellationToken } });
  assert.equal(result.status, 204);
  assert.equal(JSON.parse(readFileSync(database)).preReservations.length, 1);
  const availability = await (await request('/availability?month=2028-02')).json();
  assert.equal(availability.days.find(day => day.date === sample.startDate).status, 'free');
  assert.equal(availability.reservations.length, 0);
});

test('prepares native FormSubmit with customer auto-response and manager message after saving', async t => {
  const { request, database } = await setup(t, { env: { CONTACTS_ADMIN_TOKEN: 'private-test', PUBLIC_SITE_URL: 'https://salao.example/', CONTRACT_PDF_URL: 'https://salao.example/contrato.pdf', PIX_PAYMENT_URL: 'https://salao.example/pix' } });
  const response = await request('/pre-reservations', 'POST', sample);
  assert.equal(response.status, 201);
  const receipt = await response.json();
  const { action, fields } = receipt.submission;
  assert.equal(action, 'https://formsubmit.co/a13xandr3ea%40gmail.com');
  assert.equal(fields.email, sample.email);
  for (const value of [sample.name, sample.phone, sample.email, receipt.id]) assert.ok(fields.message.includes(value));
  assert.match(fields._autoresponse, /feita com sucesso/);
  assert.ok(fields._autoresponse.includes('https://salao.example/contrato.pdf'));
  assert.ok(fields._autoresponse.includes('https://salao.example/pix'));
  assert.ok(fields._autoresponse.includes(receipt.cancellationToken));
  assert.ok(fields._autoresponse.includes('#enviar-contrato?'));
  assert.equal(fields._autoresponse.includes('6 horas'), false);
  assert.equal(fields._captcha, undefined);
  assert.equal(fields._next, 'https://salao.example/#pre-reserva');
  assert.equal(receipt.notifications.customer.status, 'awaiting_formsubmit');
  assert.equal(receipt.notifications.manager.status, 'awaiting_formsubmit');
  assert.equal(JSON.parse(readFileSync(database)).preReservations[0].notificationProvider, 'formsubmit');
});
test('daily calendar uses the occupied date and keeps checkout free', async t => {
  const { request } = await setup(t);
  assert.equal((await request('/pre-reservations', 'POST', { name: sample.name, phone: sample.phone, email: sample.email, startDate: sample.startDate, endDate: sample.endDate })).status, 201);
  const data = await (await request('/availability?month=2028-02')).json();
  assert.equal(data.days.find(day => day.date === sample.startDate).status, 'reserved');
  assert.equal(data.days.find(day => day.date === sample.endDate).status, 'free');
  assert.equal((await request('/reservation-resources/pix')).status, 200);
});
test('FormSubmit diagnostics require no SMTP and never claim email delivery', async t => {
  const { request } = await setup(t);
  const status = await (await request('/pre-reservations/mail-status', 'GET', null, true)).json();
  assert.equal(status.configured, true);
  assert.equal(status.provider, 'formsubmit');
  assert.equal(status.verification, 'managed_by_formsubmit');
  assert.equal((await request('/pre-reservations/mail-status')).status, 401);
});
test('only the owner can resume FormSubmit without creating a second reservation', async t => {
  const { request, database } = await setup(t);
  const receipt = await (await request('/pre-reservations', 'POST', sample)).json();
  const endpoint = `/pre-reservations/${receipt.id}/notification-form`;
  assert.equal((await request(endpoint)).status, 404);
  const probe = await request('/availability?month=2028-02');
  const response = await fetch(new URL(endpoint, probe.url), { headers: { 'X-Cancellation-Token': receipt.cancellationToken } });
  assert.equal(response.status, 200);
  assert.ok((await response.json()).submission.fields._autoresponse.includes(receipt.id));
  assert.equal(JSON.parse(readFileSync(database)).preReservations.length, 1);
  assert.equal((await request(`/pre-reservations/${receipt.id}/retry-notifications`, 'POST', {})).status, 401);
});

test('signed-contract form is owner-only and emails the manager with booking identification', async t => {
  const { request } = await setup(t);
  const receipt = await (await request('/pre-reservations', 'POST', sample)).json();
  const endpoint = `/pre-reservations/${receipt.id}/contract-form`;
  assert.equal((await request(endpoint)).status, 404);
  const probe = await request('/availability?month=2028-02');
  const response = await fetch(new URL(endpoint, probe.url), { headers: { 'X-Cancellation-Token': receipt.cancellationToken } });
  assert.equal(response.status, 200);
  const { submission } = await response.json();
  assert.ok(submission.fields.message.includes(receipt.id));
  assert.equal(submission.fields.email, sample.email);
  assert.equal(submission.fields._subject, 'Contrato assinado — Família Tx');
  assert.equal(submission.fields._autoresponse, undefined);
});
test('manager can unilaterally cancel through the private admin endpoint', async t => {
  const { request, database } = await setup(t);
  const { id } = await (await request('/pre-reservations', 'POST', sample)).json();
  const path = `/admin/pre-reservations/${id}`;
  assert.equal((await request(path, 'DELETE')).status, 401);
  assert.equal((await request(path, 'DELETE', null, true)).status, 204);
  assert.equal(JSON.parse(readFileSync(database)).preReservations.length, 0);
});
