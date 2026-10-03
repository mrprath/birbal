// mcp/sanitize.js — Response sanitization before the model sees it
// WHY: API responses contain PII, noise, and sometimes leaked credentials.
// The model doesn't need any of that. Strip it before it enters the context window.
// Uses scrubSecrets() from lib/resilient-request.js for credential patterns (S6).

import { scrubSecrets } from '../lib/resilient-request.js';

// --- PII patterns ---
// WHY regex, not ML: deterministic, fast, no false negatives on known formats.
// False positives are acceptable — redacting a non-PII email-shaped string is fine.
const PII_PATTERNS = [
  // SSN must be checked BEFORE phone — SSN is a strict subset of phone-like patterns
  { regex: /\b\d{3}-\d{2}-\d{4}\b/g, tag: '[PII_SSN]' },
  { regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, tag: '[PII_EMAIL]' },
  { regex: /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, tag: '[PII_PHONE]' },
];

// --- Noise fields (global) ---
const NOISE_FIELDS = new Set([
  'next_cursor', 'start_cursor', 'has_more', 'total_count',
  'etag', 'x-request-id', 'x-github-request-id', 'request_id',
  'x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset', 'x-ratelimit-used',
]);

// --- Per-service noise ---
const SERVICE_NOISE = {
  github: new Set(['node_id', 'gravatar_id', 'events_url', 'received_events_url']),
  notion: new Set(['request_id', 'developer_survey']),
};

/**
 * Strip PII from a string.
 * @param {*} str - input (non-strings return '')
 * @returns {string}
 */
export function stripPii(str) {
  if (typeof str !== 'string') return '';
  let result = str;
  for (const { regex, tag } of PII_PATTERNS) {
    // Reset lastIndex — regexes with /g flag are stateful
    regex.lastIndex = 0;
    result = result.replace(regex, tag);
  }
  return result;
}

/**
 * Recursively strip noise fields from an object or array.
 * @param {*} obj - input value
 * @param {string} [serviceName] - optional service for per-service noise
 * @returns {*} cleaned value
 */
export function stripNoise(obj, serviceName) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map(item => stripNoise(item, serviceName));
  }

  const serviceFields = serviceName ? SERVICE_NOISE[serviceName] : null;
  const cleaned = {};

  for (const [key, value] of Object.entries(obj)) {
    if (NOISE_FIELDS.has(key)) continue;
    if (serviceFields && serviceFields.has(key)) continue;
    cleaned[key] = stripNoise(value, serviceName);
  }

  return cleaned;
}

/**
 * Scrub secrets and PII from all string values in an object tree.
 * WHY walk values individually: scrubSecrets uses \S+ patterns that over-match
 * when applied to serialized JSON (they eat through quotes and keys).
 * Applying to each string value in isolation prevents cross-field damage.
 */
function scrubStrings(obj) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') return stripPii(scrubSecrets(obj));
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(scrubStrings);

  const cleaned = {};
  for (const [key, value] of Object.entries(obj)) {
    cleaned[key] = scrubStrings(value);
  }
  return cleaned;
}

/**
 * Full sanitization pipeline: scrubSecrets+stripPii on strings -> stripNoise on structure.
 * WHY this order: secrets first (most dangerous), then PII, then noise.
 * @param {*} obj - API response object
 * @param {string} [serviceName] - optional service name for per-service noise
 * @returns {*} sanitized object, or null for null/undefined input
 */
export function sanitizeResponse(obj, serviceName) {
  if (obj === null || obj === undefined) return null;

  // Step 1: scrub secrets and PII from all string values individually
  const scrubbed = scrubStrings(obj);

  // Step 2: strip noise fields structurally
  return stripNoise(scrubbed, serviceName);
}
