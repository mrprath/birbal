// lib/gmail.js — Gmail API wrapper
// DR-2: OAuth credentials from getEnv()
// DR-4: All HTTP through secureRequest
// S6: Never log credentials or email content
// CC-1: No autonomous sends without user confirmation

import { secureRequest } from './resilient-request.js';
import { getEnv, setEnv } from './env.js';
import { ValidationError, TransportError, SecurityError } from './errors.js';
import { validateEmail, validateEmailHeader } from './validate.js';

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';

/**
 * Get OAuth2 access token.
 * Expects GMAIL_ACCESS_TOKEN in env (refreshed externally or via OAuth flow).
 */
function getAccessToken() {
  const token = getEnv('GMAIL_ACCESS_TOKEN');
  if (!token) throw new ValidationError('GMAIL_ACCESS_TOKEN not set', 'VALIDATION_MISSING_KEY');
  return token;
}

function authHeaders() {
  return {
    'Authorization': `Bearer ${getAccessToken()}`,
    'Content-Type': 'application/json',
  };
}

/**
 * Refresh the access token using the refresh token.
 * WHY: access tokens expire after 1 hour. Auto-refresh prevents mid-run failures.
 * S6: tokens never logged.
 */
let _refreshing = null;
async function refreshAccessToken() {
  // Deduplicate concurrent refresh attempts
  if (_refreshing) return _refreshing;

  _refreshing = (async () => {
    const clientId = getEnv('GMAIL_CLIENT_ID');
    const clientSecret = getEnv('GMAIL_CLIENT_SECRET');
    const refreshToken = getEnv('GMAIL_REFRESH_TOKEN');

    if (!clientId || !clientSecret || !refreshToken) {
      throw new ValidationError(
        'Cannot refresh: missing GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, or GMAIL_REFRESH_TOKEN',
        'VALIDATION_MISSING_KEY',
      );
    }

    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    });

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new TransportError(`Token refresh failed (${res.status})`, res.status);
    }

    const data = await res.json();
    setEnv('GMAIL_ACCESS_TOKEN', data.access_token);
    process.env.GMAIL_ACCESS_TOKEN = data.access_token;
  })();

  try {
    await _refreshing;
  } finally {
    _refreshing = null;
  }
}

/**
 * Make a Gmail API request with auto-refresh on 401.
 * If the first attempt returns 401 and a refresh token exists, refresh and retry once.
 */
async function gmailRequest(url, opts) {
  const res = await secureRequest(url, opts);

  if (res.statusCode === 401 && getEnv('GMAIL_REFRESH_TOKEN')) {
    await refreshAccessToken();
    // Rebuild headers with new token
    const retryOpts = { ...opts, headers: { ...opts.headers, ...authHeaders() } };
    return secureRequest(url, retryOpts);
  }

  return res;
}

/**
 * Search Gmail messages.
 *
 * @param {string} query - Gmail search query (e.g. "from:tldrnewsletter.com after:1695600000")
 * @param {number} maxResults - Max results to return (default 10)
 * @returns {Promise<Array<{id: string, threadId: string}>>}
 */
export async function searchMessages(query, maxResults = 10) {
  const params = new URLSearchParams({ q: query, maxResults: String(maxResults) });
  const res = await gmailRequest(`${GMAIL_API}/messages?${params}`, {
    method: 'GET',
    headers: authHeaders(),
    retries: 2,
  });

  const data = JSON.parse(res.body);
  return data.messages || [];
}

/**
 * Get a single message with full body.
 *
 * @param {string} messageId
 * @returns {Promise<object>} Gmail message object
 */
export async function getMessage(messageId) {
  const res = await gmailRequest(`${GMAIL_API}/messages/${messageId}?format=full`, {
    method: 'GET',
    headers: authHeaders(),
    retries: 1,
  });

  return JSON.parse(res.body);
}

/**
 * Extract plaintext body from a Gmail message.
 * Walks the MIME parts looking for text/plain.
 *
 * @param {object} message - Gmail message object from getMessage()
 * @returns {string} Decoded plaintext body
 */
export function extractPlaintext(message) {
  const parts = message.payload?.parts || [];

  // Single-part message
  if (!parts.length && message.payload?.body?.data) {
    return decodeBase64Url(message.payload.body.data);
  }

  // Multi-part: find text/plain
  for (const part of parts) {
    if (part.mimeType === 'text/plain' && part.body?.data) {
      return decodeBase64Url(part.body.data);
    }
    // Nested multipart
    if (part.parts) {
      for (const sub of part.parts) {
        if (sub.mimeType === 'text/plain' && sub.body?.data) {
          return decodeBase64Url(sub.body.data);
        }
      }
    }
  }

  return '';
}

/**
 * Get the sender email from a message.
 */
export function getSender(message) {
  const fromHeader = message.payload?.headers?.find(h => h.name.toLowerCase() === 'from');
  if (!fromHeader) return '';
  // Extract email from "Name <email>" format
  const match = fromHeader.value.match(/<([^>]+)>/);
  return match ? match[1] : fromHeader.value.trim();
}

/**
 * Get subject from a message.
 */
export function getSubject(message) {
  const subHeader = message.payload?.headers?.find(h => h.name.toLowerCase() === 'subject');
  return subHeader ? subHeader.value : '';
}

/**
 * Send an email via Gmail API.
 *
 * @param {object} opts
 * @param {string[]} opts.to - Recipient addresses
 * @param {string[]} opts.bcc - BCC addresses
 * @param {string} opts.subject
 * @param {string} opts.html - HTML body
 * @param {object} opts.headers - Additional headers (e.g. List-Unsubscribe)
 * @returns {Promise<object>} Send result
 */
export async function sendMessage({ to, bcc, subject, html, headers: extraHeaders }) {
  const fromAddr = getEnv('GMAIL_FROM');
  if (!fromAddr) throw new Error('GMAIL_FROM env var is required');

  // Validate subject against header injection
  const subjectCheck = validateEmailHeader(subject);
  if (!subjectCheck.valid) {
    throw new SecurityError(`Header injection in subject: ${subjectCheck.reason}`, 'SECURITY_HEADER_INJECTION');
  }

  // Validate all recipient addresses
  for (const addr of (to || [])) {
    const r = validateEmail(addr);
    if (!r.valid) throw new SecurityError(`Invalid To address: ${r.reason}`, 'SECURITY_HEADER_INJECTION');
  }
  for (const addr of (bcc || [])) {
    const r = validateEmail(addr);
    if (!r.valid) throw new SecurityError(`Invalid BCC address: ${r.reason}`, 'SECURITY_HEADER_INJECTION');
  }

  let rawHeaders = [
    `From: ${fromAddr}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/html; charset=utf-8`,
  ];

  if (to && to.length > 0) rawHeaders.push(`To: ${to.join(', ')}`);
  if (bcc && bcc.length > 0) rawHeaders.push(`Bcc: ${bcc.join(', ')}`);

  if (extraHeaders) {
    for (const [key, value] of Object.entries(extraHeaders)) {
      const keyCheck = validateEmailHeader(key);
      const valCheck = validateEmailHeader(value);
      if (!keyCheck.valid) throw new SecurityError(`Header injection in key "${key}": ${keyCheck.reason}`, 'SECURITY_HEADER_INJECTION');
      if (!valCheck.valid) throw new SecurityError(`Header injection in value for "${key}": ${valCheck.reason}`, 'SECURITY_HEADER_INJECTION');
      rawHeaders.push(`${key}: ${value}`);
    }
  }

  const raw = rawHeaders.join('\r\n') + '\r\n\r\n' + html;
  const encoded = Buffer.from(raw).toString('base64url');

  const res = await gmailRequest(`${GMAIL_API}/messages/send`, {
    method: 'POST',
    headers: authHeaders(),
    body: { raw: encoded },
    retries: 1,
  });

  return JSON.parse(res.body);
}

/**
 * Send to a list in BCC batches.
 *
 * @param {string[]} recipients - All recipient emails
 * @param {string} subject
 * @param {string} html
 * @param {object} extraHeaders
 * @param {number} batchSize - Max BCC per send (default 50)
 * @returns {Promise<{ sent: number, batches: number }>}
 */
export async function sendBatch(recipients, subject, html, extraHeaders = {}, batchSize = 50) {
  let sent = 0;
  let batches = 0;

  for (let i = 0; i < recipients.length; i += batchSize) {
    const batch = recipients.slice(i, i + batchSize);
    await sendMessage({
      to: [],
      bcc: batch,
      subject,
      html,
      headers: extraHeaders,
    });
    sent += batch.length;
    batches++;
  }

  return { sent, batches };
}

/**
 * Create a Gmail label. Returns the label object { id, name, ... }.
 * Skips if label already exists (returns existing).
 *
 * @param {string} name - Label display name
 * @returns {Promise<{id: string, name: string}>}
 */
export async function createLabel(name) {
  const res = await gmailRequest(`${GMAIL_API}/labels`, {
    method: 'POST',
    headers: authHeaders(),
    body: { name, labelListVisibility: 'labelShow', messageListVisibility: 'show' },
    retries: 1,
  });

  return JSON.parse(res.body);
}

/**
 * List all labels. Returns array of { id, name, type }.
 */
export async function listLabels() {
  const res = await gmailRequest(`${GMAIL_API}/labels`, {
    method: 'GET',
    headers: authHeaders(),
    retries: 1,
  });

  const data = JSON.parse(res.body);
  return data.labels || [];
}

/**
 * Find or create a label by name. Returns the label ID.
 *
 * @param {string} name - Label display name
 * @param {Array} existingLabels - Optional cached label list to avoid extra API call
 * @returns {Promise<string>} Label ID
 */
export async function findOrCreateLabel(name, existingLabels) {
  const labels = existingLabels || await listLabels();
  const existing = labels.find(l => l.name === name);
  if (existing) return existing.id;

  const created = await createLabel(name);
  return created.id;
}

/**
 * Modify labels on a message: add and/or remove labels.
 *
 * @param {string} messageId
 * @param {object} opts
 * @param {string[]} opts.addLabelIds - Labels to add
 * @param {string[]} opts.removeLabelIds - Labels to remove
 */
export async function modifyMessage(messageId, { addLabelIds = [], removeLabelIds = [] }) {
  await gmailRequest(`${GMAIL_API}/messages/${messageId}/modify`, {
    method: 'POST',
    headers: authHeaders(),
    body: { addLabelIds, removeLabelIds },
    retries: 1,
  });
}

/**
 * Batch modify up to 1000 messages at once.
 * WHY: Gmail allows modifying 1000 messages per call vs 1-at-a-time.
 *
 * @param {string[]} messageIds - Up to 1000 message IDs
 * @param {object} opts
 * @param {string[]} opts.addLabelIds
 * @param {string[]} opts.removeLabelIds
 */
export async function batchModifyMessages(messageIds, { addLabelIds = [], removeLabelIds = [] }) {
  await gmailRequest(`${GMAIL_API}/messages/batchModify`, {
    method: 'POST',
    headers: authHeaders(),
    body: { ids: messageIds, addLabelIds, removeLabelIds },
    retries: 1,
  });
}

/**
 * Archive a message (remove INBOX label).
 */
export async function archiveMessage(messageId) {
  await modifyMessage(messageId, { removeLabelIds: ['INBOX'] });
}

/**
 * Move a message to Promotions tab.
 */
export async function moveToPromotions(messageId) {
  await modifyMessage(messageId, { addLabelIds: ['CATEGORY_PROMOTIONS'] });
}

/**
 * Decode base64url string (Gmail's encoding)
 */
function decodeBase64Url(str) {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(base64, 'base64').toString('utf-8');
}
