// S7 Regression: No auto-update from remote
// Caveman check: could a stranger sneak in fake papers from the remote? If yes, don't ship.
//
// WHY: If GitHub is compromised, auto-pull brings malicious code into the trusted local.
// Local is truth. GitHub is a mirror. Push only, never pull.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const REPO_ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');

const PULL_PATTERNS = [
  /git\s+pull/,
  /git\s+fetch.*&&.*git\s+merge/,
  /git\s+fetch.*&&.*git\s+rebase/,
  /\.pull\s*\(/,            // nodegit or similar
  /auto.?update/i,
  /self.?update/i,
];

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (entry === 'node_modules' || entry === '.git') continue;
    if (statSync(full).isDirectory()) walk(full, files);
    else if (full.endsWith('.js') || full.endsWith('.sh') || full.endsWith('.ps1'))
      files.push(full);
  }
  return files;
}

describe('S7 — No Auto-Pull from Remote', () => {
  it('no script contains git pull or auto-update patterns', () => {
    const files = walk(REPO_ROOT);
    const violations = [];

    for (const file of files) {
      const rel = relative(REPO_ROOT, file).replace(/\\/g, '/');
      if (rel.startsWith('tests/')) continue;

      const content = readFileSync(file, 'utf-8');
      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('*')) continue;

        for (const pattern of PULL_PATTERNS) {
          if (pattern.test(lines[i])) {
            violations.push(`${rel}:${i + 1} — ${trimmed.slice(0, 80)}`);
          }
        }
      }
    }

    assert.deepStrictEqual(violations, [],
      `Auto-pull patterns found:\n${violations.join('\n')}\n` +
      'No auto-update from remote. Push only. (SECURITY.md S7, DR-3)');
  });
});
