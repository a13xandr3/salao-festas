/** Testa a política de segurança adicionada aos arquivos estáticos do build. */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
const { securePages } = require('../../../scripts/secure-pages.cjs');

describe('GitHub Pages CSP', () => {
  it('hashes final prerender and Pix scripts, preserves external bundles and can run twice', () => {
    const root = mkdtempSync(join(tmpdir(), 'espaco-tx-csp-'));
    try {
      mkdirSync(join(root, 'nested'));
      writeFileSync(join(root, 'app-config.json'), JSON.stringify({ supabaseUrl: 'https://example.supabase.co' }));
      const content = "window.test = 'final prerendered content';";
      const html = `<html><head><meta http-equiv="Content-Security-Policy" content="obsolete"></head><body><script src="main.js"></script><script>${content}</script></body></html>`;
      writeFileSync(join(root, 'index.html'), html);
      writeFileSync(join(root, 'nested/pix.html'), html);
      writeFileSync(join(root, 'nested/untouched.txt'), 'unchanged');
      securePages(root); securePages(root);
      const expectedHash = createHash('sha256').update(content).digest('base64');
      for (const path of ['index.html', 'nested/pix.html']) {
        const secured = readFileSync(join(root, path), 'utf8');
        expect(secured.match(/http-equiv="Content-Security-Policy"/g)).toHaveLength(1);
        expect(secured).toContain(`script-src 'self' 'sha256-${expectedHash}'`);
        expect(secured).toContain("connect-src 'self' https://example.supabase.co");
        expect(secured).toContain("object-src 'none'"); expect(secured).toContain("base-uri 'self'");
        expect(secured).toContain(`<script>${content}</script>`); expect(secured).toContain('<script src="main.js">');
        expect(secured).not.toContain("'unsafe-eval'"); expect(secured).not.toContain('obsolete');
      }
      expect(readFileSync(join(root, 'nested/untouched.txt'), 'utf8')).toBe('unchanged');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
