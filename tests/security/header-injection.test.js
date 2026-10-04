// Header injection tests -- CRLF rejection in email fields
// WHY: sendMessage() builds raw MIME headers by string interpolation.
// A \r\n in subject, To, BCC, or extraHeaders splits headers and lets
// an attacker inject arbitrary headers (e.g. Bcc: attacker@evil.com).
// Phase 0 of newsletter v2.0 plan.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { validateEmailHeader } from '../../lib/validate.js';

describe('validateEmailHeader', () => {
  it('accepts clean header value', () => {
    const r = validateEmailHeader('normal subject line');
    assert.ok(r.valid);
    assert.equal(r.value, 'normal subject line');
  });

  it('accepts header with special chars but no CRLF', () => {
    const r = validateEmailHeader('Re: [urgent] hello! @#$%');
    assert.ok(r.valid);
  });

  it('rejects \\r\\n (CRLF injection)', () => {
    const r = validateEmailHeader('Subject\r\nBcc: attacker@evil.com');
    assert.ok(!r.valid);
    assert.match(r.reason, /CRLF/i);
  });

  it('rejects bare \\n (LF injection)', () => {
    const r = validateEmailHeader('Subject\nBcc: attacker@evil.com');
    assert.ok(!r.valid);
  });

  it('rejects bare \\r (CR injection)', () => {
    const r = validateEmailHeader('value\rwith CR');
    assert.ok(!r.valid);
  });

  it('rejects null byte', () => {
    const r = validateEmailHeader('value\x00with null');
    assert.ok(!r.valid);
  });

  it('rejects non-string', () => {
    assert.ok(!validateEmailHeader(42).valid);
    assert.ok(!validateEmailHeader(null).valid);
    assert.ok(!validateEmailHeader(undefined).valid);
  });

  it('rejects empty string', () => {
    assert.ok(!validateEmailHeader('').valid);
  });

  it('rejects header key with CRLF', () => {
    const r = validateEmailHeader('X-Custom\r\nBcc');
    assert.ok(!r.valid);
  });

  // Real attack vectors
  it('rejects BCC injection via subject', () => {
    const r = validateEmailHeader('Hello\r\nBcc: spy@evil.com\r\n');
    assert.ok(!r.valid);
  });

  it('rejects Content-Type override injection', () => {
    const r = validateEmailHeader('text\r\nContent-Type: multipart/mixed');
    assert.ok(!r.valid);
  });
});
