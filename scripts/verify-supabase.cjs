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

  if (process.argv.includes('--write-reservation') && calendar.status === 200) {
    const freeDay = calendar.body.days.slice(0, -1).find((day) => day.status === 'free');
    if (!freeDay) throw new Error('Nenhuma data de teste livre encontrada.');
    const endDate = new Date(`${freeDay.date}T12:00:00Z`);
    endDate.setUTCDate(endDate.getUTCDate() + 1);
    let record;
    try {
      const created = await request('rpc/booking_create_reservation', {
        p_input: {
          name: 'Verificação técnica temporária',
          phone: '11999999999',
          email: `verification-${randomUUID()}@example.invalid`,
          startDate: freeDay.date,
          endDate: endDate.toISOString().slice(0, 10),
        },
      });
      if (created.status === 200) record = created.body;
      check(
        'create temporary reservation',
        created.status === 200 && !!record?.notificationToken,
        created.status,
      );
      if (!record) throw new Error(`Criação rejeitada: ${JSON.stringify(created.body)}`);
      const reserved = await request('rpc/booking_availability', { p_month: month });
      check(
        'created period becomes reserved',
        reserved.body.days?.find((day) => day.date === freeDay.date)?.status === 'reserved',
        reserved.status,
      );
      const form = await request('rpc/booking_owned_reservation', {
        p_id: record.id,
        p_token: record.notificationToken,
        p_contract: true,
      });
      check(
        'owner can retrieve contract data',
        form.status === 200 && form.body.id === record.id,
        form.status,
      );
    } finally {
      if (record?.notificationToken) {
        const deleted = await request('rpc/booking_cancel_reservation', {
          p_id: record.id,
          p_token: record.notificationToken,
        });
        check(
          'delete temporary reservation',
          deleted.status === 200 && deleted.body.cancelled === true,
          deleted.status,
        );
        if (deleted.status !== 200)
          console.error(`Remova a reserva de teste no painel: ${record.id}`);
        const released = await request('rpc/booking_availability', { p_month: month });
        check(
          'cancelled period becomes free',
          released.body.days?.find((day) => day.date === freeDay.date)?.status === 'free',
          released.status,
        );
      }
    }
  }
})()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => console.log(JSON.stringify(results, null, 2)));
