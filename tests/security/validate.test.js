// Validate module tests — injection defense (DR-5, DR-9) + URL allowlist (DR-7)
// WHY: If these validators miss something, injection is possible.
// Every pattern tested here represents a real attack vector.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { validateEmail, validateSafeInput, validateUrl } from '../../lib/validate.js';

describe('validateEmail', () => {
  it('accepts valid email', () => {
    const r = validateEmail('user@example.com');
    assert.ok(r.valid);
    assert.equal(r.email, 'user@example.com');
  });

  it('trims whitespace', () => {
    const r = validateEmail('  user@example.com  ');
    assert.equal(r.email, 'user@example.com');
  });

  it('rejects non-string', () => {
    assert.ok(!validateEmail(42).valid);
    assert.ok(!validateEmail(null).valid);
    assert.ok(!validateEmail(undefined).valid);
  });

  it('rejects empty string', () => {
    assert.ok(!validateEmail('').valid);
    assert.ok(!validateEmail('   ').valid);
  });

  it('rejects missing @', () => {
    assert.ok(!validateEmail('userexample.com').valid);
  });

  it('rejects missing domain', () => {
    assert.ok(!validateEmail('user@').valid);
  });

  it('rejects missing TLD', () => {
    assert.ok(!validateEmail('user@example').valid);
  });

  it('rejects injection attempt — shell escape', () => {
    assert.ok(!validateEmail("'; rm -rf /;'@evil.com").valid);
  });

  it('rejects injection attempt — JS interpolation', () => {
    assert.ok(!validateEmail("user@ex.com\n'; process.exit();//").valid);
  });

  it('rejects oversized email (>254 chars)', () => {
    const long = 'a'.repeat(250) + '@b.co';
    assert.ok(!validateEmail(long).valid);
    assert.ok(validateEmail(long).reason.includes('254'));
  });
});

describe('validateSafeInput', () => {
  it('accepts normal text', () => {
    const r = validateSafeInput('Hello, world!');
    assert.ok(r.valid);
    assert.equal(r.sanitized, 'Hello, world!');
  });

  it('trims whitespace', () => {
    const r = validateSafeInput('  hello  ');
    assert.equal(r.sanitized, 'hello');
  });

  it('rejects non-string', () => {
    assert.ok(!validateSafeInput(123).valid);
    assert.ok(!validateSafeInput(null).valid);
  });

  it('rejects empty string', () => {
    assert.ok(!validateSafeInput('').valid);
  });

  it('rejects null bytes', () => {
    assert.ok(!validateSafeInput('hello\x00world').valid);
    assert.ok(validateSafeInput('hello\x00world').reason.includes('control'));
  });

  it('rejects control characters', () => {
    assert.ok(!validateSafeInput('hello\x07world').valid); // bell
    assert.ok(!validateSafeInput('hello\x1Bworld').valid); // escape
  });

  it('rejects unicode direction overrides', () => {
    assert.ok(!validateSafeInput('hello\u202Eworld').valid); // RLO
    assert.ok(!validateSafeInput('hello\u200Fworld').valid); // RLM
  });

  it('allows newlines and tabs (they are not control chars we block)', () => {
    assert.ok(validateSafeInput('line1\nline2').valid);
    assert.ok(validateSafeInput('col1\tcol2').valid);
  });

  it('rejects oversized input', () => {
    const long = 'a'.repeat(10_001);
    assert.ok(!validateSafeInput(long).valid);
  });

  it('respects custom maxLength', () => {
    assert.ok(!validateSafeInput('hello', { maxLength: 3 }).valid);
    assert.ok(validateSafeInput('hi', { maxLength: 3 }).valid);
  });
});

describe('validateUrl — DR-7 allowlist enforcement', () => {
  // These tests rely on settings.json containing the real allowlist:
  // https://api.github.com, https://api.notion.com, https://api.substack.com, https://api.typesafe.ai

  it('accepts allowed URL', () => {
    const r = validateUrl('https://api.github.com/repos/prathcoding/birbal');
    assert.ok(r.valid);
    assert.equal(r.url, 'https://api.github.com/repos/prathcoding/birbal');
  });

  it('accepts all allowlisted origins', () => {
    assert.ok(validateUrl('https://api.notion.com/v1/pages').valid);
    assert.ok(validateUrl('https://api.substack.com/feed').valid);
    assert.ok(validateUrl('https://api.typesafe.ai/v1/score').valid);
  });

  it('rejects URL not on allowlist', () => {
    const r = validateUrl('https://evil.com/steal-creds');
    assert.ok(!r.valid);
    assert.ok(r.reason.includes('not in allowed URLs'));
  });

  it('rejects subdomain spoofing — api.github.com.evil.com', () => {
    // WHY: prefix matching would pass this. Origin matching blocks it.
    const r = validateUrl('https://api.github.com.evil.com/repos');
    assert.ok(!r.valid);
  });

  it('rejects HTTP (even if host is allowed)', () => {
    const r = validateUrl('http://api.github.com/repos');
    assert.ok(!r.valid);
    assert.ok(r.reason.includes('HTTPS'));
  });

  it('rejects non-string', () => {
    assert.ok(!validateUrl(42).valid);
    assert.ok(!validateUrl(null).valid);
  });

  it('rejects invalid URL', () => {
    assert.ok(!validateUrl('not-a-url').valid);
    assert.ok(validateUrl('not-a-url').reason.includes('invalid'));
  });

  it('rejects empty string', () => {
    // Empty string is technically an invalid URL
    const r = validateUrl('');
    assert.ok(!r.valid);
  });
});
