const { readFileSync } = require('node:fs');
const config = JSON.parse(readFileSync('public/app-config.json', 'utf8'));
const token = readFileSync('.env', 'utf8').match(/^MAIL_WORKER_TOKEN=(.*)$/m)?.[1].trim();

// Authenticates from the hosted worker without claiming a job or sending a message.
(async () => {
  if (!token) throw new Error('MAIL_WORKER_TOKEN não configurado no .env.');
  const response = await fetch(`${config.supabaseUrl}/functions/v1/send-email-worker`, {
    headers: { 'x-email-worker-token': token }, signal: AbortSignal.timeout(55000),
  });
  const result = await response.json();
  if (!response.ok || result.smtp !== true)
    throw new Error(`Conexão SMTP no Supabase não foi confirmada (HTTP ${response.status}).`);
  console.log('Conexão TLS e autenticação Gmail confirmadas pela Edge Function. Nenhuma mensagem enviada.');
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
