const { readFileSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
const config = JSON.parse(readFileSync('public/app-config.json', 'utf8'));
const results = [];

async function request(path, body) {
  const response = await fetch(`${config.supabaseUrl}/rest/v1/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { apikey: config.supabasePublishableKey, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15000),
  });
  return { status: response.status, body: await response.json() };
}
function check(name, valid, status) {
  results.push({ check: name, ok: valid, status });
  if (!valid) process.exitCode = 1;
}

(async () => {
  const month = '2099-01';
  const calendar = await request('rpc/booking_availability', { p_month: month });
  check(
    'public availability',
    calendar.status === 200 && calendar.body.days?.length === 31,
    calendar.status,
  );
  for (const table of ['contacts', 'preReservations']) {
    const result = await request(`${table}?select=id&limit=0`);
    check(
      `${table}: anonymous table access denied`,
      [401, 403].includes(result.status),
      result.status,
    );
  }
  for (const operation of ['booking_create_contact', 'booking_create_reservation']) {
    const result = await request(`rpc/${operation}`, { p_input: {} });
    check(`${operation}: validation rejects incomplete data`, result.status === 400, result.status);
  }
  const owned = await request('rpc/booking_owned_reservation', {
    p_id: randomUUID(),
    p_token: 'a'.repeat(64),
    p_contract: true,
  });
  check('ownership required', owned.status === 404, owned.status);
})()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => console.log(JSON.stringify(results, null, 2)));
