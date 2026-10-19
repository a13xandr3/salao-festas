const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, writeFileSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { createContactApi } = require('./contact-api.cjs');
const sample = { name: 'Contato Teste', phone: '(11) 99999-9999', email: 'teste@example.com', message: 'Gostaria de conhecer o espaço.' };
async function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), 'salao-api-'));
  const database = join(dir, 'db.json');
  writeFileSync(database, JSON.stringify({ contacts: [] }));
  const app = createContactApi({ database, env: { CONTACTS_ADMIN_TOKEN: 'test-private-token' }, rateLimitEnabled: false });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); rmSync(dir, { recursive: true }); });
  const url = `http://127.0.0.1:${server.address().port}`;
  return {
    database,
    request: (path = '/contacts', method = 'GET', body, admin = false) => fetch(`${url}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(admin ? { Authorization: 'Bearer test-private-token' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }),
  };
}
test('POST persists and supports authenticated CRUD without sending another email', async t => {
  const { request } = await setup(t);
  const response = await request('/contacts', 'POST', sample);
  assert.equal(response.status, 201);
  const { id } = await response.json();
  assert.ok(id);
  assert.equal((await request()).status, 401);
  assert.equal((await request(`/contacts/${id}`, 'PATCH', { message: 'Alterado' })).status, 401);
  assert.equal((await request(`/contacts/${id}`, 'DELETE')).status, 401);
  const records = await (await request('/contacts', 'GET', null, true)).json();
  assert.equal(records[0].emailProvider, 'formsubmit');
  assert.equal(records[0].emailStatus, 'not_tracked');
  assert.ok(records[0].createdAt);
  const patched = await request(`/contacts/${id}`, 'PATCH', { message: 'Alterado' }, true);
  assert.equal(patched.status, 200);
  assert.equal((await patched.json()).message, 'Alterado');
  assert.equal((await request(`/contacts/${id}`, 'GET', null, true)).status, 200);
  assert.equal((await request(`/contacts/${id}`, 'DELETE', null, true)).status, 200);
  assert.deepEqual(await (await request('/contacts', 'GET', null, true)).json(), []);
});
test('rejects invalid, overlong, and forged fields without saving', async t => {
  const { request, database } = await setup(t);
  for (const body of [{}, { ...sample, message: ' ' }, { ...sample, message: 'x'.repeat(2001) }, { ...sample, phone: '123' }, { ...sample, email: 'invalid' }, { ...sample, emailStatus: 'sent' }, { ...sample, name: 'x' }]) {
    assert.equal((await request('/contacts', 'POST', body)).status, 400);
  }
  assert.deepEqual(JSON.parse(readFileSync(database)).contacts, []);
  assert.equal((await request('/contacts', 'POST', { ...sample, message: 'x'.repeat(2000) })).status, 201);
});
test('PATCH cannot overwrite identifiers, delivery status or violate the message limit', async t => {
  const { request } = await setup(t);
  const { id } = await (await request('/contacts', 'POST', sample)).json();
  for (const body of [{ id: 'changed' }, { emailStatus: 'sent' }, { message: 'x'.repeat(2001) }]) {
    assert.equal((await request(`/contacts/${id}`, 'PATCH', body, true)).status, 400);
  }
  assert.equal((await request('/other', 'GET', null, true)).status, 404);
});

test('public availability exposes only time ranges and booking CRUD requires authentication', async t => {
  const { request } = await setup(t);
  const reservation = { date: '2028-02-29', start: '10:00', end: '12:00' };
  assert.equal((await request('/reservations', 'POST', reservation)).status, 401);
  assert.equal((await request('/reservations')).status, 401);
  const created = await request('/reservations', 'POST', reservation, true);
  assert.equal(created.status, 201);
  const { id } = await created.json();
  const publicResponse = await request('/availability?month=2028-02');
  assert.equal(publicResponse.status, 200);
  const publicData = await publicResponse.json();
  assert.deepEqual(publicData.reservations, [reservation]);
  assert.equal(publicData.timeZone, 'America/Sao_Paulo');
  assert.equal(JSON.stringify(publicData).includes(id), false);
  assert.equal((await request('/reservations', 'POST', { ...reservation, start: '11:00', end: '13:00' }, true)).status, 409);
  assert.equal((await request('/reservations', 'POST', { ...reservation, start: '12:00', end: '13:00' }, true)).status, 201);
  assert.equal((await request(`/reservations/${id}`, 'PATCH', { start: '09:00' }, true)).status, 200);
  assert.equal((await request(`/reservations/${id}`, 'DELETE', null, true)).status, 204);
  assert.equal((await request(`/reservations/${id}`, 'DELETE', null, true)).status, 404);
});
test('reservation validation rejects nonexistent dates, invalid hours and forged fields', async t => {
  const { request } = await setup(t);
  for (const body of [
    { date: '2028-02-30', start: '10:00', end: '12:00' },
    { date: '2028-02-29', start: '07:00', end: '09:00' },
    { date: '2028-02-29', start: '10:00', end: '09:00' },
    { date: '2028-02-29', start: '10:15', end: '12:00' },
    { date: '2028-02-29', start: '10:00', end: '12:00', name: 'Private name' },
  ]) assert.equal((await request('/reservations', 'POST', body, true)).status, 400);
  assert.equal((await request('/availability?month=bad')).status, 400);
});
