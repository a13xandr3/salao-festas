const { DateTime } = require('luxon');
function httpUrl(value) { try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; } }
function createReservationMailer(db, { env = process.env } = {}) {
  const manager = env.RESERVATION_MANAGER_EMAIL || 'a13xandr3ea@gmail.com';
  const site = httpUrl(env.PUBLIC_SITE_URL || 'http://localhost:4209');
  const links = { contract: httpUrl(env.CONTRACT_PDF_URL) || (site ? new URL('documents/contrato-demonstracao.pdf', site).href : null), pix: httpUrl(env.PIX_PAYMENT_URL) || (site ? new URL('api/reservation-resources/pix', site).href : null), site };
  const missing = [];
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(manager)) missing.push('RESERVATION_MANAGER_EMAIL');
  if (!site) missing.push('PUBLIC_SITE_URL');
  if (!links.contract) missing.push('CONTRACT_PDF_URL');
  if (!links.pix) missing.push('PIX_PAYMENT_URL');
  const format = value => DateTime.fromISO(value).setZone('America/Sao_Paulo').toFormat('dd/MM/yyyy HH:mm');
  function submission(id) {
    const record = db.get('preReservations').find({ id }).value();
    if (!record || record.status !== 'pending_payment' || missing.length) return null;
    const upload = `${site.replace(/\/$/, '')}/#enviar-contrato?id=${encodeURIComponent(record.id)}&token=${encodeURIComponent(record.notificationToken)}`;
    const cancellation = `${site.replace(/\/$/, '')}/#cancelar-pre-reserva?id=${encodeURIComponent(record.id)}&token=${encodeURIComponent(record.notificationToken)}`;
    const details = `Protocolo: ${record.id}\nNome: ${record.name}\nTelefone: ${record.phone}\nE-mail: ${record.email}\nPeríodo: ${format(record.startAt)} até ${format(record.endAt)} (Brasília).`;
    return {
      action: `https://formsubmit.co/${encodeURIComponent(manager)}`,
      fields: {
        name: record.name, phone: record.phone, email: record.email,
        message: `Uma nova pré-reserva foi registrada na Família Tx.\n\n${details}`,
        _subject: 'Nova pré-reserva — Família Tx', _template: 'table', _replyto: record.email,
        _next: `${site.replace(/\/$/, '')}/#pre-reserva`,
        _autoresponse: `Olá, ${record.name}!\nSua pré-reserva foi feita com sucesso e aguarda confirmação de pagamento.\n\n${details}\n\nBaixar contrato PDF: ${links.contract}\nPix / chave para pagamento: ${links.pix}\nApós o pagamento, assine digitalmente o contrato e envie o PDF por este link: ${upload}\nCancelar sua pré-reserva: ${cancellation}`,
      },
    };
  }
  function contractSubmission(id) {
    const record = db.get('preReservations').find({ id }).value();
    if (!record || !['pending_payment', 'confirmed'].includes(record.status) || missing.length) return null;
    return { action: `https://formsubmit.co/${encodeURIComponent(manager)}`, fields: {
      name: record.name, email: record.email, phone: record.phone,
      message: `Contrato assinado referente à pré-reserva ${record.id}. Cliente: ${record.name}. Período: ${format(record.startAt)} até ${format(record.endAt)} (Brasília).`,
      _subject: 'Contrato assinado — Família Tx', _template: 'table', _replyto: record.email,
      _next: `${site.replace(/\/$/, '')}/#contrato-enviado`,
    } };
  }
  function notify(id) {
    const current = db.get('preReservations').find({ id });
    if (!current.value() || current.value().status !== 'pending_payment') return;
    const status = missing.length ? 'configuration_required' : 'awaiting_formsubmit';
    current.assign({ notificationProvider: 'formsubmit', notifications: { customer: { provider: 'formsubmit', status }, manager: { provider: 'formsubmit', status } } }).write();
  }
  return { links, submission, contractSubmission, notify, diagnostics: () => ({ provider: 'formsubmit', configured: !missing.length, missing, verification: 'managed_by_formsubmit' }) };
}
module.exports = { createReservationMailer };
