const { registerPreReservations } = require('./pre-reservations.cjs');
const { randomUUID } = require('node:crypto');
const defaults = { opensAt: '08:00', closesAt: '22:00', slotMinutes: 60 };
const minutes = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
const validTime = value => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
function settings(db) {
  const config = { ...defaults, ...db.get('bookingSettings').value() };
  if (!validTime(config.opensAt) || !validTime(config.closesAt) || minutes(config.opensAt) >= minutes(config.closesAt) || !Number.isInteger(config.slotMinutes) || config.slotMinutes < 15 || (minutes(config.closesAt) - minutes(config.opensAt)) % config.slotMinutes !== 0) throw new Error('Horários da agenda inválidos no db.json.');
  return config;
}
function registerReservations(app, db, authorize, options) {
  db.defaults({ reservations: [], bookingSettings: defaults }).write();
  const holds = registerPreReservations(app, db, authorize, options);
  app.get('/availability', (req, res, next) => {
    try {
      const month = req.query.month;
      if (typeof month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return res.status(400).json({ message: 'Informe o mês no formato AAAA-MM.' });
      db.read();
      res.json({ days: holds.dayStates(month), month, timeZone: 'America/Sao_Paulo', ...settings(db), reservations: [...db.get('reservations').filter(item => item.date.startsWith(`${month}-`)).value().map(({ date, start, end }) => ({ date, start, end })), ...holds.project(month)] });
    } catch (error) { next(error); }
  });
  app.get('/reservations', authorize, (_req, res) => { db.read(); res.json(db.get('reservations').value()); });
  function save(req, res, next) {
    try {
      db.read();
      const original = req.method === 'PATCH' ? db.get('reservations').find({ id: req.params.id }).value() : null;
      if (req.method === 'PATCH' && !original) return res.status(404).json({ message: 'Reserva não encontrada.' });
      const body = req.body;
      if (!body || typeof body !== 'object' || Array.isArray(body) || !Object.keys(body).length || Object.keys(body).some(key => !['date', 'start', 'end'].includes(key))) return res.status(400).json({ message: 'Informe apenas date, start e end.' });
      const candidate = { ...original, ...body };
      const config = settings(db);
      if (!validDate(candidate.date) || !validTime(candidate.start) || !validTime(candidate.end) || candidate.start >= candidate.end || minutes(candidate.start) < minutes(config.opensAt) || minutes(candidate.end) > minutes(config.closesAt) || (minutes(candidate.start) - minutes(config.opensAt)) % config.slotMinutes || (minutes(candidate.end) - minutes(config.opensAt)) % config.slotMinutes) return res.status(400).json({ message: 'Data ou horário inválido. Respeite os horários e intervalos configurados na agenda.' });
      const conflict = db.get('reservations').value().some(item => item.id !== original?.id && item.date === candidate.date && item.start < candidate.end && item.end > candidate.start);
      if (conflict || holds.conflictsWithHold(holds.localMillis(candidate.date, candidate.start), holds.localMillis(candidate.date, candidate.end))) return res.status(409).json({ message: 'Já existe uma reserva nesse intervalo.' });
      if (original) {
        const updated = { ...candidate, updatedAt: new Date().toISOString() };
        db.get('reservations').find({ id: original.id }).assign(updated).write();
        return res.json(updated);
      }
      const record = { id: randomUUID(), date: candidate.date, start: candidate.start, end: candidate.end, createdAt: new Date().toISOString() };
      db.get('reservations').push(record).write();
      res.status(201).json(record);
    } catch (error) { next(error); }
  }
  app.post('/reservations', authorize, save);
  app.patch('/reservations/:id', authorize, save);
  app.delete('/reservations/:id', authorize, (req, res) => {
    db.read();
    if (!db.get('reservations').find({ id: req.params.id }).value()) return res.status(404).json({ message: 'Reserva não encontrada.' });
    db.get('reservations').remove({ id: req.params.id }).write();
    res.status(204).end();
  });
}
module.exports = { registerReservations };
