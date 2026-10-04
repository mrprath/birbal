// lib/secure-transport.js — TPS (Transport Protection System)
// DR-1: TLS certificate validation — hardcoded, no override
// DR-4: Single transport gate — the ONLY way to get an HTTPS agent
//
// WHY this file is small: TPS is a security primitive.
// It does ONE thing: rejectUnauthorized: true.
// Timeouts, retries, scrubbing — those are operational concerns, not TPS.
// They live in lib/resilient-request.js.

import https from 'node:https';
import { SecurityError } from './errors.js';

/**
 * DR-1: Check if TLS validation is globally disabled.
 * WHY a function: top-level process.exit() kills the test runner.
 * Callers (startup, import-time guard) call this and decide what to do.
 *
 * @returns {boolean} true if TLS is disabled (NODE_TLS_REJECT_UNAUTHORIZED=0)
 */
export function isTlsDisabled() {
  return process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0';
}

// DR-1: Refuse to start if TLS validation is globally disabled
// WHY: If this env var is set, every HTTPS call in the process is insecure.
// We kill the process because there is no safe state to fall back to.
if (isTlsDisabled()) {
  console.error(
    '[BIRBAL TPS] NODE_TLS_REJECT_UNAUTHORIZED=0 detected. ' +
    'Birbal refuses to start with TLS validation disabled. ' +
    'See SECURITY.md DR-1.'
  );
  process.exit(1);
}

/**
 * The TLS decision as a plain object.
 * WHY exported: other layers (token-guard, request) need TLS options
 * without creating a full Agent. This is the single source of that decision.
 * Nobody else hardcodes rejectUnauthorized — they call this.
 *
 * @returns {{ rejectUnauthorized: true }}
 */
export function getTlsOptions() {
  return { rejectUnauthorized: true };
}

/**
 * Create a secure HTTPS agent.
 * This is the ONLY way to get an agent for outbound calls.
 *
 * Uses getTlsOptions() internally — same decision, wrapped in an Agent.
 * Options can tune keepalive/sockets, but can NEVER override TLS validation.
 */
export function createSecureAgent(options = {}) {
  return new https.Agent({
    keepAlive: true,
    keepAliveMsecs: 10_000,
    maxSockets: 25,
    ...options,
    // DR-1: last property wins — even if options tries to override, we enforce
    ...getTlsOptions(),
  });
}
