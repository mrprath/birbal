// errors.test.js — Behavioral tests for lib/errors.js
// Spear works: instanceof chain, code + message, cause chains
// Bad spear: types are distinct, bad construction handled

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  BirbalError,
  SecurityError,
  AuthError,
  ValidationError,
  TransportError,
} from '../lib/errors.js';

describe('BirbalError — base', () => {
  it('is instanceof Error', () => {
    const err = new BirbalError('test', 'TEST_CODE');
    assert.ok(err instanceof Error);
    assert.ok(err instanceof BirbalError);
  });

  it('carries message and code', () => {
    const err = new BirbalError('something broke', 'BIRBAL_BROKEN');
    assert.equal(err.message, 'something broke');
    assert.equal(err.code, 'BIRBAL_BROKEN');
    assert.equal(err.name, 'BirbalError');
  });

  it('chains cause', () => {
    const original = new Error('root cause');
    const err = new BirbalError('wrapper', 'WRAP', { cause: original });
    assert.equal(err.cause, original);
    assert.equal(err.cause.message, 'root cause');
  });

  it('cause is undefined when not provided', () => {
    const err = new BirbalError('no cause', 'NC');
    assert.equal(err.cause, undefined);
  });
});

describe('SecurityError', () => {
  it('is instanceof BirbalError and Error', () => {
    const err = new SecurityError('tls disabled', 'SECURITY_TLS_DISABLED');
    assert.ok(err instanceof Error);
    assert.ok(err instanceof BirbalError);
    assert.ok(err instanceof SecurityError);
  });

  it('has name SecurityError', () => {
    const err = new SecurityError('x', 'X');
    assert.equal(err.name, 'SecurityError');
  });

  it('is NOT instanceof AuthError', () => {
    const err = new SecurityError('x', 'X');
    assert.ok(!(err instanceof AuthError));
  });
});

describe('AuthError', () => {
  it('is instanceof BirbalError and Error', () => {
    const err = new AuthError('token expired', 'AUTH_TOKEN_EXPIRED');
    assert.ok(err instanceof Error);
    assert.ok(err instanceof BirbalError);
    assert.ok(err instanceof AuthError);
  });

  it('has name AuthError', () => {
    assert.equal(new AuthError('x', 'X').name, 'AuthError');
  });

  it('is NOT instanceof SecurityError', () => {
    assert.ok(!(new AuthError('x', 'X') instanceof SecurityError));
  });
});

describe('ValidationError', () => {
  it('is instanceof BirbalError and Error', () => {
    const err = new ValidationError('bad input', 'VALIDATION_BAD_INPUT');
    assert.ok(err instanceof Error);
    assert.ok(err instanceof BirbalError);
    assert.ok(err instanceof ValidationError);
  });

  it('has name ValidationError', () => {
    assert.equal(new ValidationError('x', 'X').name, 'ValidationError');
  });
});

describe('TransportError', () => {
  it('is instanceof BirbalError and Error', () => {
    const err = new TransportError('timeout', 'TRANSPORT_TIMEOUT');
    assert.ok(err instanceof Error);
    assert.ok(err instanceof BirbalError);
    assert.ok(err instanceof TransportError);
  });

  it('has name TransportError', () => {
    assert.equal(new TransportError('x', 'X').name, 'TransportError');
  });

  it('chains cause from original network error', () => {
    const netErr = new Error('ECONNREFUSED');
    const err = new TransportError('connection failed', 'TRANSPORT_CONNECT', { cause: netErr });
    assert.equal(err.cause.message, 'ECONNREFUSED');
  });
});

describe('type distinctness', () => {
  it('all four types are distinct classes', () => {
    const s = new SecurityError('s', 'S');
    const a = new AuthError('a', 'A');
    const v = new ValidationError('v', 'V');
    const t = new TransportError('t', 'T');

    // Each is only its own type (plus BirbalError + Error)
    assert.ok(!(s instanceof AuthError));
    assert.ok(!(s instanceof ValidationError));
    assert.ok(!(s instanceof TransportError));
    assert.ok(!(a instanceof SecurityError));
    assert.ok(!(a instanceof ValidationError));
    assert.ok(!(a instanceof TransportError));
    assert.ok(!(v instanceof SecurityError));
    assert.ok(!(v instanceof AuthError));
    assert.ok(!(v instanceof TransportError));
    assert.ok(!(t instanceof SecurityError));
    assert.ok(!(t instanceof AuthError));
    assert.ok(!(t instanceof ValidationError));
  });

  it('catch block can distinguish types', () => {
    const err = new AuthError('expired', 'AUTH_EXPIRED');
    let caught = '';
    try {
      throw err;
    } catch (e) {
      if (e instanceof AuthError) caught = 'auth';
      else if (e instanceof SecurityError) caught = 'security';
      else caught = 'other';
    }
    assert.equal(caught, 'auth');
  });
});
