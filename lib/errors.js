// lib/errors.js — Shared typed errors for the Birbal spine
// WHY: Raw `new Error('...')` gives you a string. Typed errors give you a
// machine-readable `code` and an instanceof check. Error contracts become testable.
// A catch block can distinguish AuthError from TransportError without parsing messages.

/**
 * Base error for all Birbal spine errors.
 * Every typed error extends this, so `instanceof BirbalError` catches them all.
 *
 * @param {string} message - Human-readable description
 * @param {string} code - Machine-readable error code (e.g. 'SECURITY_TLS_DISABLED')
 * @param {object} [options]
 * @param {Error} [options.cause] - The original error that caused this one
 */
export class BirbalError extends Error {
  constructor(message, code, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'BirbalError';
    this.code = code;
  }
}

/**
 * TLS bypass, injection attempt, credential exposure.
 * Thrown by secure-transport.js, env.js, validate.js.
 */
export class SecurityError extends BirbalError {
  constructor(message, code, options = {}) {
    super(message, code, options);
    this.name = 'SecurityError';
  }
}

/**
 * Token missing, expired, rejected by API.
 * Thrown by token-validator.js.
 */
export class AuthError extends BirbalError {
  constructor(message, code, options = {}) {
    super(message, code, options);
    this.name = 'AuthError';
  }
}

/**
 * Input validation failure — bad format, out of range, injection detected.
 * Thrown by validate.js, resilient-request.js (URL validation).
 */
export class ValidationError extends BirbalError {
  constructor(message, code, options = {}) {
    super(message, code, options);
    this.name = 'ValidationError';
  }
}

/**
 * Network failure, timeout, retry exhaustion.
 * Thrown by resilient-request.js.
 */
export class TransportError extends BirbalError {
  constructor(message, code, options = {}) {
    super(message, code, options);
    this.name = 'TransportError';
  }
}
