// tests/mcp/sanitize.test.js — TDD: RED first
// Tests for mcp/sanitize.js — PII stripping, noise removal, response pipeline

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { stripPii, stripNoise, sanitizeResponse } from '../../mcp/sanitize.js';

describe('stripPii', () => {
  it('redacts email addresses', () => {
    const result = stripPii('contact user@example.com now');
    assert.ok(result.includes('[PII_EMAIL]'));
    assert.ok(!result.includes('user@example.com'));
  });

  it('redacts multiple emails', () => {
    const result = stripPii('from a@b.com to c@d.org');
    assert.equal((result.match(/\[PII_EMAIL\]/g) || []).length, 2);
  });

  it('redacts US phone numbers', () => {
    const result = stripPii('call 555-123-4567 or 5551234567');
    assert.ok(result.includes('[PII_PHONE]'));
    assert.ok(!result.includes('555-123-4567'));
  });

  it('redacts SSNs', () => {
    const result = stripPii('ssn 123-45-6789 on file');
    assert.ok(result.includes('[PII_SSN]'));
    assert.ok(!result.includes('123-45-6789'));
  });

  it('preserves non-PII text', () => {
    assert.equal(stripPii('hello world'), 'hello world');
  });

  it('handles null/undefined gracefully', () => {
    assert.equal(stripPii(null), '');
    assert.equal(stripPii(undefined), '');
    assert.equal(stripPii(42), '');
  });
});

describe('stripNoise', () => {
  it('removes pagination metadata', () => {
    const obj = { name: 'test', next_cursor: 'abc', has_more: true, total_count: 42 };
    const result = stripNoise(obj);
    assert.equal(result.name, 'test');
    assert.equal(result.next_cursor, undefined);
    assert.equal(result.has_more, undefined);
    assert.equal(result.total_count, undefined);
  });

  it('removes rate limit fields', () => {
    const obj = { data: 'yes', 'x-ratelimit-remaining': 100, 'x-ratelimit-limit': 1000 };
    const result = stripNoise(obj);
    assert.equal(result.data, 'yes');
    assert.equal(result['x-ratelimit-remaining'], undefined);
  });

  it('removes etag and request-id', () => {
    const obj = { id: 1, etag: '"abc"', 'x-request-id': 'req-123', 'x-github-request-id': 'gh-456' };
    const result = stripNoise(obj);
    assert.equal(result.id, 1);
    assert.equal(result.etag, undefined);
    assert.equal(result['x-request-id'], undefined);
    assert.equal(result['x-github-request-id'], undefined);
  });

  it('preserves data fields', () => {
    const obj = { name: 'repo', id: 42, content: 'hello', description: 'a thing' };
    const result = stripNoise(obj);
    assert.deepStrictEqual(result, obj);
  });

  it('applies per-service strip lists', () => {
    const obj = { login: 'user', node_id: 'MDQ6VXNlcjE=', gravatar_id: '', events_url: 'https://...' };
    const result = stripNoise(obj, 'github');
    assert.equal(result.login, 'user');
    assert.equal(result.node_id, undefined);
    assert.equal(result.gravatar_id, undefined);
  });

  it('handles nested objects recursively', () => {
    const obj = { data: { name: 'test', next_cursor: 'abc' } };
    const result = stripNoise(obj);
    assert.equal(result.data.name, 'test');
    assert.equal(result.data.next_cursor, undefined);
  });

  it('handles arrays', () => {
    const arr = [{ name: 'a', etag: '"x"' }, { name: 'b', etag: '"y"' }];
    const result = stripNoise(arr);
    assert.equal(result.length, 2);
    assert.equal(result[0].name, 'a');
    assert.equal(result[0].etag, undefined);
  });

  it('returns primitives unchanged', () => {
    assert.equal(stripNoise('hello'), 'hello');
    assert.equal(stripNoise(42), 42);
    assert.equal(stripNoise(null), null);
  });
});

describe('sanitizeResponse', () => {
  it('strips PII from string values in objects', () => {
    const obj = { message: 'Contact user@example.com' };
    const result = sanitizeResponse(obj);
    const text = JSON.stringify(result);
    assert.ok(!text.includes('user@example.com'));
  });

  it('strips noise fields', () => {
    const obj = { name: 'test', etag: '"abc"', next_cursor: 'xyz' };
    const result = sanitizeResponse(obj);
    assert.equal(result.name, 'test');
    assert.equal(result.etag, undefined);
  });

  it('strips credential patterns via scrubSecrets', () => {
    const obj = { debug: 'Authorization: Bearer sk-secret123' };
    const result = sanitizeResponse(obj);
    const text = JSON.stringify(result);
    assert.ok(!text.includes('sk-secret123'));
  });

  it('returns null for null input', () => {
    assert.equal(sanitizeResponse(null), null);
    assert.equal(sanitizeResponse(undefined), null);
  });

  it('handles combined PII + noise + secrets', () => {
    const obj = {
      email: 'user@test.com',
      token: 'Bearer abc123',
      next_cursor: 'page2',
      real_data: 'keep this',
    };
    const result = sanitizeResponse(obj);
    assert.equal(result.real_data, 'keep this');
    assert.equal(result.next_cursor, undefined);
    // PII and secrets should be redacted in string values
    const text = JSON.stringify(result);
    assert.ok(!text.includes('user@test.com'));
  });
});
