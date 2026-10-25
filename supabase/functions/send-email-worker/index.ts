/** Registra o worker HTTP e fornece as dependências de SMTP e banco à fila de e-mails. */
import nodemailer from 'npm:nodemailer@10.1.7';
import { createGmailSender, verifyGmailConnection } from '../_shared/gmail.mjs';
import { handleWorker } from '../_shared/email-worker.mjs';
import { env, rpc } from '../_shared/runtime.ts';

Deno.serve((request: Request) => handleWorker(request, {
  env,
  rpc,
  verifySmtp: () => verifyGmailConnection(env, nodemailer.createTransport),
  sendMail: (message: Record<string, unknown>) =>
    createGmailSender(env, nodemailer.createTransport)(message),
}));
