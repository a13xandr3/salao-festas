const { resolve } = require('node:path');
require('dotenv').config({ path: resolve(__dirname, '../.env'), quiet: true });
const { mailConfiguration } = require('./mail-configuration.cjs');
const config = mailConfiguration();
if (!config.configured) { console.error(`Configuração FormSubmit inválida: ${config.missing.join(', ')}`); process.exitCode = 1; }
else console.log('FormSubmit configurado. Sem SMTP. O destinatário gestor precisa estar ativado no FormSubmit; o cliente deve concluir a verificação do formulário para receber a resposta automática. Nenhum e-mail foi enviado por esta verificação.');
