'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const script = path.resolve(__dirname, 'version-staged.cjs');
function fixture(t) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'version-staged-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' });
  const write = (file, value) => fs.writeFileSync(path.join(cwd, file), value);
  git('init', '-q');
  git('config', 'user.name', 'Version test');
  git('config', 'user.email', 'version@example.test');
  git('config', 'core.hooksPath', path.join(cwd, 'no-hooks'));
  write('package.json', '{"name":"fixture","version":"2.3.5"}\n');
  write('package-lock.json', JSON.stringify({ version: '2.3.5', packages: { '': { version: '2.3.5' }, dependency: { version: '9.0.0' } } }, null, 2) + '\n');
  git('add', '.'); git('commit', '-qm', 'base');
  write('app.txt', 'staged feature'); git('add', 'app.txt');
  return { cwd, git, write, run: level => spawnSync(process.execPath, [script, level], { cwd, encoding: 'utf8' }), read: file => JSON.parse(git('show', `:${file}`)) };
}
for (const [level, version] of [['patch', '2.3.6'], ['minor', '2.4.0'], ['major', '3.0.0'], ['none', '2.3.5']]) {
  test(`${level}: sincroniza manifests, preserva dependências e é idempotente`, t => {
    const f = fixture(t);
    for (let i = 0; i < 2; i++) {
      const result = f.run(level);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(f.read('package.json').version, version);
      assert.equal(f.read('package-lock.json').version, version);
      assert.equal(f.read('package-lock.json').packages[''].version, version);
      assert.equal(f.read('package-lock.json').packages.dependency.version, '9.0.0');
    }
    assert.equal(f.git('diff', '--', 'package.json', 'package-lock.json'), '');
  });
}
test('recusa manifesto parcialmente staged sem modificar índice ou arquivo', t => {
  const f = fixture(t);
  f.write('package.json', '{"name":"local","version":"2.3.5"}\n');
  const before = f.git('diff');
  const index = f.git('diff', '--cached');
  assert.notEqual(f.run('minor').status, 0);
  assert.equal(f.git('diff'), before);
  assert.equal(f.git('diff', '--cached'), index);
});
test('preserva outras alterações staged e unstaged', t => {
  const f = fixture(t);
  f.write('app.txt', 'local edit');
  assert.equal(f.run('patch').status, 0);
  assert.equal(f.git('show', ':app.txt'), 'staged feature');
  assert.equal(fs.readFileSync(path.join(f.cwd, 'app.txt'), 'utf8'), 'local edit');
});
test('recusa versão manual divergente e staged vazio', t => {
  const f = fixture(t);
  f.write('package.json', '{"name":"fixture","version":"8.0.0"}\n');
  f.git('add', 'package.json');
  assert.notEqual(f.run('minor').status, 0);
  f.git('reset', '--hard', 'HEAD');
  assert.notEqual(f.run('patch').status, 0);
});
