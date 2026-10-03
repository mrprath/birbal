// S10 Regression: Atomic secure writes for credential files
// Caveman check: could a stranger read our secrets while we're writing them? If yes, don't ship.
//
// WHY: A raw writeFileSync with default umask creates a world-readable file.
// If a token auto-refreshes at 3am, anyone on the machine can read it until
// the next permission fix. secureWriteFile() eliminates that window.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const REPO_ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');

const EXEMPT_FILES = [
  'lib/secure-write.js',  // The implementation itself
  'tests/',               // Tests
];

function isExempt(rel) {
  return EXEMPT_FILES.some(e => rel.startsWith(e) || rel === e);
}

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (entry === 'node_modules' || entry === '.git') continue;
    if (statSync(full).isDirectory()) walk(full, files);
    else if (full.endsWith('.js') || full.endsWith('.mjs'))
      files.push(full);
  }
  return files;
}

describe('S10 — No Raw Writes to Credential Files', () => {
  it('no file uses writeFileSync targeting .env or credential files', () => {
    const files = walk(REPO_ROOT);
    const violations = [];

    for (const file of files) {
      const rel = relative(REPO_ROOT, file).replace(/\\/g, '/');
      if (isExempt(rel)) continue;

      const content = readFileSync(file, 'utf-8');
      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;

        // writeFileSync with .env in nearby context
        if (/writeFileSync/.test(lines[i]) && !content.includes('secureWriteFile')) {
          // Check if this file writes to anything that looks like credentials
          const window = lines.slice(Math.max(0, i - 3), i + 4).join('\n');
          if (/\.env|credential|secret|token|\.key/i.test(window)) {
            violations.push(`${rel}:${i + 1} — raw writeFileSync near credential context`);
          }
        }
      }
    }

    assert.deepStrictEqual(violations, [],
      `Raw writes to credential files found:\n${violations.join('\n')}\n` +
      'Use secureWriteFile() for all credential writes (SECURITY.md S10, DR-8)');
  });

  it('secure-write.js uses mode 0o600', () => {
    const content = readFileSync(join(REPO_ROOT, 'lib/secure-write.js'), 'utf-8');
    assert.ok(content.includes('0o600'),
      'secure-write.js must enforce mode 0o600');
  });

  it('secure-write.js calls chmodSync after rename', () => {
    const content = readFileSync(join(REPO_ROOT, 'lib/secure-write.js'), 'utf-8');
    const renameIndex = content.indexOf('renameSync');
    const chmodIndex = content.indexOf('chmodSync');
    assert.ok(renameIndex > -1, 'secure-write.js must use renameSync');
    assert.ok(chmodIndex > -1, 'secure-write.js must use chmodSync');
    assert.ok(chmodIndex > renameIndex,
      'chmodSync must come AFTER renameSync (DR-8: belt AND suspenders)');
  });

  it('env.js imports secureWriteFile', () => {
    const content = readFileSync(join(REPO_ROOT, 'lib/env.js'), 'utf-8');
    assert.ok(content.includes('secureWriteFile'),
      'lib/env.js must use secureWriteFile, not raw fs writes');
  });
});
