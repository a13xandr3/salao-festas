const { createReservationMailer } = require('./reservation-mailer.cjs');
function mailConfiguration(env = process.env) {
  return createReservationMailer(null, { env }).diagnostics();
}
module.exports = { mailConfiguration };
