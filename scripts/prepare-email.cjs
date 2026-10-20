const { readFileSync, writeFileSync, mkdirSync, chmodSync } = require('node:fs');
const { randomBytes } = require('node:crypto');

// Prepare a private SQL file; never print secrets or include them in versioned files.
let content = readFileSync('.env', 'utf8');
let token = content.match(/^MAIL_WORKER_TOKEN=(.*)$/m)?.[1].trim();
if (!token) {
  token = randomBytes(32).toString('hex');
  content = content.replace(/^MAIL_WORKER_TOKEN=.*\n?/m, '');
  writeFileSync('.env', content.trimEnd() + '\nMAIL_WORKER_TOKEN=' + token + '\n', { mode: 0o600 });
}
if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('MAIL_WORKER_TOKEN precisa conter 64 caracteres hexadecimais.');
chmodSync('.env', 0o600);
const setup = readFileSync('supabase/setup-email-worker.sql', 'utf8');
const secretSql = `do $setup$ declare existing_id uuid; begin
  select id into existing_id from vault.secrets where name = 'booking_email_worker_token';
  if existing_id is null then
    perform vault.create_secret('${token}', 'booking_email_worker_token');
  else
    perform vault.update_secret(existing_id, '${token}');
  end if;
end $setup$;\n`;
mkdirSync('supabase/.temp', { recursive: true });
const path = 'supabase/.temp/setup-email-worker.sql';
writeFileSync(path, setup.replace('begin;', 'begin;\n' + secretSql), { mode: 0o600 });
chmodSync(path, 0o600);
console.log('SQL privado preparado em ' + path + '. Execute-o no SQL Editor após publicar o worker.');
