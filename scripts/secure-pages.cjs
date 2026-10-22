// Hash the final, prerendered HTML: Angular 20 does not support autoCsp together with SSR.
const { readFileSync, writeFileSync, readdirSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { createHash } = require('node:crypto');
function securePages(root) {
  const config = JSON.parse(readFileSync(join(root, 'app-config.json'), 'utf8'));
  const origin = new URL(config.supabaseUrl).origin;
  function secure(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) { secure(path); continue; }
      if (!entry.name.endsWith('.html')) continue;
      let html = readFileSync(path, 'utf8').replace(/<meta\s+http-equiv="Content-Security-Policy"[^>]*>/gi, '');
      const hashes = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
        .filter(([, attributes]) => !/\bsrc\s*=/i.test(attributes))
        .map(([, , content]) => `'sha256-${createHash('sha256').update(content).digest('base64')}'`);
      const policy = [
        "default-src 'self'", `script-src 'self' ${[...new Set(hashes)].join(' ')}`,
        "style-src 'self' 'unsafe-inline'", "img-src 'self' data:", "font-src 'self'",
        `connect-src 'self' ${origin}`, "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-src 'none'",
      ].join('; ');
      html = html.replace(/<head>/i, `<head><meta http-equiv="Content-Security-Policy" content="${policy}">`);
      writeFileSync(path, html);
    }
  }
  secure(root);
}
module.exports = { securePages };
if (require.main === module) {
  securePages(resolve(__dirname, '../dist/fed-salao/browser'));
  console.log('CSP aplicada ao HTML final, com hashes dos scripts locais.');
}
