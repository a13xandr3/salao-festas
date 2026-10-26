#!/usr/bin/env node
'use strict';

// A classificação semântica é feita pelo agente; este helper só aplica a decisão.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' });
}

function run(level) {
  if (!['major', 'minor', 'patch', 'none'].includes(level)) {
    throw new Error('Uso: node scripts/version-staged.cjs <major|minor|patch|none>');
  }
  const root = git('rev-parse', '--show-toplevel').trim();
  process.chdir(root);
  if (git('ls-files', '--unmerged')) throw new Error('Resolva os conflitos antes de versionar.');
  if (!git('diff', '--cached', '--name-only')) throw new Error('Não há alterações staged.');
  const files = ['package.json', 'package-lock.json'];
  if (git('diff', '--name-only', '--', ...files)) {
    throw new Error('Os manifests têm alterações unstaged. Preserve-as e prepare o staged antes de continuar.');
  }
  const originals = files.map(file => git('show', `:${file}`));
  const staged = originals.map(source => JSON.parse(source));
  const base = files.map(file => JSON.parse(git('show', `HEAD:${file}`)));
  function validate(pair) {
    const version = pair[0].version;
    if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Este fluxo exige versão estável MAJOR.MINOR.PATCH.');
    if (pair[1].version !== version || pair[1].packages?.['']?.version !== version) {
      throw new Error('As versões dos manifests estão inconsistentes.');
    }
    return version;
  }
  const previous = validate(base);
  const current = validate(staged);
  const parts = previous.split('.').map(Number);
  if (level === 'major') { parts[0]++; parts[1] = 0; parts[2] = 0; }
  if (level === 'minor') { parts[1]++; parts[2] = 0; }
  if (level === 'patch') parts[2]++;
  const next = parts.join('.');
  if (current !== previous && current !== next) {
    throw new Error(`Versão staged ${current} diverge da base ${previous} e da decisão ${next}. Revise a intenção manual.`);
  }
  // Altera apenas campos de versão, preservando a formatação do staged.
  const outputs = originals.map((source, index) => {
    const replacements = new Map();
    const wanted = index === 0 ? ['version'] : ['version', 'packages..version'];
    function walk(cursor, parents) {
      const token = /\s*("(?:\\.|[^"\\])*"|[{}\[\]:,]|true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/y;
      function read() {
        token.lastIndex = cursor.pos;
        const match = token.exec(source);
        if (!match) throw new Error('JSON inválido.');
        cursor.pos = token.lastIndex;
        return { value: match[1], start: token.lastIndex - match[1].length, end: token.lastIndex };
      }
      const value = read();
      if (value.value === '{') {
        let key = read();
        if (key.value === '}') return;
        while (true) {
          const name = JSON.parse(key.value);
          if (read().value !== ':') throw new Error('JSON inválido.');
          walk(cursor, [...parents, name]);
          const separator = read().value;
          if (separator === '}') break;
          if (separator !== ',') throw new Error('JSON inválido.');
          key = read();
        }
      } else if (value.value === '[') {
        const peek = cursor.pos;
        if (read().value === ']') return;
        cursor.pos = peek;
        while (true) {
          walk(cursor, [...parents, '*']);
          const separator = read().value;
          if (separator === ']') break;
          if (separator !== ',') throw new Error('JSON inválido.');
        }
      } else if (wanted.includes(parents.join('.'))) {
        replacements.set(value.start, { end: value.end, text: JSON.stringify(next) });
      }
    }
    walk({ pos: 0 }, []);
    if (replacements.size !== wanted.length) throw new Error('Campos de versão não encontrados.');
    for (const [start, replacement] of [...replacements].sort((a, b) => b[0] - a[0])) {
      source = source.slice(0, start) + replacement.text + source.slice(replacement.end);
    }
    return source;
  });
  // Todas as validações precedem qualquer escrita.
  outputs.forEach((source, index) => fs.writeFileSync(path.join(root, files[index]), source));
  git('add', '--', ...files);
  console.log(`${level}: ${previous} -> ${next} (manifests sincronizados no staged)`);
}

try { run(process.argv[2]); }
catch (error) { console.error(error.message); process.exitCode = 1; }
