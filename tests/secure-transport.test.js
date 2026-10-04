// secure-transport.test.js — Behavioral tests for lib/secure-transport.js
// All three TLS branches covered.
// Spear works: getTlsOptions, createSecureAgent
// Bad spear: cannot override TLS, mutating return doesn't persist

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import { getTlsOptions, createSecureAgent, isTlsDisabled } from '../lib/secure-transport.js';
import { withEnv } from './helpers.js';

describe('getTlsOptions — TLS decision', () => {
  it('returns rejectUnauthorized: true', () => {
    const opts = getTlsOptions();
    assert.equal(opts.rejectUnauthorized, true);
  });

  it('returns a fresh object each call — mutating one does not affect the next', () => {
    const a = getTlsOptions();
    a.rejectUnauthorized = false; // adversarial mutation
    const b = getTlsOptions();
    assert.equal(b.rejectUnauthorized, true);
  });

  it('return object has only rejectUnauthorized', () => {
    const opts = getTlsOptions();
    assert.deepEqual(Object.keys(opts), ['rejectUnauthorized']);
  });
});

describe('createSecureAgent — HTTPS agent factory', () => {
  it('returns an https.Agent instance', () => {
    const agent = createSecureAgent();
    assert.ok(agent instanceof https.Agent);
  });

  it('agent has keepAlive enabled', () => {
    const agent = createSecureAgent();
    assert.equal(agent.keepAlive, true);
  });

  it('respects non-TLS options like maxSockets', () => {
    const agent = createSecureAgent({ maxSockets: 5 });
    assert.equal(agent.maxSockets, 5);
  });

  it('cannot override rejectUnauthorized via options — TLS always wins', () => {
    // This is the critical adversarial test.
    // Even if a caller passes rejectUnauthorized: false, the agent must enforce true.
    const adversarialOpts = { rejectUnauthorized: false }; // lgtm[js/disabling-certificate-pinning]
    const agent = createSecureAgent(adversarialOpts);
    assert.equal(agent.options.rejectUnauthorized, true);
  });

  it('default maxSockets is 25', () => {
    const agent = createSecureAgent();
    assert.equal(agent.maxSockets, 25);
  });
});

describe('isTlsDisabled — TLS bypass detection', () => {
  it('returns false when NODE_TLS_REJECT_UNAUTHORIZED is not set', () => {
    withEnv('NODE_TLS_REJECT_UNAUTHORIZED', undefined, () => {
      assert.equal(isTlsDisabled(), false);
    });
  });

  it('returns true when NODE_TLS_REJECT_UNAUTHORIZED is 0', () => {
    withEnv('NODE_TLS_REJECT_UNAUTHORIZED', '0', () => {
      assert.equal(isTlsDisabled(), true);
    });
  });

  it('returns false when NODE_TLS_REJECT_UNAUTHORIZED is 1', () => {
    withEnv('NODE_TLS_REJECT_UNAUTHORIZED', '1', () => {
      assert.equal(isTlsDisabled(), false);
    });
  });
});
