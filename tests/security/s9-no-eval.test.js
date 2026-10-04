// S9 Regression: No eval interpolation of user input
// Caveman check: could a stranger sneak fake code into our scripts? If yes, don't ship.
//
// WHY: Template literals inside exec/eval/spawn with user values = code injection.
// `node -e "send('${email}')"` with email = `'); require('child_process').exec('rm -rf /` = game over.
// Values go through process.argv or env vars. Never interpolated.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const REPO_ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');

// Patterns that indicate eval-context interpolation
const EVAL_PATTERNS = [
  // node -e with template literal or string concat
  /node\s+-e\s+[`"'].*\$\{/,
  // exec/execSync with template literal containing user-looking vars
  /exec(?:Sync)?\s*\(\s*`[^`]*\$\{(?!__dirname|__filename|REPO)/,
  // eval() with any variable
  /\beval\s*\(/,
  // new Function() with variable input
  /new\s+Function\s*\(/,
  // child_process.exec with template literal
  /\.exec\s*\(\s*`[^`]*\$\{/,
  // shell string interpolation in spawn args
  /spawn(?:Sync)?\s*\(\s*['"](?:bash|sh|cmd)['"]\s*,\s*\[\s*['"]-c['"]\s*,\s*`/,
];

const EXEMPT_FILES = [
  'tests/',              // Test files may demonstrate bad patterns
  'scripts/gmail-auth',  // Local-only OAuth helper — exec opens browser, not user input
];

function isExempt(rel) {
  return EXEMPT_FILES.some(e => rel.startsWith(e));
}

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (entry === 'node_modules' || entry === '.git') continue;
    if (statSync(full).isDirectory()) walk(full, files);
    else if (full.endsWith('.js') || full.endsWith('.mjs') || full.endsWith('.sh'))
      files.push(full);
  }
  return files;
}

describe('S9 — No Eval Context Interpolation', () => {
  it('no eval(), new Function(), or exec with interpolated user input', () => {
    const files = walk(REPO_ROOT);
    const violations = [];

    for (const file of files) {
      const rel = relative(REPO_ROOT, file).replace(/\\/g, '/');
      if (isExempt(rel)) continue;

      const content = readFileSync(file, 'utf-8');
      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        // Skip comments
        const trimmed = lines[i].trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('#')) continue;

        for (const pattern of EVAL_PATTERNS) {
          if (pattern.test(lines[i])) {
            violations.push(`${rel}:${i + 1} — ${trimmed.slice(0, 100)}`);
          }
        }
      }
    }

    assert.deepStrictEqual(violations, [],
      `Eval-context interpolation found:\n${violations.join('\n')}\n` +
      'User input must pass via process.argv or env vars, never eval (SECURITY.md S9, DR-5)');
  });
});
