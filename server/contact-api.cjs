const jsonServer = require('json-server');
const { randomUUID, timingSafeEqual } = require('node:crypto');
const { resolve } = require('node:path');
const { rateLimit } = require('express-rate-limit');
const { registerReservations } = require('./reservations.cjs');
const fields = ['name', 'phone', 'email', 'message'];
function validate(input, partial = false) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return 'Dados inválidos.';
  if (Object.keys(input).some(key => !fields.includes(key))) return 'Campo não permitido.';
  if (!partial && fields.some(key => typeof input[key] !== 'string' || !input[key].trim())) return 'Preencha todos os campos obrigatórios.';
  if (partial && !Object.keys(input).length) return 'Informe ao menos um campo.';
  for (const [key, value] of Object.entries(input)) {
    if (typeof value !== 'string' || !value.trim()) return 'Preencha todos os campos obrigatórios.';
    if (key === 'name' && (value.trim().length < 2 || value.length > 120)) return 'Nome deve ter entre 2 e 120 caracteres.';
    if (key === 'phone' && (!/^[+()\d\s.-]+$/.test(value) || value.replace(/\D/g, '').length < 10 || value.replace(/\D/g, '').length > 15 || value.length > 30)) return 'Telefone inválido.';
    if (key === 'email' && (value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))) return 'E-mail inválido.';
    if (key === 'message' && value.length > 2000) return 'A mensagem deve ter no máximo 2000 caracteres.';
  }
  return null;
}

function createContactApi({ database = resolve(__dirname, '../db.json'), env = process.env, rateLimitEnabled = true, clock = Date.now } = {}) {
  const app = jsonServer.create();
  const router = jsonServer.router(database);
  const db = router.db;
  app.disable('x-powered-by');
  app.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.use(jsonServer.bodyParser);
  if (rateLimitEnabled) app.post('/contacts', rateLimit({
    windowMs: 15 * 60 * 1000, limit: 5, standardHeaders: 'draft-7', legacyHeaders: false,
    message: { message: 'Muitas mensagens em pouco tempo. Tente novamente mais tarde.' },
  }));

  const authorize = (req, res, next) => {
    const expected = env.CONTACTS_ADMIN_TOKEN;
    const actual = req.get('Authorization')?.replace(/^Bearer /, '') || '';
    if (!expected || Buffer.byteLength(actual) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(actual), Buffer.from(expected))) {
      return res.status(401).json({ message: 'Acesso restrito.' });
    }
    next();
  };
  registerReservations(app, db, authorize, { clock, rateLimitEnabled, env });
  // Availability is public; contact reports and reservation changes remain private.
  app.use((req, res, next) => {
    if (req.method === 'POST' && req.path === '/contacts') return next();
    return authorize(req, res, next);
  });

  app.post('/contacts', async (req, res, next) => {
    try {
      const error = validate(req.body);
      if (error) return res.status(400).json({ message: error });
      const contact = { id: randomUUID(), ...Object.fromEntries(fields.map(key => [key, req.body[key].trim()])), createdAt: new Date().toISOString(), emailProvider: 'formsubmit', emailStatus: 'not_tracked' };
      db.get('contacts').push(contact).write();
      return res.status(201).json({ id: contact.id });
    } catch (error) { next(error); }
  });

  app.use((req, res, next) => {
    if (!/^\/contacts(?:\/[^/]+)?\/?$/.test(req.path)) return res.status(404).json({ message: 'Recurso não encontrado.' });
    if (!['GET', 'HEAD', 'PATCH', 'DELETE'].includes(req.method) || (['PATCH', 'DELETE'].includes(req.method) && req.path === '/contacts')) return res.status(405).json({ message: 'Método não permitido.' });
    if (req.method === 'PATCH') {
      const error = validate(req.body, true);
      if (error) return res.status(400).json({ message: error });
      req.body = Object.fromEntries(Object.entries(req.body).map(([key, value]) => [key, value.trim()]));
      req.body.updatedAt = new Date().toISOString();
    }
    next();
  });
  app.use(router);
  app.use((error, _req, res, _next) => {
    const status = error.status === 400 ? 400 : 500;
    res.status(status).json({ message: status === 400 ? 'Dados inválidos.' : 'Não foi possível registrar a mensagem. Tente novamente.' });
  });
  return app;
}
module.exports = { createContactApi };
