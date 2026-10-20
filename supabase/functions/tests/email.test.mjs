import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleEmail } from '../_shared/email-handler.mjs';
import { handleWorker } from '../_shared/email-worker.mjs';
import { createGmailSender, verifyGmailConnection } from '../_shared/gmail.mjs';

const origin = 'https://example.com';
const token = 'a'.repeat(64);
const id = '00000000-0000-4000-8000-000000000001';
const record = {
  id,
  name: 'Cliente Teste',
  phone: '11999999999',
  email: 'client@example.com',
  message: 'Consulta',
  startAt: '2038-02-01T11:00:00Z',
  endAt: '2038-02-02T11:00:00Z',
};
const env = {
  MAIL_WORKER_TOKEN: 'w'.repeat(64),
  MAIL_ALLOWED_ORIGINS: origin,
  MAIL_MANAGER_EMAIL: 'manager@example.com',
  PUBLIC_SITE_URL: `${origin}/salao-festas/`,
  CONTRACT_URL: 'documents/contrato.pdf',
  PIX_URL: 'pix.html',
};
function request(kind = 'reservation', extra = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries({ kind, id, token, ...extra })) data.set(key, value);
  return new Request(`${origin}/send-email`, { method: 'POST', headers: { origin }, body: data });
}
function setup() {
  const sent = [];
  const deliveries = new Map();
  const jobs = [];
  let failCustomer = false;
  const dependencies = {
    env,
    sendMail: async (message) => {
      if (message.to === record.email && failCustomer) {
        failCustomer = false;
        throw new Error('Private SMTP diagnostic');
      }
      sent.push(message);
    },
    rpc: async (name, input) => {
      if (name === 'booking_request_email') {
        if (input.p_token !== token)
          throw Object.assign(new Error('Invalid capability'), { status: 404 });
        for (const role of input.p_kind === 'reservation' ? ['manager', 'customer'] : ['manager']) {
          const key = `${input.p_kind}:${role}`;
          if (!deliveries.has(key)) {
            deliveries.set(key, 'pending');
            jobs.push({ claimId: key, kind: input.p_kind, role,
              record: { ...record, notificationToken: token }, attachment: input.p_attachment });
          }
        }
        const states = [...deliveries.entries()].filter(([key]) => key.startsWith(input.p_kind + ':'));
        const sent = states.every(([, status]) => status === 'sent');
        return { sent, queued: !sent };
      }
      if (name === 'booking_next_email') {
        const next = jobs.find((j) => ['pending', 'failed'].includes(deliveries.get(j.claimId)));
        if (!next) return null;
        deliveries.set(next.claimId, 'sending');
        return next;
      }
      deliveries.set(input.p_claim, input.p_sent ? 'sent' : 'failed');
    },
  };
  return { sent, deliveries, dependencies, failCustomer: () => { failCustomer = true; } };
}
function worker(dependencies, token = env.MAIL_WORKER_TOKEN) {
  return handleWorker(new Request(origin, { method: 'POST', headers: { 'x-email-worker-token': token } }), dependencies);
}
test('SMTP transport uses Gmail TLS 465 and overwrites a caller-supplied sender', async () => {
  let options;
  let message;
  const send = createGmailSender(
    {
      GMAIL_HOST: 'smtp.gmail.com',
      GMAIL_PORT: '465',
      GMAIL_USER: 'account@gmail.com',
      GMAIL_APP_PASSWORD: 'test password',
    },
    (value) => {
      options = value;
      return {
        sendMail: async (value) => {
          message = value;
          return { accepted: [value.to] };
        },
      };
    },
  );
  await send({ from: 'forged@example.com', to: 'client@example.com', text: 'Hello' });
  assert.equal(options.secure, true);
  assert.equal(options.port, 465);
  assert.equal(options.auth.pass, 'testpassword');
  assert.equal(message.from.address, 'account@gmail.com');
  assert.equal(options.disableUrlAccess, true);
});
test('sends manager and customer notifications with server-generated individual links', async () => {
  const { sent, dependencies } = setup();
  const response = await handleEmail(request(), dependencies);
  assert.equal(response.status, 202);
  assert.equal((await response.json()).queued, true);
  assert.equal(sent.length, 0);
  await worker(dependencies);
  assert.deepEqual(
    sent.map((message) => message.to),
    ['manager@example.com', record.email],
  );
  assert.ok(sent[1].text.includes(`${origin}/salao-festas/documents/contrato.pdf`));
  assert.ok(sent[1].text.includes(`#cancelar-pre-reserva?id=${id}&token=${token}`));
  assert.ok(sent[1].text.includes('#enviar-contrato?'));
  assert.ok(sent[1].text.includes(`${origin}/salao-festas/pix.html`));
});
test('successful notifications are skipped on retry', async () => {
  const { sent, dependencies } = setup();
  await handleEmail(request(), dependencies);
  await worker(dependencies);
  const response = await handleEmail(request(), dependencies);
  assert.deepEqual(await response.json(), { sent: true, queued: false });
  await worker(dependencies);
  assert.equal(sent.length, 2);
});
test('after partial SMTP failure, retry sends only the missing notification', async () => {
  const state = setup();
  state.failCustomer();
  await handleEmail(request(), state.dependencies);
  const failure = await worker(state.dependencies);
  assert.ok(!(await failure.text()).includes('Private SMTP'));
  assert.equal(state.deliveries.get('reservation:manager'), 'sent');
  assert.equal(state.deliveries.get('reservation:customer'), 'failed');
  assert.equal((await worker(state.dependencies)).status, 200);
  assert.equal(state.sent.length, 2);
});
test('rejects invalid ownership before SMTP', async () => {
  const { sent, dependencies } = setup();
  assert.equal(
    (await handleEmail(request('reservation', { token: 'b'.repeat(64) }), dependencies)).status,
    404,
  );
  assert.equal(sent.length, 0);
});
test('rejects arbitrary destinations or bodies instead of becoming a mail relay', async () => {
  const { sent, dependencies } = setup();
  assert.equal(
    (await handleEmail(request('contact', { to: 'victim@example.com' }), dependencies)).status,
    400,
  );
  assert.equal(
    (await handleEmail(request('contact', { subject: 'Forged' }), dependencies)).status,
    400,
  );
  assert.equal(sent.length, 0);
});
test('sends contact only to the manager with the customer as reply-to', async () => {
  const { sent, dependencies } = setup();
  assert.equal((await handleEmail(request('contact'), dependencies)).status, 202);
  await worker(dependencies);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, env.MAIL_MANAGER_EMAIL);
  assert.equal(sent[0].replyTo, record.email);
});
test('validates PDF on the server and sends it as attachment to the manager', async () => {
  const { sent, dependencies } = setup();
  const valid = request('contract', {
    attachment: new File(['%PDF-1.4\ncontent'], 'signed.pdf', { type: 'application/pdf' }),
  });
  assert.equal((await handleEmail(valid, dependencies)).status, 202);
  await worker(dependencies);
  assert.equal(sent[0].to, env.MAIL_MANAGER_EMAIL);
  assert.equal(sent[0].attachments[0].filename, 'contrato-assinado.pdf');
  const invalid = request('contract', { attachment: new File(['not PDF'], 'fake.pdf') });
  assert.equal((await handleEmail(invalid, dependencies)).status, 400);
  assert.equal(sent.length, 1);
});
test('CORS accepts only configured origins and supports the browser preflight', async () => {
  const { dependencies } = setup();
  const preflight = await handleEmail(
    new Request(origin, { method: 'OPTIONS', headers: { origin } }),
    dependencies,
  );
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), origin);
  const denied = await handleEmail(
    new Request(origin, { method: 'OPTIONS', headers: { origin: 'https://other.example' } }),
    dependencies,
  );
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get('Access-Control-Allow-Origin'), null);
});

test('worker rejects public keys and missing or invalid secrets before claiming jobs', async () => {
  const state = setup();
  await handleEmail(request(), state.dependencies);
  for (const badToken of ['', 'sb_publishable_public', 'x'.repeat(64), 'é'.repeat(64)]) {
    assert.equal((await worker(state.dependencies, badToken)).status, 401);
  }
  assert.equal(state.sent.length, 0);
  assert.equal(state.deliveries.get('reservation:manager'), 'pending');
});
test('worker retains an unacknowledged SMTP acceptance for lease recovery', async () => {
  const state = setup();
  await handleEmail(request('contact'), state.dependencies);
  const rpc = state.dependencies.rpc;
  state.dependencies.rpc = (name, input) => {
    if (name === 'booking_finish_email') throw new Error('Database offline');
    return rpc(name, input);
  };
  assert.equal((await worker(state.dependencies)).status, 503);
  assert.equal(state.sent.length, 1);
  assert.equal(state.deliveries.get('contact:manager'), 'sending');
});
test('SMTP timeout closes the transport without keeping the browser request open', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let closed = false;
  const send = createGmailSender({
    GMAIL_HOST: 'smtp.gmail.com', GMAIL_PORT: '465',
    GMAIL_USER: 'test@gmail.com', GMAIL_APP_PASSWORD: 'test-password',
  }, () => ({ sendMail: () => new Promise(() => {}), close: () => { closed = true; } }));
  const pending = send({ to: 'client@example.com', text: 'Test' });
  t.mock.timers.tick(40000);
  await assert.rejects(pending, /Tempo limite/);
  assert.equal(closed, true);
});
test('authenticated SMTP diagnostics never claim or send an email', async () => {
  let verified = false;
  const dependencies = {
    env,
    rpc: () => { throw new Error('Diagnostics cannot claim jobs'); },
    sendMail: () => { throw new Error('Diagnostics cannot send mail'); },
    verifySmtp: async () => { verified = true; },
  };
  const response = await handleWorker(new Request(origin, {
    headers: { 'x-email-worker-token': env.MAIL_WORKER_TOKEN },
  }), dependencies);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { smtp: true });
  assert.equal(verified, true);
  assert.equal((await handleWorker(new Request(origin), dependencies)).status, 401);
});
test('SMTP verification closes its connection without invoking sendMail', async () => {
  let verified = false;
  let closed = false;
  await verifyGmailConnection({ GMAIL_HOST: 'smtp.gmail.com', GMAIL_PORT: '465',
    GMAIL_USER: 'test@gmail.com', GMAIL_APP_PASSWORD: 'app-password' }, () => ({
    verify: async () => { verified = true; return true; },
    close: () => { closed = true; },
    sendMail: () => { throw new Error('Cannot send during verification'); },
  }));
  assert.equal(verified, true);
  assert.equal(closed, true);
});
