// resilient-request.test.js — Behavioral tests for lib/resilient-request.js
// Spear works: scrubSecrets (covered in security/request-scrub.test.js)
// Bad spear: URL rejection, timeout/retry caps

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { secureRequest, scrubSecrets } from '../lib/resilient-request.js';
import { ValidationError } from '../lib/errors.js';

describe('secureRequest — bad spear: URL allowlist enforcement', () => {
  it('rejects URL not on allowlist', async () => {
    await assert.rejects(
      () => secureRequest('https://evil.com/steal'),
      (err) => {
        assert.ok(err instanceof ValidationError);
        assert.equal(err.code, 'VALIDATION_URL_BLOCKED');
        assert.ok(err.message.includes('not in allowed URLs'));
        return true;
      },
    );
  });

  it('rejects HTTP even if host is allowed', async () => {
    await assert.rejects(
      () => secureRequest('http://api.github.com/user'),
      (err) => {
        assert.ok(err instanceof ValidationError);
        assert.ok(err.message.includes('HTTPS'));
        return true;
      },
    );
  });

  it('rejects invalid URL', async () => {
    await assert.rejects(
      () => secureRequest('not-a-url'),
      (err) => {
        assert.ok(err instanceof ValidationError);
        return true;
      },
    );
  });

  it('rejects subdomain spoofing — api.github.com.evil.com', async () => {
    await assert.rejects(
      () => secureRequest('https://api.github.com.evil.com/repos'),
      (err) => {
        assert.ok(err instanceof ValidationError);
        return true;
      },
    );
  });
});

describe('scrubSecrets — already covered in request-scrub.test.js', () => {
  it('scrubSecrets is exported and callable', () => {
    assert.equal(typeof scrubSecrets, 'function');
    assert.equal(scrubSecrets('clean'), 'clean');
  });
});
