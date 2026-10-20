import { Buffer } from 'node:buffer';
const maxBody = 11 * 1024 * 1024;
const maxPdf = 10 * 1024 * 1024;
class MailError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function parseRequest(request) {
  if (!request.headers.get('content-type')?.startsWith('multipart/form-data;'))
    throw new MailError(400, 'Formato inválido.');
  const chunks = [];
  let size = 0;
  const reader = request.body?.getReader();
  if (!reader) throw new MailError(400, 'Dados ausentes.');
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBody) {
      await reader.cancel();
      throw new MailError(413, 'Arquivo muito grande.');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const form = await new Response(bytes, {
    headers: { 'content-type': request.headers.get('content-type') },
  }).formData();
  const kind = form.get('kind');
  const id = form.get('id');
  const token = form.get('token');
  if (
    Array.from(form.keys()).some((key) => !['kind', 'id', 'token', 'attachment'].includes(key)) ||
    ['kind', 'id', 'token', 'attachment'].some((key) => form.getAll(key).length > 1) ||
    !['contact', 'reservation', 'contract'].includes(kind) ||
    typeof id !== 'string' ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id) ||
    typeof token !== 'string' ||
    !/^[a-f0-9]{64}$/.test(token)
  )
    throw new MailError(400, 'Solicitação inválida.');
  let attachment;
  let fingerprint = '';
  if (kind === 'contract') {
    const file = form.get('attachment');
    if (!(file instanceof Blob) || file.size > maxPdf || !file.name?.toLowerCase().endsWith('.pdf'))
      throw new MailError(400, 'Selecione um PDF de até 10 MB.');
    attachment = new Uint8Array(await file.arrayBuffer());
    if (new TextDecoder().decode(attachment.slice(0, 5)) !== '%PDF-')
      throw new MailError(400, 'PDF inválido.');
    fingerprint = Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', attachment)),
      (byte) => byte.toString(16).padStart(2, '0'),
    ).join('');
  } else if (form.has('attachment')) throw new MailError(400, 'Anexo não permitido.');
  return { kind, id, token, attachment, fingerprint };
}

/** Validates a capability and acknowledges durable queueing, without waiting for SMTP. */
export async function handleEmail(request, { env, rpc }) {
  const origin = request.headers.get('origin');
  const allowed = (env.MAIL_ALLOWED_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const cors = {
    Vary: 'Origin',
    ...(allowed.includes(origin) ? { 'Access-Control-Allow-Origin': origin } : {}),
  };
  const reply = (body, status = 200) => Response.json(body, { status, headers: cors });
  if (!allowed.includes(origin)) return reply({ message: 'Origem não permitida.' }, 403);
  if (request.method === 'OPTIONS')
    return new Response(null, {
      status: 204,
      headers: {
        ...cors,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'apikey, content-type, authorization, x-client-info',
      },
    });
  if (request.method !== 'POST') return reply({ message: 'Método não permitido.' }, 405);
  try {
    const { kind, id, token, attachment, fingerprint } = await parseRequest(request);
    const result = await rpc('booking_request_email', {
      p_kind: kind,
      p_id: id,
      p_token: token,
      p_fingerprint: fingerprint,
      p_attachment: attachment ? Buffer.from(attachment).toString('base64') : null,
    });
    return reply(result, result.sent ? 200 : 202);
  } catch (error) {
    const status = [400, 403, 404, 409, 413, 429].includes(error.status) ? error.status : 503;
    return reply(
      { message: status === 503 ? 'Envio indisponível. Tente novamente.' : error.message },
      status,
    );
  }
}
