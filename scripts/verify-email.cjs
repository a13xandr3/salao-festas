const { readFileSync } = require('node:fs');
const { randomUUID, randomBytes } = require('node:crypto');
const config = JSON.parse(readFileSync('public/app-config.json', 'utf8'));
const origin = new URL('https://a13xandr3.github.io/salao-festas/').origin;

// Checks deployment without inserting records, claiming jobs or sending emails.
(async () => {
  const preflight = await fetch(`${config.supabaseUrl}/functions/v1/send-email`, {
    method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'apikey,content-type' }, signal: AbortSignal.timeout(15000),
  });
  if (preflight.status !== 204 || preflight.headers.get('access-control-allow-origin') !== origin)
    throw new Error(`send-email indisponível ou CORS incorreto (HTTP ${preflight.status}).`);
  const invalid = new FormData();
  invalid.set('kind', 'invalid');
  const queue = await fetch(`${config.supabaseUrl}/functions/v1/send-email`, {
    method: 'POST', headers: { Origin: origin, apikey: config.supabasePublishableKey }, body: invalid,
    signal: AbortSignal.timeout(15000),
  });
  if (queue.status !== 400) throw new Error(`Validação send-email inesperada (HTTP ${queue.status}).`);
  const deniedData = new FormData();
  deniedData.set('kind', 'contact');
  deniedData.set('id', randomUUID());
  deniedData.set('token', randomBytes(32).toString('hex'));
  const ownership = await fetch(`${config.supabaseUrl}/functions/v1/send-email`, {
    method: 'POST', headers: { Origin: origin, apikey: config.supabasePublishableKey }, body: deniedData,
    signal: AbortSignal.timeout(15000),
  });
  if (ownership.status !== 404)
    throw new Error(`Migração, credencial interna ou validação de propriedade indisponível (HTTP ${ownership.status}).`);
  const worker = await fetch(`${config.supabaseUrl}/functions/v1/send-email-worker`, {
    method: 'POST', signal: AbortSignal.timeout(15000),
  });
  if (worker.status !== 401) throw new Error(`Worker indisponível ou sem proteção (HTTP ${worker.status}).`);
  console.log('Endpoints publicados e validações públicas corretas. SMTP e agendamento exigem validação operacional.');
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
