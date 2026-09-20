// lib/transport.js
// DR-4: Single transport gate — ALL outbound HTTP goes through here
// DR-1: TLS certificate validation — hardcoded, no override
// WHY: One place to enforce, one place to audit, one place to fix.

import https from 'node:https';
import http from 'node:http';

// DR-1: Refuse to start if TLS validation is globally disabled
if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
  console.error(
    '[BIRBAL SECURITY] NODE_TLS_REJECT_UNAUTHORIZED=0 detected. ' +
    'Birbal refuses to start with TLS validation disabled. ' +
    'See SECURITY.md DR-1 for WHY.'
  );
  process.exit(1);
}

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 1_000;

/**
 * Create a secure HTTPS agent. This is the ONLY way to make outbound HTTP calls.
 *
 * WHY a single function:
 * - TLS validation is hardcoded (DR-1)
 * - Timeouts have a ceiling (can't wait forever)
 * - Retries use exponential backoff (no thundering herd)
 * - Logging captures method/URL/status but NEVER bodies or credentials (S6)
 */
export function createSecureAgent(options = {}) {
  return new https.Agent({
    // DR-1: hardcoded, not configurable
    rejectUnauthorized: true,
    // Reasonable keepalive defaults
    keepAlive: true,
    keepAliveMsecs: 10_000,
    maxSockets: 25,
    ...options,
    // DR-1: even if options tries to override, we enforce
    rejectUnauthorized: true,
  });
}

/**
 * Make a secure HTTP request.
 * All outbound traffic MUST go through this function.
 *
 * @param {string} url - The URL to request
 * @param {object} options - Request options
 * @param {string} options.method - HTTP method
 * @param {object} options.headers - Request headers
 * @param {string|Buffer} options.body - Request body
 * @param {number} options.timeout - Timeout in ms (capped at MAX_TIMEOUT_MS)
 * @param {number} options.retries - Max retries (capped at MAX_RETRIES)
 */
export async function secureRequest(url, options = {}) {
  const parsed = new URL(url);

  // DR-1: HTTPS only. No plaintext HTTP.
  if (parsed.protocol === 'http:') {
    throw new Error(
      `[BIRBAL SECURITY] HTTP request blocked: ${url}. ` +
      'Only HTTPS is allowed. See SECURITY.md DR-1.'
    );
  }

  const timeout = Math.min(options.timeout || DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
  const maxRetries = Math.min(options.retries || 0, MAX_RETRIES);
  const method = (options.method || 'GET').toUpperCase();
  const agent = createSecureAgent();

  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      // Exponential backoff: 1s, 2s, 4s
      const backoff = RETRY_BASE_MS * Math.pow(2, attempt - 1);
      await new Promise(r => setTimeout(r, backoff));
    }

    try {
      const result = await new Promise((resolve, reject) => {
        const req = https.request(parsed, {
          method,
          headers: options.headers || {},
          agent,
          timeout,
        }, (res) => {
          const chunks = [];
          res.on('data', chunk => chunks.push(chunk));
          res.on('end', () => {
            const body = Buffer.concat(chunks).toString('utf-8');
            // Log method, URL, status — NEVER bodies or credentials (S6)
            console.log(`[BIRBAL] ${method} ${parsed.pathname} → ${res.statusCode}`);
            resolve({ status: res.statusCode, headers: res.headers, body });
          });
        });

        req.on('timeout', () => {
          req.destroy();
          reject(new Error(`Request timeout after ${timeout}ms: ${method} ${url}`));
        });

        req.on('error', reject);

        if (options.body) {
          req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
        }
        req.end();
      });

      return result;
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError;
}
