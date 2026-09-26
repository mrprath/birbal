// lib/validate.js — Injection Defense + URL Allowlist
// DR-5: No eval interpolation of user input
// DR-7: Repo isolation — outbound URLs checked against allowlist
// DR-9: No shell interpolation — array-form spawn only
//
// WHY this exists: User input is the #1 injection vector.
// These validators run BEFORE input reaches any processing.
// If input doesn't pass here, it doesn't pass anywhere.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SETTINGS_PATH = resolve(__dirname, '..', 'settings.json');

/**
 * Validate an email address.
 * WHY: Email fields are the most common injection target in shell-to-Node bridges.
 * `'; process.exit();//` as an email = code execution if interpolated.
 * This validator ensures the value is structurally an email, nothing more.
 *
 * @param {string} value - The email to validate
 * @returns {{ valid: boolean, email: string|null, reason: string|null }}
 */
export function validateEmail(value) {
  if (typeof value !== 'string') {
    return { valid: false, email: null, reason: 'not a string' };
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return { valid: false, email: null, reason: 'empty' };
  }

  if (trimmed.length > 254) {
    return { valid: false, email: null, reason: 'exceeds max email length (254)' };
  }

  // DR-5: simple structural check — not a full RFC 5322 parser
  // WHY simple: complex regex is itself an injection surface (ReDoS).
  // This catches structure, not edge cases. The mail server is the final validator.
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!EMAIL_RE.test(trimmed)) {
    return { valid: false, email: null, reason: 'invalid email format' };
  }

  return { valid: true, email: trimmed, reason: null };
}

// Characters that have no business in user input
// WHY each category:
//   Control chars (0x00-0x1F, 0x7F): can break parsers, inject terminal escapes
//   Null bytes: C-string terminators, truncation attacks
//   Unicode direction overrides (U+200E-U+200F, U+202A-U+202E): visual spoofing
const DANGEROUS_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\u200E\u200F\u202A-\u202E]/;

/**
 * Validate arbitrary user input for safe processing.
 * WHY: Every freeform input gets this check before it touches any system.
 * This is the boundary between "user said" and "system processes."
 *
 * @param {string} value - The input to validate
 * @param {object} opts
 * @param {number} opts.maxLength - Maximum allowed length (default 10_000)
 * @returns {{ valid: boolean, sanitized: string|null, reason: string|null }}
 */
export function validateSafeInput(value, opts = {}) {
  const maxLength = opts.maxLength ?? 10_000;

  if (typeof value !== 'string') {
    return { valid: false, sanitized: null, reason: 'not a string' };
  }

  if (value.length === 0) {
    return { valid: false, sanitized: null, reason: 'empty' };
  }

  if (value.length > maxLength) {
    return { valid: false, sanitized: null, reason: `exceeds max length (${maxLength})` };
  }

  if (DANGEROUS_RE.test(value)) {
    return { valid: false, sanitized: null, reason: 'contains dangerous control characters' };
  }

  // Passed — return trimmed value
  return { valid: true, sanitized: value.trim(), reason: null };
}

/**
 * Load the allowed URLs from settings.json.
 * WHY a function, not a top-level const: settings.json can change between runs.
 * We read it fresh each time so a stale cache doesn't silently allow a removed URL.
 *
 * @returns {string[]} The allowlist
 */
function loadAllowedUrls() {
  try {
    const raw = readFileSync(SETTINGS_PATH, 'utf-8');
    const settings = JSON.parse(raw);
    return settings.allowedUrls || [];
  } catch {
    // If settings.json is missing or broken, deny everything.
    // WHY: fail closed, not open. No allowlist = no outbound.
    return [];
  }
}

/**
 * Validate a URL against the settings.json allowlist (DR-7).
 * WHY: The allowlist was a paper rule — documented in settings.json but never
 * enforced in code. A compromised skill could POST creds to any endpoint.
 * This closes that gap: if the URL's origin isn't on the list, it's blocked.
 *
 * Matching is origin-based (scheme + host + port).
 * WHY origin, not prefix: prefix matching on "https://api.github.com" would
 * also match "https://api.github.com.evil.com". Origin matching compares
 * the parsed host, so that attack fails.
 *
 * @param {string} url - The URL to validate
 * @returns {{ valid: boolean, url: string|null, reason: string|null }}
 */
export function validateUrl(url) {
  if (typeof url !== 'string') {
    return { valid: false, url: null, reason: 'not a string' };
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { valid: false, url: null, reason: 'invalid URL' };
  }

  if (parsed.protocol !== 'https:') {
    return { valid: false, url: null, reason: 'only HTTPS allowed (DR-1)' };
  }

  const allowedUrls = loadAllowedUrls();
  const requestOrigin = parsed.origin; // e.g. "https://api.github.com"

  const allowed = allowedUrls.some(allowedUrl => {
    try {
      return new URL(allowedUrl).origin === requestOrigin;
    } catch {
      return false;
    }
  });

  if (!allowed) {
    return {
      valid: false,
      url: null,
      reason: `${parsed.origin} not in allowed URLs (settings.json, DR-7)`,
    };
  }

  return { valid: true, url: parsed.href, reason: null };
}
