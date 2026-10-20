import { Buffer } from 'node:buffer';
import { timingSafeEqual } from 'node:crypto';
import { messageFor } from './email-message.mjs';

/** Only the private scheduler can consume the outbox. SMTP runs outside the browser request. */
export async function handleWorker(request, { env, rpc, sendMail, verifySmtp }) {
  const expected = env.MAIL_WORKER_TOKEN || '';
  const supplied = request.headers.get('x-email-worker-token') || '';
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  if (expected.length < 32 || suppliedBytes.length !== expectedBytes.length ||
      !timingSafeEqual(suppliedBytes, expectedBytes))
    return Response.json({ message: 'Não autorizado.' }, { status: 401 });
  if (request.method === 'GET') {
    try {
      await verifySmtp();
      return Response.json({ smtp: true });
    } catch {
      return Response.json({ smtp: false }, { status: 503 });
    }
  }
  if (request.method !== 'POST')
    return Response.json({ message: 'Método não permitido.' }, { status: 405 });
  const processOne = async () => {
    const job = await rpc('booking_next_email', {});
    if (!job || job.skipped) return false;
    const attachment = job.attachment ? Buffer.from(job.attachment, 'base64') : undefined;
    try {
      await sendMail(messageFor(job.record, job.kind, job.role, job.record.notificationToken, env, attachment));
    } catch (error) {
      console.error('Falha no envio SMTP.', {
        code: /^[A-Z_]{1,30}$/.test(error?.code || '') ? error.code : 'SMTP',
        responseCode: Number.isInteger(error?.responseCode) ? error.responseCode : undefined,
      });
      await rpc('booking_finish_email', { p_claim: job.claimId, p_sent: false });
      return false;
    }
    // If acknowledgement fails, keep the lease: SMTP may already have accepted the email.
    await rpc('booking_finish_email', { p_claim: job.claimId, p_sent: true });
    return true;
  };
  const results = await Promise.allSettled([processOne(), processOne()]);
  const failed = results.some((result) => result.status === 'rejected');
  if (failed) console.error('Não foi possível confirmar o processamento da fila de e-mail.');
  return Response.json({ processed: results.filter((r) => r.status === 'fulfilled' && r.value).length },
    { status: failed ? 503 : 200 });
}
