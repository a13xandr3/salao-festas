const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mailConfiguration } = require('./mail-configuration.cjs');
test('FormSubmit is configured without SMTP credentials', () => {
  const config = mailConfiguration({});
  assert.equal(config.configured, true); assert.equal(config.provider, 'formsubmit');
  assert.deepEqual(config.missing, []);
});
test('invalid destination or site is reported without exposing secrets', () => {
  const config = mailConfiguration({ RESERVATION_MANAGER_EMAIL: 'invalid', PUBLIC_SITE_URL: 'javascript:alert(1)', SMTP_PASS: 'private-value' });
  assert.equal(config.configured, false);
  assert.ok(config.missing.includes('PUBLIC_SITE_URL'));
  assert.ok(config.missing.includes('RESERVATION_MANAGER_EMAIL'));
  assert.equal(JSON.stringify(config).includes('private-value'), false);
});
