// Token Guard tests — gate logic, JWT expiry heuristics, liveness probe
// WHY: The guard is the single path to every credential.
// If it fails open, credentials leak. If it fails closed on valid tokens, nothing works.

import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  TOKEN_KEY_MAP, readToken, jwtExp, secsLeft, httpStatus,
  TokenGuard, _authPrompt,
  checkGitHubToken, checkNotionToken, checkGraphToken, checkTypeSafeToken,
  githubGuard, notionGuard, graphGuard, typesafeGuard,
} from '../../lib/token-guard.js';

// Helper: create a fake JWT with a given exp claim
function fakeJwt(payload = {}) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = 'fakesig';
  return `${header}.${body}.${sig}`;
}

describe('TOKEN_KEY_MAP', () => {
  it('maps friendly names to .env keys', () => {
    assert.equal(TOKEN_KEY_MAP['github-token'], 'GITHUB_TOKEN');
    assert.equal(TOKEN_KEY_MAP['notion-api-key'], 'NOTION_API_KEY');
    assert.equal(TOKEN_KEY_MAP['graph-access-token'], 'GRAPH_ACCESS_TOKEN');
  });

  it('every value is a valid env key format', () => {
    for (const [name, key] of Object.entries(TOKEN_KEY_MAP)) {
      assert.ok(/^[A-Z_][A-Z0-9_]*$/.test(key),
        `${name} → ${key} is not a valid env key format`);
    }
  });
});

describe('readToken — gate logic', () => {
  it('rejects unknown friendly name', () => {
    const r = readToken('nonexistent-token');
    assert.ok(!r.ok);
    assert.ok(r.error.includes('Unknown token'));
    assert.ok(r.error.includes('Valid names'));
  });

  it('rejects when .env key is not set', () => {
    // Ensure the key is not set
    const saved = process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_TOKEN;

    const r = readToken('github-token');
    assert.ok(!r.ok);
    assert.ok(r.error.includes('not set'));
    assert.ok(r.error.includes('GITHUB_TOKEN'));

    // Restore
    if (saved !== undefined) process.env.GITHUB_TOKEN = saved;
  });

  it('rejects when .env key is empty string', () => {
    const saved = process.env.GITHUB_TOKEN;
    process.env.GITHUB_TOKEN = '';

    const r = readToken('github-token');
    assert.ok(!r.ok);
    assert.ok(r.error.includes('not set'));

    if (saved !== undefined) process.env.GITHUB_TOKEN = saved;
    else delete process.env.GITHUB_TOKEN;
  });

  it('rejects when .env key is whitespace only', () => {
    const saved = process.env.GITHUB_TOKEN;
    process.env.GITHUB_TOKEN = '   ';

    const r = readToken('github-token');
    assert.ok(!r.ok);

    if (saved !== undefined) process.env.GITHUB_TOKEN = saved;
    else delete process.env.GITHUB_TOKEN;
  });

  it('returns value when key is set and valid', () => {
    const saved = process.env.GITHUB_TOKEN;
    process.env.GITHUB_TOKEN = 'ghp_test123';

    const r = readToken('github-token');
    assert.ok(r.ok);
    assert.equal(r.value, 'ghp_test123');
    assert.equal(r.error, null);

    if (saved !== undefined) process.env.GITHUB_TOKEN = saved;
    else delete process.env.GITHUB_TOKEN;
  });

  it('rejects expired JWT token', () => {
    const saved = process.env.GRAPH_ACCESS_TOKEN;
    // Expired 1 hour ago
    const expired = fakeJwt({ exp: Math.floor(Date.now() / 1000) - 3600 });
    process.env.GRAPH_ACCESS_TOKEN = expired;

    const r = readToken('graph-access-token');
    assert.ok(!r.ok);
    assert.ok(r.error.includes('expired'));
    assert.ok(r.error.includes('Refresh'));

    if (saved !== undefined) process.env.GRAPH_ACCESS_TOKEN = saved;
    else delete process.env.GRAPH_ACCESS_TOKEN;
  });

  it('passes valid (not expired) JWT token', () => {
    const saved = process.env.GRAPH_ACCESS_TOKEN;
    // Expires 1 hour from now
    const valid = fakeJwt({ exp: Math.floor(Date.now() / 1000) + 3600 });
    process.env.GRAPH_ACCESS_TOKEN = valid;

    const r = readToken('graph-access-token');
    assert.ok(r.ok);
    assert.equal(r.value, valid);

    if (saved !== undefined) process.env.GRAPH_ACCESS_TOKEN = saved;
    else delete process.env.GRAPH_ACCESS_TOKEN;
  });

  it('passes non-JWT tokens without expiry check', () => {
    const saved = process.env.GITHUB_TOKEN;
    process.env.GITHUB_TOKEN = 'ghp_notajwt';

    const r = readToken('github-token');
    assert.ok(r.ok); // Non-JWT, no exp check, just passes

    if (saved !== undefined) process.env.GITHUB_TOKEN = saved;
    else delete process.env.GITHUB_TOKEN;
  });
});

describe('jwtExp — JWT expiry extraction', () => {
  it('extracts exp from valid JWT', () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = fakeJwt({ exp, sub: 'user123' });
    assert.equal(jwtExp(token), exp);
  });

  it('returns null for non-JWT string', () => {
    assert.equal(jwtExp('ghp_notajwt'), null);
    assert.equal(jwtExp('just-a-regular-token'), null);
  });

  it('returns null for JWT without exp claim', () => {
    const token = fakeJwt({ sub: 'user123' });
    assert.equal(jwtExp(token), null);
  });

  it('returns null for malformed base64', () => {
    assert.equal(jwtExp('a.!!!invalid!!!.c'), null);
  });
});

describe('secsLeft — time remaining', () => {
  it('returns positive for future timestamp', () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    const left = secsLeft(future);
    assert.ok(left > 3500 && left <= 3600);
  });

  it('returns negative for past timestamp', () => {
    const past = Math.floor(Date.now() / 1000) - 100;
    const left = secsLeft(past);
    assert.ok(left < 0);
  });

  it('returns ~0 for current timestamp', () => {
    const now = Math.floor(Date.now() / 1000);
    const left = secsLeft(now);
    assert.ok(left >= -1 && left <= 1);
  });
});

describe('httpStatus — liveness probe', () => {
  it('returns 0 for invalid URL', async () => {
    assert.equal(await httpStatus('not-a-url'), 0);
  });

  it('returns 0 for empty string', async () => {
    assert.equal(await httpStatus(''), 0);
  });

  it('returns 0 for HTTP (non-HTTPS)', async () => {
    // WHY: probe respects DR-1 — no plaintext HTTP, even for liveness
    assert.equal(await httpStatus('http://example.com'), 0);
  });

  it('returns 0 for unreachable host', async () => {
    // 192.0.2.1 is TEST-NET — guaranteed unreachable, will timeout or error
    const status = await httpStatus('https://192.0.2.1/');
    assert.equal(status, 0);
  });

  it('never throws — always resolves', async () => {
    // The contract: httpStatus ALWAYS resolves. No try/catch needed upstream.
    // Throw every bad input we can think of at it.
    const results = await Promise.all([
      httpStatus(null),
      httpStatus(undefined),
      httpStatus(42),
      httpStatus(''),
      httpStatus('ftp://nope.com'),
      httpStatus('https://[::ffff:192.0.2.1]/'),
    ]);
    // All should be 0, none should have thrown
    for (const r of results) {
      assert.equal(typeof r, 'number');
      assert.equal(r, 0);
    }
  });
});

// --- TokenGuard class tests ---

// Helper to save/restore an env var around a test
function withEnv(key, value, fn) {
  const saved = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  try {
    return fn();
  } finally {
    if (saved !== undefined) process.env[key] = saved;
    else delete process.env[key];
  }
}

// Same helper but async
async function withEnvAsync(key, value, fn) {
  const saved = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  try {
    return await fn();
  } finally {
    if (saved !== undefined) process.env[key] = saved;
    else delete process.env[key];
  }
}

describe('TokenGuard.check() — validate with caching', () => {
  it('returns ok:true when token is set and valid', () => {
    withEnv('GITHUB_TOKEN', 'ghp_testvalue', () => {
      const guard = new TokenGuard('github-token');
      const r = guard.check();
      assert.ok(r.ok);
      assert.equal(r.value, 'ghp_testvalue');
    });
  });

  it('returns ok:false when token is missing', () => {
    withEnv('GITHUB_TOKEN', undefined, () => {
      const guard = new TokenGuard('github-token');
      const r = guard.check();
      assert.ok(!r.ok);
      assert.ok(r.error.includes('not set'));
    });
  });

  it('caches valid result — second call returns same object without re-read', () => {
    withEnv('GITHUB_TOKEN', 'ghp_cached', () => {
      const guard = new TokenGuard('github-token');
      const r1 = guard.check();
      const r2 = guard.check();
      // Same object reference = served from cache
      assert.equal(r1, r2);
    });
  });

  it('caches invalid result for short TTL', () => {
    withEnv('GITHUB_TOKEN', undefined, () => {
      const guard = new TokenGuard('github-token');
      const r1 = guard.check();
      assert.ok(!r1.ok);
      // Still cached — same object
      const r2 = guard.check();
      assert.equal(r1, r2);
    });
  });

  it('picks up token refresh after invalid cache expires', async () => {
    // This test verifies the 10s short TTL concept.
    // We can't wait 10s in a test, so we poke the internals to simulate expiry.
    const guard = new TokenGuard('github-token');

    await withEnvAsync('GITHUB_TOKEN', undefined, async () => {
      const r1 = guard.check();
      assert.ok(!r1.ok);

      // Simulate cache expiry by backdating _cachedAt
      guard._cachedAt = Date.now() - 11_000;
    });

    // Now "refresh" the token
    await withEnvAsync('GITHUB_TOKEN', 'ghp_refreshed', async () => {
      const r2 = guard.check();
      assert.ok(r2.ok);
      assert.equal(r2.value, 'ghp_refreshed');
    });
  });
});

describe('TokenGuard.invalidate() — nuke the cache', () => {
  it('forces next check() to re-validate', () => {
    const guard = new TokenGuard('github-token');

    withEnv('GITHUB_TOKEN', 'ghp_original', () => {
      const r1 = guard.check();
      assert.ok(r1.ok);

      guard.invalidate();

      // Cache is nuked — next check re-reads
      const r2 = guard.check();
      assert.ok(r2.ok);
      // Different object = fresh read, not cached
      assert.notEqual(r1, r2);
    });
  });

  it('picks up new value after invalidate', () => {
    const guard = new TokenGuard('github-token');

    withEnv('GITHUB_TOKEN', 'ghp_old', () => {
      guard.check();
    });

    guard.invalidate();

    withEnv('GITHUB_TOKEN', 'ghp_new', () => {
      const r = guard.check();
      assert.equal(r.value, 'ghp_new');
    });
  });
});

describe('TokenGuard.wrap() — the magic wrapper', () => {
  it('runs handler when token is valid', async () => {
    await withEnvAsync('GITHUB_TOKEN', 'ghp_valid', async () => {
      const guard = new TokenGuard('github-token');
      const result = await guard.wrap(async (token) => {
        assert.equal(token, 'ghp_valid');
        return { data: 'success' };
      });
      assert.deepStrictEqual(result, { data: 'success' });
    });
  });

  it('returns _authPrompt and NEVER runs handler when token is missing', async () => {
    await withEnvAsync('GITHUB_TOKEN', undefined, async () => {
      const guard = new TokenGuard('github-token');
      let handlerCalled = false;

      const result = await guard.wrap(async () => {
        handlerCalled = true;
      });

      // Handler was NEVER called
      assert.ok(!handlerCalled, 'handler must NEVER run when auth fails');

      // Got _authPrompt contract
      assert.equal(result.action_required, 'auth_choice');
      assert.equal(result.service, 'GitHub');
      assert.ok(result.message.includes('GitHub'));
      assert.ok(Array.isArray(result.choices));
      assert.ok(result.choices.includes('refresh'));
      assert.ok(result.choices.includes('skip'));
      assert.ok(result.refresh_steps.includes('GITHUB_TOKEN'));
    });
  });

  it('catches mid-call 401, invalidates cache, returns _authPrompt', async () => {
    await withEnvAsync('GITHUB_TOKEN', 'ghp_willexpire', async () => {
      const guard = new TokenGuard('github-token');

      const result = await guard.wrap(async () => {
        const err = new Error('Unauthorized');
        err.status = 401;
        throw err;
      });

      // Got _authPrompt, not a thrown error
      assert.equal(result.action_required, 'auth_choice');
      assert.ok(result.message.includes('Auth failed mid-call'));

      // Cache was nuked — next check() re-validates
      assert.equal(guard._cache, null);
    });
  });

  it('catches 403 as auth error', async () => {
    await withEnvAsync('GITHUB_TOKEN', 'ghp_forbidden', async () => {
      const guard = new TokenGuard('github-token');

      const result = await guard.wrap(async () => {
        const err = new Error('Forbidden');
        err.status = 403;
        throw err;
      });

      assert.equal(result.action_required, 'auth_choice');
    });
  });

  it('catches message-based auth errors (e.g. "token expired")', async () => {
    await withEnvAsync('GITHUB_TOKEN', 'ghp_msgbased', async () => {
      const guard = new TokenGuard('github-token');

      const result = await guard.wrap(async () => {
        throw new Error('The token expired, please refresh');
      });

      assert.equal(result.action_required, 'auth_choice');
    });
  });

  it('rethrows non-auth errors — not the guard\'s job', async () => {
    await withEnvAsync('GITHUB_TOKEN', 'ghp_valid', async () => {
      const guard = new TokenGuard('github-token');

      await assert.rejects(
        () => guard.wrap(async () => {
          throw new Error('500 Internal Server Error');
        }),
        (err) => {
          assert.ok(err.message.includes('500'));
          return true;
        }
      );
    });
  });

  it('rethrows network errors — not the guard\'s job', async () => {
    await withEnvAsync('GITHUB_TOKEN', 'ghp_valid', async () => {
      const guard = new TokenGuard('github-token');

      await assert.rejects(
        () => guard.wrap(async () => {
          throw new Error('ECONNREFUSED');
        }),
        (err) => {
          assert.ok(err.message.includes('ECONNREFUSED'));
          return true;
        }
      );
    });
  });

  it('handler receives the actual token value (S6: via argument, not global)', async () => {
    await withEnvAsync('NOTION_API_KEY', 'ntn_secretvalue', async () => {
      const guard = new TokenGuard('notion-api-key');

      await guard.wrap(async (token) => {
        // The token is passed as an argument — not read from a global
        assert.equal(token, 'ntn_secretvalue');
        return 'ok';
      });
    });
  });
});

describe('_authPrompt — contract shape', () => {
  it('has all required fields', () => {
    const prompt = _authPrompt('github-token', 'token is missing');
    assert.equal(prompt.action_required, 'auth_choice');
    assert.equal(prompt.service, 'GitHub');
    assert.ok(prompt.message.includes('GitHub'));
    assert.ok(prompt.message.includes('token is missing'));
    assert.deepStrictEqual(prompt.choices, ['refresh', 'skip']);
    assert.ok(prompt.refresh_steps.length > 0);
  });

  it('maps each service to correct display name', () => {
    assert.equal(_authPrompt('github-token', 'x').service, 'GitHub');
    assert.equal(_authPrompt('notion-api-key', 'x').service, 'Notion');
    assert.equal(_authPrompt('graph-access-token', 'x').service, 'Microsoft Graph');
    assert.equal(_authPrompt('typesafe-api-key', 'x').service, 'TypeSafe');
    assert.equal(_authPrompt('substack-email', 'x').service, 'Substack');
  });

  it('includes service-specific refresh steps', () => {
    const gh = _authPrompt('github-token', 'x');
    assert.ok(gh.refresh_steps.includes('github.com/settings/tokens'));

    const notion = _authPrompt('notion-api-key', 'x');
    assert.ok(notion.refresh_steps.includes('notion.so'));

    const graph = _authPrompt('graph-access-token', 'x');
    assert.ok(graph.refresh_steps.includes('GRAPH_ACCESS_TOKEN'));

    const ts = _authPrompt('typesafe-api-key', 'x');
    assert.ok(ts.refresh_steps.includes('typesafe.ai'));
  });

  it('action_required is always "auth_choice" — machine-readable sentinel', () => {
    // This is the field the AI checks to know it MUST surface the prompt
    const p1 = _authPrompt('github-token', 'expired');
    const p2 = _authPrompt('notion-api-key', 'missing');
    const p3 = _authPrompt('graph-access-token', '401 mid-call');
    assert.equal(p1.action_required, 'auth_choice');
    assert.equal(p2.action_required, 'auth_choice');
    assert.equal(p3.action_required, 'auth_choice');
  });

  it('handles unknown token gracefully', () => {
    const prompt = _authPrompt('nonexistent', 'not in map');
    assert.equal(prompt.action_required, 'auth_choice');
    assert.equal(prompt.service, 'nonexistent');
    assert.ok(prompt.refresh_steps.includes('UNKNOWN_KEY'));
  });
});

describe('Per-service checkers — checkXToken()', () => {
  // All checkers return { valid, service, message, fix }

  it('checkGraphToken — offline: returns invalid for expired JWT', async () => {
    await withEnvAsync('GRAPH_ACCESS_TOKEN', fakeJwt({ exp: Math.floor(Date.now() / 1000) - 100 }), async () => {
      const r = await checkGraphToken();
      assert.ok(!r.valid);
      assert.equal(r.service, 'Microsoft Graph');
      assert.ok(r.message.includes('expired'));
      assert.ok(r.fix.includes('GRAPH_ACCESS_TOKEN'));
    });
  });

  it('checkGraphToken — offline: returns valid for good JWT', async () => {
    await withEnvAsync('GRAPH_ACCESS_TOKEN', fakeJwt({ exp: Math.floor(Date.now() / 1000) + 3600 }), async () => {
      const r = await checkGraphToken();
      assert.ok(r.valid);
      assert.equal(r.service, 'Microsoft Graph');
      assert.ok(r.message.includes('valid'));
      assert.ok(r.message.includes('remaining'));
    });
  });

  it('checkGraphToken — offline: returns invalid when missing', async () => {
    await withEnvAsync('GRAPH_ACCESS_TOKEN', undefined, async () => {
      const r = await checkGraphToken();
      assert.ok(!r.valid);
      assert.ok(r.message.includes('not set'));
    });
  });

  it('checkGitHubToken — returns invalid when missing', async () => {
    await withEnvAsync('GITHUB_TOKEN', undefined, async () => {
      const r = await checkGitHubToken();
      assert.ok(!r.valid);
      assert.equal(r.service, 'GitHub');
      assert.ok(r.fix.includes('github.com'));
    });
  });

  it('checkNotionToken — returns invalid when missing', async () => {
    await withEnvAsync('NOTION_API_KEY', undefined, async () => {
      const r = await checkNotionToken();
      assert.ok(!r.valid);
      assert.equal(r.service, 'Notion');
    });
  });

  it('checkTypeSafeToken — returns invalid when missing', async () => {
    await withEnvAsync('TYPESAFE_API_KEY', undefined, async () => {
      const r = await checkTypeSafeToken();
      assert.ok(!r.valid);
      assert.equal(r.service, 'TypeSafe');
    });
  });

  it('all checkers return { valid, service, message, fix } shape', async () => {
    // Set all tokens so we test the shape, not the validity
    const saved = {};
    for (const [name, key] of Object.entries(TOKEN_KEY_MAP)) {
      saved[key] = process.env[key];
      process.env[key] = 'test_value';
    }

    const checks = [checkGitHubToken, checkNotionToken, checkGraphToken, checkTypeSafeToken];
    for (const check of checks) {
      const r = await check();
      assert.ok('valid' in r, `${check.name} missing 'valid'`);
      assert.ok('service' in r, `${check.name} missing 'service'`);
      assert.ok('message' in r, `${check.name} missing 'message'`);
      assert.ok('fix' in r, `${check.name} missing 'fix'`);
    }

    // Restore
    for (const [key, val] of Object.entries(saved)) {
      if (val !== undefined) process.env[key] = val;
      else delete process.env[key];
    }
  });
});

describe('Pre-built guards — singleton instances', () => {
  it('githubGuard is a TokenGuard for github-token', () => {
    assert.ok(githubGuard instanceof TokenGuard);
    assert.equal(githubGuard.tokenName, 'github-token');
  });

  it('notionGuard is a TokenGuard for notion-api-key', () => {
    assert.ok(notionGuard instanceof TokenGuard);
    assert.equal(notionGuard.tokenName, 'notion-api-key');
  });

  it('graphGuard is a TokenGuard for graph-access-token', () => {
    assert.ok(graphGuard instanceof TokenGuard);
    assert.equal(graphGuard.tokenName, 'graph-access-token');
  });

  it('typesafeGuard is a TokenGuard for typesafe-api-key', () => {
    assert.ok(typesafeGuard instanceof TokenGuard);
    assert.equal(typesafeGuard.tokenName, 'typesafe-api-key');
  });

  it('pre-built guards work with wrap()', async () => {
    await withEnvAsync('GITHUB_TOKEN', 'ghp_prebuilt', async () => {
      githubGuard.invalidate(); // clear any stale cache
      const result = await githubGuard.wrap(async (token) => {
        return `got ${token}`;
      });
      assert.equal(result, 'got ghp_prebuilt');
    });
  });
});
