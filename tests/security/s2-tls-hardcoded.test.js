// S2 Regression: TLS always validated, no override
// Caveman check: could a stranger disable our cert checking? If yes, don't ship.
//
// WHY: If rejectUnauthorized is configurable, someone WILL set it to false.
// This test verifies the transport gate hardcodes it.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const REPO_ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');

describe('S2 — TLS Hardcoded', () => {
  it('transport.js contains rejectUnauthorized: true', () => {
    const content = readFileSync(join(REPO_ROOT, 'lib/secure-transport.js'), 'utf-8');
    const matches = content.match(/rejectUnauthorized:\s*true/g);
    assert.ok(matches && matches.length >= 1,
      'lib/secure-transport.js must hardcode rejectUnauthorized: true');
  });

  it('transport.js never sets rejectUnauthorized to false', () => {
    const content = readFileSync(join(REPO_ROOT, 'lib/secure-transport.js'), 'utf-8');
    assert.ok(!content.includes('rejectUnauthorized: false'),
      'lib/secure-transport.js must NEVER set rejectUnauthorized: false');
  });

  it('transport.js checks for NODE_TLS_REJECT_UNAUTHORIZED=0 on startup', () => {
    const content = readFileSync(join(REPO_ROOT, 'lib/secure-transport.js'), 'utf-8');
    assert.ok(content.includes('NODE_TLS_REJECT_UNAUTHORIZED'),
      'lib/secure-transport.js must check for NODE_TLS_REJECT_UNAUTHORIZED override');
    assert.ok(content.includes('process.exit'),
      'lib/secure-transport.js must exit if TLS validation is globally disabled');
  });

  it('no file sets NODE_TLS_REJECT_UNAUTHORIZED=0', async () => {
    const { readdirSync, statSync } = await import('node:fs');

    function walk(dir, files = []) {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (entry === 'node_modules' || entry === '.git') continue;
        if (statSync(full).isDirectory()) walk(full, files);
        else if (full.endsWith('.js') || full.endsWith('.env.example') || full.endsWith('.sh'))
          files.push(full);
      }
      return files;
    }

    const files = walk(REPO_ROOT);
    const violations = [];

    for (const file of files) {
      const content = readFileSync(file, 'utf-8');
      if (/NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*['"]?0/.test(content)) {
        // Allow the check in transport.js itself
        const rel = relative(REPO_ROOT, file).replace(/\\/g, '/');
        if (rel !== 'lib/secure-transport.js' && !rel.startsWith('tests/')) {
          violations.push(rel);
        }
      }
    }

    assert.deepStrictEqual(violations, [],
      `Files setting NODE_TLS_REJECT_UNAUTHORIZED=0:\n${violations.join('\n')}`);
  });
});
