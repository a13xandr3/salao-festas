const { randomUUID, randomBytes, createHash, timingSafeEqual } = require('node:crypto');
const { createReservationMailer } = require('./reservation-mailer.cjs');
const { DateTime } = require('luxon');
const { rateLimit } = require('express-rate-limit');
const zone = 'America/Sao_Paulo';
const hour = 60 * 60 * 1000;
const fields = ['name', 'phone', 'email', 'startDate', 'startTime', 'endDate', 'endTime'];
const parseLocal = (date, time) => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && typeof time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(time) ? DateTime.fromISO(`${date}T${time}`, { zone }) : DateTime.invalid('invalid input');
const overlap = (start, end, otherStart, otherEnd) => start < otherEnd && end > otherStart;
const active = record => ['confirmed', 'pending_payment'].includes(record.status);
function registerPreReservations(app, db, authorize, { clock = Date.now, rateLimitEnabled = true, env = process.env } = {}) {
  db.defaults({ preReservations: [] }).write();
  for (const record of db.get('preReservations').value()) {
    if (active(record)) { delete record.expiresAt; delete record.expiredAt; }
    if (!record.notificationToken) {
      record.notificationToken = randomBytes(32).toString('hex');
      record.cancellationTokenHash = createHash('sha256').update(record.notificationToken).digest('hex');
    }
    if (record.notificationProvider !== 'formsubmit') {
      record.notificationProvider = 'formsubmit';
      record.notifications = Object.fromEntries(['customer', 'manager'].map(role => [role, { provider: 'formsubmit', status: record.notifications?.[role]?.status === 'sent' ? 'sent' : 'awaiting_formsubmit' }]));
    }
  }
  db.write();
  const mailer = createReservationMailer(db, { env, clock });
  app.locals.mailConfiguration = mailer.diagnostics;
  app.use((_req, _res, next) => { try { db.read(); next(); } catch (error) { next(error); } });
  if (rateLimitEnabled) app.post('/pre-reservations', rateLimit({ windowMs: 15 * 60 * 1000, limit: 5, standardHeaders: 'draft-7', legacyHeaders: false, message: { message: 'Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.' } }));
  function conflicts(start, end, ignoreId) {
    return db.get('preReservations').value().some(item => item.id !== ignoreId && active(item) && overlap(start, end, Date.parse(item.startAt), Date.parse(item.endAt))) || db.get('reservations').value().some(item => overlap(start, end, parseLocal(item.date, item.start).toMillis(), parseLocal(item.date, item.end).toMillis()));
  }
  function ownedRecord(req) {
    const record = db.get('preReservations').find({ id: req.params.id }).value();
    const digest = createHash('sha256').update(req.get('X-Cancellation-Token') || '').digest();
    const expected = Buffer.from(record?.cancellationTokenHash || '', 'hex');
    return record && expected.length === digest.length && timingSafeEqual(expected, digest) ? record : null;
  }
  app.post('/pre-reservations', async (req, res, next) => {
    try {
      const body = req.body;
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !fields.includes(key)) || fields.filter(key => !['startTime', 'endTime'].includes(key)).some(key => typeof body[key] !== 'string' || !body[key].trim())) return res.status(400).json({ message: 'Preencha todos os campos obrigatórios.' });
      const values = Object.fromEntries(fields.map(key => [key, typeof body[key] === 'string' ? body[key].trim() : '08:00']));
      if (values.name.length < 2 || values.name.length > 120 || values.phone.length > 30 || !/^[+()\d\s.-]+$/.test(values.phone) || !/^\d{10,15}$/.test(values.phone.replace(/\D/g, '')) || values.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) return res.status(400).json({ message: 'Informe nome, telefone com DDD e e-mail válidos.' });
      const start = parseLocal(values.startDate, values.startTime);
      const end = parseLocal(values.endDate, values.endTime);
      const now = clock();
      if (!start.isValid || !end.isValid || start.toMillis() <= now) return res.status(400).json({ message: 'Informe datas válidas, com início no futuro (horário de Brasília).' });
      if (end.toMillis() - start.toMillis() < 24 * hour || (end.toMillis() - start.toMillis()) % (24 * hour) !== 0) return res.status(400).json({ message: 'O período mínimo da pré-reserva é de 24 horas.' });
      if (conflicts(start.toMillis(), end.toMillis())) return res.status(409).json({ message: 'O período escolhido já está reservado ou pré-reservado. Escolha outro intervalo.' });
      const cancellationToken = randomBytes(32).toString('hex');
      const record = { cancellationTokenHash: createHash('sha256').update(cancellationToken).digest('hex'), notificationToken: cancellationToken, notifications: { customer: { status: 'pending', attempts: 0 }, manager: { status: 'pending', attempts: 0 } }, id: randomUUID(), ...values, startAt: start.toUTC().toISO(), endAt: end.toUTC().toISO(), timeZone: zone, status: 'pending_payment', createdAt: new Date(now).toISOString() };
      db.get('preReservations').push(record).write();
      await mailer.notify(record.id);
      const saved = db.get('preReservations').find({ id: record.id }).value();
      res.status(201).json({ id: record.id, status: record.status, startAt: record.startAt, endAt: record.endAt, cancellationToken, notifications: saved?.notifications, submission: mailer.submission(record.id), links: { contract: mailer.links.contract, pix: mailer.links.pix } });
    } catch (error) { next(error); }
  });
  app.get('/pre-reservations/:id/notification-form', (req, res) => {
    const record = ownedRecord(req);
    if (!record) return res.status(404).json({ message: 'Pré-reserva não encontrada.' });
    const submission = mailer.submission(record.id);
    if (!submission) return res.status(409).json({ message: 'Pré-reserva inativa ou configuração de envio indisponível.' });
    res.json({ submission });
  });
  app.get('/pre-reservations/:id/contract-form', (req, res) => {
    const record = ownedRecord(req);
    if (!record) return res.status(404).json({ message: 'Pré-reserva não encontrada.' });
    const submission = mailer.contractSubmission(record.id);
    if (!submission) return res.status(409).json({ message: 'A pré-reserva não está ativa.' });
    res.json({ submission });
  });
  app.delete('/admin/pre-reservations/:id', authorize, (req, res) => {
    if (!db.get('preReservations').find({ id: req.params.id }).value()) return res.status(404).json({ message: 'Pré-reserva não encontrada.' });
    db.get('preReservations').remove({ id: req.params.id }).write();
    res.status(204).end();
  });
  app.delete('/pre-reservations/:id', (req, res) => {
    const record = ownedRecord(req);
    if (!record) return res.status(404).json({ message: 'Pré-reserva ou código de cancelamento inválido.' });
    db.get('preReservations').remove({ id: record.id }).write();
    res.status(204).end();
  });
  app.get('/reservation-resources/pix', (_req, res) => {
    const escape = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
    const key = env.PIX_KEY || 'CHAVE_PIX_DEMONSTRACAO_NAO_EFETUAR_PAGAMENTO';
    res.type('html').send(`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pix — Família Tx</title><body style="font:1rem/1.8 system-ui;background:#eeece4;color:#293126;margin:0;padding:clamp(1rem,5vw,4rem)"><main style="max-width:42rem;margin:auto"><h1>Pagamento por Pix</h1><p>${env.PIX_KEY ? 'Confirme os dados do recebedor com nossa equipe antes de pagar.' : 'Página de demonstração. A chave abaixo não é válida. Não efetue pagamentos.'}</p><p>Chave Pix:</p><code style="display:block;overflow-wrap:anywhere;padding:1rem;background:#ffffff80;border-radius:1rem">${escape(key)}</code><p>Combine o pagamento com a equipe e envie o contrato assinado pelo link recebido no e-mail.</p></main></body></html>`);
  });
  app.get('/pre-reservations/mail-status', authorize, (_req, res) => res.json(mailer.diagnostics()));
  app.post('/pre-reservations/:id/retry-notifications', authorize, async (req, res, next) => {
    try {
      const record = db.get('preReservations').find({ id: req.params.id }).value();
      if (!record) return res.status(404).json({ message: 'Pré-reserva não encontrada.' });
      if (record.status !== 'pending_payment') return res.status(409).json({ message: 'A pré-reserva não está mais aguardando pagamento.' });
      await mailer.notify(record.id, { force: true });
      const notifications = db.get('preReservations').find({ id: record.id }).value()?.notifications;
      const submission = mailer.submission(record.id);
      res.status(submission ? 200 : 503).json({ id: record.id, notifications, submission });
    } catch (error) { next(error); }
  });
  app.get('/pre-reservations', authorize, (_req, res) => res.json(db.get('preReservations').value()));
  app.patch('/pre-reservations/:id/confirm-payment', authorize, (req, res) => {
    const record = db.get('preReservations').find({ id: req.params.id }).value();
    if (!record) return res.status(404).json({ message: 'Pré-reserva não encontrada.' });
    if (record.status === 'confirmed') return res.json({ id: record.id, status: record.status, paymentConfirmedAt: record.paymentConfirmedAt });
    if (record.status !== 'pending_payment') return res.status(409).json({ message: 'A pré-reserva não está aguardando pagamento.' });
    db.get('preReservations').find({ id: record.id }).assign({ status: 'confirmed', paymentConfirmedAt: new Date(clock()).toISOString() }).write();
    res.json({ id: record.id, status: 'confirmed' });
  });
  return {
    conflictsWithHold(start, end) { return db.get('preReservations').value().some(item => active(item) && overlap(start, end, Date.parse(item.startAt), Date.parse(item.endAt))); },
    localMillis(date, time) { return parseLocal(date, time).toMillis(); },
    dayStates(month) {
      const days = [];
      let day = DateTime.fromISO(`${month}-01T08:00`, { zone });
      const boundary = day.plus({ months: 1 });
      const records = db.get('preReservations').value().filter(item => active(item));
      while (day < boundary) {
        const end = day.plus({ hours: 24 });
        const reserved = records.some(item => overlap(day.toMillis(), end.toMillis(), Date.parse(item.startAt), Date.parse(item.endAt))) || db.get('reservations').value().some(item => overlap(day.toMillis(), end.toMillis(), parseLocal(item.date, item.start).toMillis(), parseLocal(item.date, item.end).toMillis()));
        days.push({ date: day.toISODate(), status: reserved ? 'reserved' : 'free' });
        day = day.plus({ days: 1 });
      }
      return days;
    },
    project(month) {
      const result = [];
      let day = DateTime.fromISO(`${month}-01`, { zone });
      const boundary = day.plus({ months: 1 });
      const records = db.get('preReservations').value().filter(item => active(item));
      while (day < boundary) {
        const next = day.plus({ days: 1 });
        for (const record of records) {
          const start = Math.max(day.toMillis(), Date.parse(record.startAt));
          const end = Math.min(next.toMillis(), Date.parse(record.endAt));
          if (start < end) result.push({ date: day.toISODate(), start: DateTime.fromMillis(start, { zone }).toFormat('HH:mm'), end: end === next.toMillis() ? '24:00' : DateTime.fromMillis(end, { zone }).toFormat('HH:mm'), status: record.status === 'confirmed' ? 'reserved' : 'pre_reserved' });
        }
        day = next;
      }
      return result;
    },
  };
}
module.exports = { registerPreReservations };
