// S1 Regression: All HTTP through createSecureAgent()
// Caveman check: could a stranger sneak in a direct HTTP call? If yes, don't ship.
//
// WHY this test exists: A single raw fetch() or axios.get() bypasses TLS validation,
// timeouts, retries, and logging. This test scans every JS file outside lib/transport.js
// for direct HTTP imports. If it finds one, someone bypassed the gate.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const REPO_ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');

const BANNED_PATTERNS = [
  /\bimport\b.*\bfrom\s+['"](?:node:)?https?['"]/,
  /\brequire\s*\(\s*['"](?:node:)?https?['"]\s*\)/,
  /\bimport\b.*\bfrom\s+['"]node-fetch['"]/,
  /\brequire\s*\(\s*['"]node-fetch['"]\s*\)/,
  /\bimport\b.*\bfrom\s+['"]axios['"]/,
  /\brequire\s*\(\s*['"]axios['"]\s*\)/,
  /\bimport\b.*\bfrom\s+['"]got['"]/,
  /\brequire\s*\(\s*['"]got['"]\s*\)/,
  /\bimport\b.*\bfrom\s+['"]undici['"]/,
  /\brequire\s*\(\s*['"]undici['"]\s*\)/,
];

// Reads [S1] section from .security-exemptions if present (local), otherwise uses defaults.
// WHY defaults exist: CI clones don't have the exemptions file (it's gitignored).
const EXEMPTIONS_PATH = join(REPO_ROOT, '.security-exemptions');
const DEFAULT_ALLOWED = [
  'lib/secure-transport.js',
  'lib/resilient-request.js',
  'lib/token-validator.js',
  'lib/transcribe.js',
  'scripts/gmail-auth.mjs',
];

function parseSection(text, section) {
  let inSection = false;
  const entries = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (/^\[.+\]$/.test(trimmed)) {
      inSection = trimmed === `[${section}]`;
      continue;
    }
    if (inSection) {
      const entry = trimmed.replace(/#.*/, '').trim();
      if (entry) entries.push(entry);
    }
  }
  return entries;
}

let ALLOWED_FILES;
try {
  const raw = readFileSync(EXEMPTIONS_PATH, 'utf-8');
  const parsed = parseSection(raw, 'S1');
  ALLOWED_FILES = parsed.length > 0 ? parsed : DEFAULT_ALLOWED;
} catch {
  ALLOWED_FILES = DEFAULT_ALLOWED;
}

function walkJs(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (entry === 'node_modules' || entry === '.git') continue;
    if (statSync(full).isDirectory()) {
      walkJs(full, files);
    } else if (full.endsWith('.js') || full.endsWith('.mjs')) {
      files.push(full);
    }
  }
  return files;
}

describe('S1 — Transport Gate Enforcement', () => {
  it('no JS file outside lib/transport.js imports HTTP modules directly', () => {
    const files = walkJs(REPO_ROOT);
    const violations = [];

    for (const file of files) {
      const rel = relative(REPO_ROOT, file).replace(/\\/g, '/');
      if (ALLOWED_FILES.includes(rel)) continue;
      // Tests are not production code — they may import anything for verification
      if (rel.startsWith('tests/')) continue;

      const content = readFileSync(file, 'utf-8');
      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        for (const pattern of BANNED_PATTERNS) {
          if (pattern.test(lines[i])) {
            violations.push(`${rel}:${i + 1} — ${lines[i].trim()}`);
          }
        }
      }
    }

    assert.deepStrictEqual(
      violations, [],
      `Direct HTTP imports found outside transport gate:\n${violations.join('\n')}\n` +
      `All HTTP must go through lib/transport.js (SECURITY.md S1, DR-4)`
    );
  });
});
