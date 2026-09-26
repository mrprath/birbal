// lib/request.js — Secure HTTP Requests
// Timeouts, retries, secret scrubbing.
// WHY separate from TPS: these are operational concerns.
// TPS decides "is the connection secure?" (yes/no, done).
// This file decides "how do we make the call reliably?"

import https from 'node:https';
import { createSecureAgent } from './transport.js';
import { validateUrl } from './validate.js';

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 1_000;

// S6: Patterns that look like secrets in headers or URLs
// WHY: Logs are shared, copy-pasted, screenshotted. One leaked token in a log = breach.
const SECRET_PATTERNS = [
  /Bearer\s+\S+/gi,
  /token=\S+/gi,
  /key=\S+/gi,
  /password=\S+/gi,
  /secret=\S+/gi,
  /authorization:\s*\S+/gi,
];

/**
 * Scrub secrets from a string before logging.
 * WHY: console.log is the most common credential leak vector in Node.
 * This runs on every log line, no exceptions.
 *
 * @param {string} str - The string to scrub
 * @returns {string} The scrubbed string
 */
export function scrubSecrets(str) {
  let scrubbed = str;
  for (const pattern of SECRET_PATTERNS) {
    scrubbed = scrubbed.replace(pattern, '[REDACTED]');
  }
  return scrubbed;
}

/**
 * Make a secure HTTP request.
 * All outbound traffic MUST go through this function.
 *
 * Uses TPS agent from lib/transport.js (DR-1, DR-4).
 * Adds: capped timeouts, exponential backoff retries, secret scrubbing on logs.
 *
 * @param {string} url - The URL to request (HTTPS only)
 * @param {object} options
 * @param {string} options.method - HTTP method (default GET)
 * @param {object} options.headers - Request headers
 * @param {string|Buffer|object} options.body - Request body (objects are JSON-stringified)
 * @param {number} options.timeout - Timeout in ms (capped at MAX_TIMEOUT_MS)
 * @param {number} options.retries - Max retries (capped at MAX_RETRIES)
 * @returns {Promise<{ status: number, headers: object, body: string }>}
 */
export async function secureRequest(url, options = {}) {
  // DR-7: URL must be on the allowlist before anything else happens.
  // WHY first: no point parsing timeouts for a URL we'll reject.
  const urlCheck = validateUrl(url);
  if (!urlCheck.valid) {
    throw new Error(`[BIRBAL] Request blocked: ${urlCheck.reason}`);
  }

  const parsed = new URL(url);

  const timeout = Math.min(options.timeout || DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
  const maxRetries = Math.min(options.retries || 0, MAX_RETRIES);
  const method = (options.method || 'GET').toUpperCase();
  const agent = createSecureAgent();

  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
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
            // S6: Log method, path, status — NEVER bodies, headers, or credentials
            console.log(
              scrubSecrets(`[BIRBAL] ${method} ${parsed.pathname} → ${res.statusCode}`)
            );
            resolve({ status: res.statusCode, headers: res.headers, body });
          });
        });

        req.on('timeout', () => {
          req.destroy();
          reject(new Error(`Request timeout after ${timeout}ms: ${method} ${parsed.hostname}${parsed.pathname}`));
        });

        req.on('error', reject);

        if (options.body) {
          const payload = typeof options.body === 'string'
            ? options.body
            : JSON.stringify(options.body);
          req.write(payload);
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
