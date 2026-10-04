// lib/token-validator.js — Token Validator
// Validator checks your key at the gate. Key good, you pass.
// Key bad, no let you in, tell you how to get new key.
// Validator never waves you through on faith.
//
// DR-2: All credentials live in .env. This is the single read path.
// S6: Values are returned to callers, never printed or logged.
//
// The TokenGuard class is the heart. Every tool is born inside wrap().
// check() validates with caching. invalidate() nukes the cache on 401.
// wrap(handler) is the magic wrapper — check, run, catch auth errors.

import https from 'node:https';
import { getTlsOptions } from './secure-transport.js';
import { loadEnv, getEnv } from './env.js';

// Ensure .env is loaded before any token read
loadEnv();

/**
 * TOKEN_KEY_MAP — the source map.
 * Friendly name → .env key.
 *
 * WHY a map: Skills say "I need the graph token." They shouldn't know or care
 * that it's stored as GRAPH_ACCESS_TOKEN in .env. The map is the translation
 * layer. One place to rename, one place to audit, one place to add new tokens.
 *
 * WHY friendly names: "graph-access-token" reads like what it IS.
 * GRAPH_ACCESS_TOKEN reads like where it LIVES. Skills care about what, not where.
 */
export const TOKEN_KEY_MAP = {
  'github-token':       'GITHUB_TOKEN',
  'notion-api-key':     'NOTION_API_KEY',
  'substack-email':     'SUBSTACK_EMAIL',
  'substack-password':  'SUBSTACK_PASSWORD',
  'graph-access-token': 'GRAPH_ACCESS_TOKEN',
  'typesafe-api-key':   'TYPESAFE_API_KEY',
};

/**
 * Read a token by friendly name.
 *
 * Guard logic:
 *   1. Is the friendly name in the map? No → reject, tell them valid names.
 *   2. Is the .env key present and non-empty? No → reject, tell them how to set it.
 *   3. Key good → return value.
 *
 * Never returns undefined. Never returns empty string. Never waves you through on faith.
 *
 * @param {string} name - Friendly token name (e.g. "github-token")
 * @returns {{ ok: boolean, value: string|null, error: string|null }}
 */
export function readToken(name) {
  // Gate 1: Is the name in the map?
  const envKey = TOKEN_KEY_MAP[name];
  if (!envKey) {
    const validNames = Object.keys(TOKEN_KEY_MAP).join(', ');
    return {
      ok: false,
      value: null,
      error: `Unknown token "${name}". Valid names: ${validNames}`,
    };
  }

  // Gate 2: Is the value present and non-empty?
  const value = getEnv(envKey);
  if (!value || value.trim().length === 0) {
    return {
      ok: false,
      value: null,
      error: `${name} is not set. Add ${envKey}=<your-value> to .env`,
    };
  }

  // Gate 3: If it looks like a JWT, check expiry.
  // DR-6: We decode for claims (exp), no signature verification.
  // WHY: If the token is expired, there's no point sending it. The API will reject it,
  // but we can save the round trip and tell the caller to refresh NOW.
  const expiry = jwtExp(value);
  if (expiry !== null) {
    const remaining = secsLeft(expiry);
    if (remaining <= 0) {
      return {
        ok: false,
        value: null,
        error: `${name} is expired (${Math.abs(remaining)}s ago). Refresh it: update ${envKey} in .env`,
      };
    }
  }

  // Gate 4: Passed. Return the value.
  // S6: We return it to the caller. We NEVER log it, print it, or include it in errors.
  return { ok: true, value, error: null };
}

/**
 * Extract the exp claim from a JWT.
 * DR-6: Decode only, no signature verification.
 * WHY no verification: see SECURITY.md DR-6 — the API is the ultimate validator.
 *
 * @param {string} token - A potential JWT (three dot-separated base64 segments)
 * @returns {number|null} Unix timestamp of expiry, or null if not a JWT / no exp claim
 */
export function jwtExp(token) {
  const parts = token.split('.');
  if (parts.length !== 3) return null; // Not a JWT

  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));
    if (typeof payload.exp === 'number') return payload.exp;
    return null;
  } catch {
    return null; // Not valid base64/JSON — not a JWT, just a regular token
  }
}

/**
 * Seconds remaining until a Unix timestamp.
 * Positive = still valid. Zero or negative = expired.
 *
 * @param {number} expTimestamp - Unix timestamp (seconds)
 * @returns {number} Seconds remaining (negative means expired N seconds ago)
 */
export function secsLeft(expTimestamp) {
  return Math.floor(expTimestamp - Date.now() / 1000);
}

const VALID_TTL_MS   = 300_000; // 5 min — valid token cached for full TTL
const INVALID_TTL_MS = 10_000;  // 10s — failed check cached short so a refresh is picked up fast

/**
 * Refresh instructions per service.
 * WHY per-service: each token has a different refresh flow.
 * "Update your .env" is useless without telling the user HOW to get the new value.
 */
const REFRESH_STEPS = {
  'github-token':       'Generate a new PAT at https://github.com/settings/tokens → copy → set GITHUB_TOKEN in .env',
  'notion-api-key':     'Create integration at https://www.notion.so/my-integrations → copy Internal Integration Secret → set NOTION_API_KEY in .env',
  'substack-email':     'Set your Substack login email as SUBSTACK_EMAIL in .env',
  'substack-password':  'Set your Substack password as SUBSTACK_PASSWORD in .env',
  'graph-access-token': 'Run the Graph auth flow (see docs) → copy access_token → set GRAPH_ACCESS_TOKEN in .env',
  'typesafe-api-key':   'Get API key from https://docs.typesafe.ai → set TYPESAFE_API_KEY in .env',
};

/**
 * Service display names for human-readable prompts.
 */
const SERVICE_NAMES = {
  'github-token':       'GitHub',
  'notion-api-key':     'Notion',
  'substack-email':     'Substack',
  'substack-password':  'Substack',
  'graph-access-token': 'Microsoft Graph',
  'typesafe-api-key':   'TypeSafe',
};

/**
 * _authPrompt — the auth prompt contract.
 *
 * This is the structured object the AI is REQUIRED to surface to the user.
 * Not optional. Not swallowable. When wrap() returns this, the AI presents it.
 *
 * Shape:
 *   action_required: "auth_choice"     — always this value, machine-readable
 *   service:         "Graph"           — human-readable service name
 *   message:         "Graph expired 42s ago"  — what happened
 *   choices:         ["refresh", "skip"]       — what the user can do
 *   refresh_steps:   "Run the Graph auth..." — how to fix it
 *
 * WHY this shape:
 *   - action_required is a sentinel the AI checks: if present, surface the prompt
 *   - service tells the user WHICH integration is broken
 *   - message tells them WHY
 *   - choices tells them WHAT they can do
 *   - refresh_steps tells them HOW to fix it
 *   The user never gets a cryptic error. They get a menu.
 *
 * @param {string} tokenName - Friendly name of the token that failed
 * @param {string} reason - Why it failed
 * @returns {{ action_required: "auth_choice", service: string, message: string, choices: string[], refresh_steps: string }}
 */
export function _authPrompt(tokenName, reason) {
  const service = SERVICE_NAMES[tokenName] || tokenName;
  return {
    action_required: 'auth_choice',
    service,
    message: `${service}: ${reason}`,
    choices: ['refresh', 'skip'],
    refresh_steps: REFRESH_STEPS[tokenName] || `Set ${TOKEN_KEY_MAP[tokenName] || 'UNKNOWN_KEY'} in .env`,
  };
}

/**
 * Detect auth errors in thrown exceptions.
 * WHY: Different APIs surface auth failures differently.
 * This checks the common patterns so wrap() can catch them all.
 *
 * @param {Error} err - The thrown error
 * @returns {boolean}
 */
function isAuthError(err) {
  // HTTP 401 in status property (axios-style, fetch-style, our secureRequest)
  if (err.status === 401 || err.statusCode === 401) return true;
  // HTTP 403 — some APIs use this for expired tokens
  if (err.status === 403 || err.statusCode === 403) return true;
  // Message-based detection as fallback
  const msg = (err.message || '').toLowerCase();
  if (msg.includes('401') || msg.includes('unauthorized')) return true;
  if (msg.includes('403') || msg.includes('forbidden')) return true;
  if (msg.includes('token expired') || msg.includes('invalid token')) return true;
  return false;
}

/**
 * TokenGuard — the heart.
 *
 * WHY a class: each token gets its own guard with its own cache.
 * A guard for "github-token" doesn't share cache with "notion-api-key".
 * Each guard knows exactly one token name and guards exactly one boundary.
 *
 * Three methods:
 *   check()          — validate + cache. Valid → cache 300s. Invalid → cache 10s.
 *   invalidate()     — nuke the cache. Called on mid-call 401.
 *   wrap(handler)    — the magic wrapper. Every tool is born inside this.
 *
 * WHY two TTLs:
 *   Valid token → 300s cache. No need to re-read .env and re-decode JWT every call.
 *   Invalid token → 10s cache. Short so a refresh (user updates .env) is picked up fast.
 *   Without the short TTL, a user who fixes their token waits 5 minutes. That's hostile UX.
 */
export class TokenGuard {
  /**
   * @param {string} tokenName - Friendly name from TOKEN_KEY_MAP (e.g. "github-token")
   */
  constructor(tokenName) {
    this.tokenName = tokenName;
    this._cache = null;    // { ok, value, error }
    this._cachedAt = 0;    // Date.now() when cached
    this._cacheTtl = 0;    // ms — how long this cache entry lives
  }

  /**
   * check() — validate the token, with caching.
   *
   * Cache hit and still fresh? Return cached result. No disk read, no JWT decode.
   * Cache miss or stale? Call readToken(), cache the result.
   *   - Valid → cache for 300s (VALID_TTL_MS)
   *   - Invalid → cache for 10s (INVALID_TTL_MS)
   *
   * WHY cache at all: readToken() reads .env from disk and decodes JWT on every call.
   * For a token that's used 50 times in a batch, that's 50 disk reads. Caching avoids that.
   *
   * WHY short invalid TTL: The user fixes their .env. If we cached the failure for 5 min,
   * they'd think the fix didn't work. 10s is short enough that retrying "just works."
   *
   * @returns {{ ok: boolean, value: string|null, error: string|null }}
   */
  check() {
    const now = Date.now();

    // Cache hit?
    if (this._cache && (now - this._cachedAt) < this._cacheTtl) {
      return this._cache;
    }

    // Cache miss — validate fresh
    // Re-load .env so we pick up changes (user may have just updated a token)
    loadEnv();
    const result = readToken(this.tokenName);

    this._cache = result;
    this._cachedAt = now;
    this._cacheTtl = result.ok ? VALID_TTL_MS : INVALID_TTL_MS;

    return result;
  }

  /**
   * invalidate() — nuke the cache.
   *
   * Called when a mid-call 401 proves the cached token is actually bad.
   * Next check() will re-read from .env, giving the user a chance to refresh.
   *
   * WHY explicit invalidate instead of just short TTL everywhere:
   * A 401 is a definitive signal. The token IS bad. Waiting even 10s is wrong.
   * Invalidate means the very next check() re-validates immediately.
   */
  invalidate() {
    this._cache = null;
    this._cachedAt = 0;
    this._cacheTtl = 0;
  }

  /**
   * wrap(handler) — the magic wrapper.
   *
   * This is what every tool is born inside.
   *
   * Flow:
   *   1. check() the token.
   *   2. Not valid? Return auth_choice prompt. STOP. Never run handler.
   *   3. Valid? Run the real handler, passing the token value.
   *   4. Handler throws auth error (401/403)? Invalidate cache, return auth_choice.
   *   5. Handler throws any other error? Rethrow. Not the guard's job.
   *
   * WHY the guard never runs the handler on bad auth:
   * A tool that runs without auth will either crash (bad UX) or silently fail
   * (worse UX). The guard stops it before it starts and tells the user exactly
   * what to fix.
   *
   * WHY rethrow non-auth errors:
   * The guard's job is auth. A 500 from the API, a network timeout, a JSON parse
   * error — those are the handler's problem. The guard doesn't mask them.
   *
   * @param {(token: string) => Promise<any>} handler - The tool logic. Receives the token value.
   * @returns {Promise<any>} Handler result, or auth_choice prompt on auth failure.
   */
  async wrap(handler) {
    // Step 1: check
    const result = this.check();

    // Step 2: not valid → auth_choice, STOP
    if (!result.ok) {
      return _authPrompt(this.tokenName, result.error);
    }

    // Step 3: valid → run handler
    try {
      return await handler(result.value);
    } catch (err) {
      // Step 4: auth error → invalidate, auth_choice
      if (isAuthError(err)) {
        this.invalidate();
        return _authPrompt(
          this.tokenName,
          `Auth failed mid-call: ${err.message || 'unknown auth error'}`,
        );
      }

      // Step 5: not auth → rethrow
      throw err;
    }
  }
}

const PROBE_TIMEOUT_MS = 8_000;

/**
 * Cheap liveness probe. Lightweight HTTPS GET → status code, nothing more.
 *
 * WHY this exists: Before sending a token to an API, you want to know
 * if the API is even alive. This answers that with a single HEAD-weight GET.
 *
 * WHY it borrows getTlsOptions() instead of making its own TLS decisions:
 * Token-guard is not the TLS authority. Transport is. The layers stack:
 *   transport.js  → getTlsOptions()   (owns the decision)
 *   token-guard.js → httpStatus()     (borrows the decision)
 * Token-guard doesn't know or care what rejectUnauthorized is set to.
 * It trusts transport to get that right.
 *
 * WHY errors resolve to 0: A dead network shouldn't crash the guard.
 * The caller checks: status > 0 means reachable, 0 means unreachable.
 * No throws, no catch blocks needed upstream.
 *
 * @param {string} url - HTTPS URL to probe
 * @returns {Promise<number>} HTTP status code, or 0 on any failure
 */
export function httpStatus(url) {
  return new Promise((resolve) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      resolve(0);
      return;
    }

    if (parsed.protocol !== 'https:') {
      resolve(0);
      return;
    }

    const req = https.request(parsed, {
      method: 'GET',
      timeout: PROBE_TIMEOUT_MS,
      ...getTlsOptions(),
    }, (res) => {
      // Drain the response so the socket can be freed
      res.resume();
      resolve(res.statusCode);
    });

    req.on('timeout', () => {
      req.destroy();
      resolve(0);
    });

    req.on('error', () => {
      resolve(0);
    });

    req.end();
  });
}

// ---------------------------------------------------------------------------
// Per-service checkers + pre-built guards
// ---------------------------------------------------------------------------
// WHY per-service: Each service has different validation. GitHub uses PATs
// (no JWT, no expiry — only the API knows if it's valid). Graph uses JWTs
// (decode locally, check exp). Some services you can probe online (hit the
// API, read the 401/403). Some you check offline (decode JWT, check expiry).
//
// Each checkXToken() returns the same shape:
//   { valid, service, message, fix }
// Either offline (decode JWT, check expiry locally) or online (hit the REST API,
// read the 401/403).

/**
 * Per-service API endpoints for online checks.
 * Hit these with a GET + Bearer token. 401/403 = bad token. 2xx = good.
 */
const SERVICE_ENDPOINTS = {
  'github-token':       'https://api.github.com/user',
  'notion-api-key':     'https://api.notion.com/v1/users/me',
  'typesafe-api-key':   'https://api.typesafe.ai/v1/health',
};

/**
 * Offline check: decode JWT locally, check exp.
 * WHY offline: Faster than a network call. Good enough when the token has an exp claim.
 * If the token isn't a JWT, we can't check offline — return valid (optimistic).
 *
 * @param {string} tokenName
 * @returns {{ valid: boolean, service: string, message: string, fix: string }}
 */
function checkOffline(tokenName) {
  const service = SERVICE_NAMES[tokenName] || tokenName;
  const fix = REFRESH_STEPS[tokenName] || `Set ${TOKEN_KEY_MAP[tokenName]} in .env`;

  const result = readToken(tokenName);
  if (!result.ok) {
    return { valid: false, service, message: result.error, fix };
  }

  // If it's a JWT, check expiry
  const exp = jwtExp(result.value);
  if (exp !== null) {
    const remaining = secsLeft(exp);
    if (remaining <= 0) {
      return { valid: false, service, message: `${service} expired ${Math.abs(remaining)}s ago`, fix };
    }
    return { valid: true, service, message: `${service} valid (${remaining}s remaining)`, fix };
  }

  // Not a JWT — can't check expiry offline, assume valid
  return { valid: true, service, message: `${service} token present (no expiry to check offline)`, fix };
}

/**
 * Online check: hit the service's API, read the status code.
 * WHY online: Definitive. The API is the trust boundary. If it says 401, the token is bad.
 * Falls back to offline if the service is unreachable (network shouldn't block the check).
 *
 * @param {string} tokenName
 * @returns {Promise<{ valid: boolean, service: string, message: string, fix: string }>}
 */
async function checkOnline(tokenName) {
  const service = SERVICE_NAMES[tokenName] || tokenName;
  const fix = REFRESH_STEPS[tokenName] || `Set ${TOKEN_KEY_MAP[tokenName]} in .env`;
  const endpoint = SERVICE_ENDPOINTS[tokenName];

  // No endpoint configured — fall back to offline
  if (!endpoint) return checkOffline(tokenName);

  // First, is the token even present?
  const result = readToken(tokenName);
  if (!result.ok) {
    return { valid: false, service, message: result.error, fix };
  }

  // Probe the API with the token
  const status = await httpStatus(endpoint);

  // Unreachable — can't check online, fall back to offline
  if (status === 0) {
    const offline = checkOffline(tokenName);
    offline.message += ' (API unreachable, checked offline)';
    return offline;
  }

  // 401/403 = bad token
  if (status === 401 || status === 403) {
    return { valid: false, service, message: `${service} rejected token (HTTP ${status})`, fix };
  }

  // 2xx = good
  if (status >= 200 && status < 300) {
    return { valid: true, service, message: `${service} authenticated (HTTP ${status})`, fix };
  }

  // Other status — token might be fine, API might be having issues
  return { valid: true, service, message: `${service} responded HTTP ${status} (token may be valid, API issue)`, fix };
}

// --- Per-service checker exports ---

export async function checkGitHubToken()  { return checkOnline('github-token'); }
export async function checkNotionToken()  { return checkOnline('notion-api-key'); }
export async function checkGraphToken()   { return checkOffline('graph-access-token'); } // JWT — offline is definitive
export async function checkTypeSafeToken(){ return checkOnline('typesafe-api-key'); }

// --- Pre-built guards ---
// WHY pre-built: Skills shouldn't construct guards. They grab the one they need.
// One guard per service, shared across all tools that use that service.

export const githubGuard   = new TokenGuard('github-token');
export const notionGuard   = new TokenGuard('notion-api-key');
export const graphGuard    = new TokenGuard('graph-access-token');
export const typesafeGuard = new TokenGuard('typesafe-api-key');
