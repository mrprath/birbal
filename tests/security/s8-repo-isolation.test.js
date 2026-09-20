// S8 Regression: Repo isolation — no paths outside repo root
// Caveman check: could our code reach outside its cage? If yes, don't ship.
//
// WHY: A skill that references /etc/passwd or ~/ssh/id_rsa escapes the sandbox.
// All paths must resolve within repo root. Absolute paths outside = violation.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const REPO_ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');

// Patterns that reference paths outside repo
const ESCAPE_PATTERNS = [
  // Unix absolute paths that aren't repo-relative
  /['"`]\/(?:etc|home|usr|var|tmp|root)\//,
  // Windows absolute paths outside repo
  /['"`][A-Z]:\\(?!Users\\owner\\OneDrive\\Desktop\\birbal)/i,
  // Home directory references
  /process\.env\.HOME/,
  /process\.env\.USERPROFILE(?!.*birbal)/,
  /os\.homedir\(\)/,
  // Parent directory traversal
  /\.\.\//g,
];

const EXEMPT_FILES = [
  'tests/',             // Tests may reference patterns
  'SECURITY.md',        // Docs
  'CLAUDE.md',          // Docs
  'lib/secure-write.js', // May use dirname internally
  'src/env.js',         // Resolves its own path
  'startup.js',         // DR-7: must check outside repo to detect conflicts
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

describe('S8 — Repo Isolation', () => {
  it('no JS files reference absolute paths outside the repo', () => {
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

        // Check for unix absolute paths
        if (/['"`]\/(?:etc|home|usr|var|tmp|root)\//.test(lines[i])) {
          violations.push(`${rel}:${i + 1} — absolute path escape: ${trimmed.slice(0, 80)}`);
        }
        // Check for os.homedir
        if (/os\.homedir\(\)/.test(lines[i])) {
          violations.push(`${rel}:${i + 1} — home directory reference: ${trimmed.slice(0, 80)}`);
        }
      }
    }

    assert.deepStrictEqual(violations, [],
      `Path escapes found:\n${violations.join('\n')}\n` +
      'All paths must be repo-relative (SECURITY.md S8, DR-7)');
  });
});
