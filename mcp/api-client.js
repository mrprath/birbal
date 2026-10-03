// mcp/api-client.js — One core HTTP function, thin method wrappers
// WHY separate from secureRequest: secureRequest is the transport layer (timeouts, retries, TLS).
// This module is the API-calling layer: auth headers, JSON parsing, status-to-error mapping.
// The layers talk through error messages — throw with .status so isAuthError() catches 401/403.

import { secureRequest } from '../lib/resilient-request.js';

/**
 * Core API call. Builds headers, calls secureRequest, parses response.
 * Throws with .status on non-2xx so TokenGuard.wrap()'s isAuthError() catches 401/403.
 *
 * @param {string} method - HTTP method
 * @param {string} url - Full URL (must be on allowlist via settings.json)
 * @param {string} token - Bearer token value (S6: never logged)
 * @param {object} [body] - Request body (for POST/PATCH/PUT)
 * @param {object} [opts] - Options
 * @param {function} [opts.requestFn] - Override request function (for testing)
 * @returns {Promise<{ status: number, data: any }>}
 */
export async function apiCall(method, url, token, body, opts = {}) {
  const doRequest = opts.requestFn || secureRequest;
  const headers = {
    'Authorization': 'Bearer ' + token,
    'Accept': 'application/json',
    'Content-Type': 'application/json',
  };

  const reqOpts = { method, headers, retries: 2 };
  if (body !== undefined) {
    reqOpts.body = body;
  }

  const result = await doRequest(url, reqOpts);

  // 204 No Content
  if (result.status === 204) {
    return { status: 204, data: null };
  }

  // 2xx — parse JSON
  if (result.status >= 200 && result.status < 300) {
    let data;
    try {
      data = JSON.parse(result.body);
    } catch {
      data = result.body; // Non-JSON 2xx (rare but possible)
    }
    return { status: result.status, data };
  }

  // Non-2xx — throw with .status for isAuthError() in token-validator
  const err = new Error(`API ${method} failed: HTTP ${result.status}`);
  err.status = result.status;
  throw err;
}

/** @param {string} url @param {string} token @param {object} [opts] */
export function apiGet(url, token, opts) {
  return apiCall('GET', url, token, undefined, opts);
}

/** @param {string} url @param {string} token @param {object} body @param {object} [opts] */
export function apiPost(url, token, body, opts) {
  return apiCall('POST', url, token, body, opts);
}

/** @param {string} url @param {string} token @param {object} body @param {object} [opts] */
export function apiPatch(url, token, body, opts) {
  return apiCall('PATCH', url, token, body, opts);
}
