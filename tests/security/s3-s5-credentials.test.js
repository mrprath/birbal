// S3 + S5 Regression: Credentials only in .env, .env always gitignored
// Caveman check: could a stranger read our secrets from the repo? If yes, don't ship.
//
// WHY: Credentials in source code get committed. Committed credentials get pushed.
// Pushed credentials are public forever (git history). .env in .gitignore is the last line.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const REPO_ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');

// Patterns that look like hardcoded credentials
const CREDENTIAL_PATTERNS = [
  /(?:api[_-]?key|apikey)\s*[:=]\s*['"][a-zA-Z0-9_\-]{20,}['"]/i,
  /(?:secret|password|passwd|token)\s*[:=]\s*['"][a-zA-Z0-9_\-]{8,}['"]/i,
  /ghp_[a-zA-Z0-9]{36}/,               // GitHub personal access token
  /sk-[a-zA-Z0-9]{32,}/,               // OpenAI-style key
  /ntn_[a-zA-Z0-9]{32,}/,              // Notion token
  /Bearer\s+[a-zA-Z0-9_\-\.]{20,}/,    // Bearer token in code
];

const EXEMPT_FILES = [
  '.env.example',       // Placeholder values are fine
  'tests/',             // Test files may reference patterns
  'SECURITY.md',        // Documentation may show examples
];

function isExempt(rel) {
  return EXEMPT_FILES.some(e => rel.startsWith(e) || rel === e);
}

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (entry === 'node_modules' || entry === '.git') continue;
    if (statSync(full).isDirectory()) walk(full, files);
    else files.push(full);
  }
  return files;
}

describe('S3 — No Credentials in Source', () => {
  it('no hardcoded credentials in JS files', () => {
    const files = walk(REPO_ROOT).filter(f =>
      (f.endsWith('.js') || f.endsWith('.mjs') || f.endsWith('.json')) &&
      !f.includes('package-lock') && !f.includes('node_modules')
    );
    const violations = [];

    for (const file of files) {
      const rel = relative(REPO_ROOT, file).replace(/\\/g, '/');
      if (isExempt(rel)) continue;

      const content = readFileSync(file, 'utf-8');
      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        for (const pattern of CREDENTIAL_PATTERNS) {
          if (pattern.test(lines[i])) {
            violations.push(`${rel}:${i + 1} — possible credential: ${lines[i].trim().slice(0, 80)}`);
          }
        }
      }
    }

    assert.deepStrictEqual(violations, [],
      `Possible hardcoded credentials found:\n${violations.join('\n')}\n` +
      'All credentials must live in .env (SECURITY.md S3, DR-2)');
  });
});

describe('S5 — .env in .gitignore', () => {
  it('.gitignore exists', () => {
    assert.ok(existsSync(join(REPO_ROOT, '.gitignore')),
      '.gitignore must exist at repo root');
  });

  it('.gitignore contains .env', () => {
    const content = readFileSync(join(REPO_ROOT, '.gitignore'), 'utf-8');
    const lines = content.split('\n').map(l => l.trim());
    assert.ok(
      lines.some(l => l === '.env' || l === '.env*' || l === '.env.*'),
      '.gitignore must contain a line that excludes .env files'
    );
  });
});
