// Secret scrubbing tests — S6 enforcement in request logging
// WHY: If scrubSecrets misses a pattern, credentials leak into logs.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { scrubSecrets } from '../../lib/request.js';

describe('scrubSecrets — S6 log scrubbing', () => {
  it('redacts Bearer tokens', () => {
    const scrubbed = scrubSecrets('Authorization: Bearer eyJhbGciOi...');
    assert.ok(!scrubbed.includes('eyJhbGciOi'));
    assert.ok(scrubbed.includes('[REDACTED]'));
  });

  it('redacts token= query params', () => {
    const scrubbed = scrubSecrets('GET /api?token=abc123secret&page=1');
    assert.ok(!scrubbed.includes('abc123secret'));
  });

  it('redacts key= query params', () => {
    const scrubbed = scrubSecrets('GET /api?key=sk-12345&format=json');
    assert.ok(!scrubbed.includes('sk-12345'));
  });

  it('redacts password= params', () => {
    const scrubbed = scrubSecrets('POST /login?password=hunter2');
    assert.ok(!scrubbed.includes('hunter2'));
  });

  it('redacts secret= params', () => {
    const scrubbed = scrubSecrets('secret=myClientSecret');
    assert.ok(!scrubbed.includes('myClientSecret'));
  });

  it('leaves clean strings untouched', () => {
    const clean = '[BIRBAL] GET /api/users → 200';
    assert.equal(scrubSecrets(clean), clean);
  });

  it('handles multiple secrets in one string', () => {
    const dirty = 'Bearer tok123 and token=abc and key=xyz';
    const scrubbed = scrubSecrets(dirty);
    assert.ok(!scrubbed.includes('tok123'));
    assert.ok(!scrubbed.includes('abc'));
    assert.ok(!scrubbed.includes('xyz'));
  });
});
