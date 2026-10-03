// tests/mcp/api-client.test.js — TDD
// Tests for mcp/api-client.js — one core HTTP function, thin wrappers
// Uses dependency injection (opts.requestFn) instead of ESM mock — ESM named exports are immutable.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { apiCall, apiGet, apiPost, apiPatch } from '../../mcp/api-client.js';

// Fake secureRequest: captures args, returns canned response
function fakeRequest(response) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url, opts });
    return response;
  };
  fn.calls = calls;
  return fn;
}

const inject = (requestFn) => ({ requestFn });

describe('apiCall', () => {
  it('sets Authorization Bearer header', async () => {
    const req = fakeRequest({ status: 200, headers: {}, body: '{}' });
    await apiCall('GET', 'https://api.github.com/user', 'my-token-123', undefined, inject(req));
    assert.equal(req.calls[0].opts.headers['Authorization'], 'Bearer my-token-123');
  });

  it('sets Accept application/json header', async () => {
    const req = fakeRequest({ status: 200, headers: {}, body: '{}' });
    await apiCall('GET', 'https://api.github.com/user', 'tok', undefined, inject(req));
    assert.equal(req.calls[0].opts.headers['Accept'], 'application/json');
  });

  it('passes body for POST', async () => {
    const req = fakeRequest({ status: 201, headers: {}, body: '{"id":1}' });
    await apiCall('POST', 'https://api.github.com/repos', 'tok', { name: 'repo' }, inject(req));
    assert.deepStrictEqual(req.calls[0].opts.body, { name: 'repo' });
  });

  it('parses JSON response body', async () => {
    const req = fakeRequest({ status: 200, headers: {}, body: '{"id":42,"name":"test"}' });
    const result = await apiCall('GET', 'https://api.github.com/user', 'tok', undefined, inject(req));
    assert.deepStrictEqual(result.data, { id: 42, name: 'test' });
    assert.equal(result.status, 200);
  });

  it('throws on non-2xx with status in error', async () => {
    const req = fakeRequest({ status: 404, headers: {}, body: '{"message":"Not Found"}' });
    await assert.rejects(
      () => apiCall('GET', 'https://api.github.com/repos/x', 'tok', undefined, inject(req)),
      (err) => {
        assert.equal(err.status, 404);
        assert.ok(err.message.includes('404'));
        return true;
      }
    );
  });

  it('throws with 401 status on auth failure', async () => {
    const req = fakeRequest({ status: 401, headers: {}, body: '{"message":"Bad credentials"}' });
    await assert.rejects(
      () => apiCall('GET', 'https://api.github.com/user', 'bad', undefined, inject(req)),
      (err) => {
        assert.equal(err.status, 401);
        return true;
      }
    );
  });

  it('returns null data for 204', async () => {
    const req = fakeRequest({ status: 204, headers: {}, body: '' });
    const result = await apiCall('DELETE', 'https://api.github.com/repos/x', 'tok', undefined, inject(req));
    assert.equal(result.status, 204);
    assert.equal(result.data, null);
  });

  it('calls the request function exactly once', async () => {
    const req = fakeRequest({ status: 200, headers: {}, body: '{}' });
    await apiCall('GET', 'https://api.github.com/user', 'tok', undefined, inject(req));
    assert.equal(req.calls.length, 1);
  });

  it('sets method in request options', async () => {
    const req = fakeRequest({ status: 200, headers: {}, body: '{}' });
    await apiCall('PATCH', 'https://api.github.com/user', 'tok', { bio: 'x' }, inject(req));
    assert.equal(req.calls[0].opts.method, 'PATCH');
  });
});

describe('thin wrappers', () => {
  it('apiGet calls with GET method', async () => {
    const req = fakeRequest({ status: 200, headers: {}, body: '{}' });
    await apiGet('https://api.github.com/user', 'tok', inject(req));
    assert.equal(req.calls[0].opts.method, 'GET');
  });

  it('apiPost calls with POST method and body', async () => {
    const req = fakeRequest({ status: 201, headers: {}, body: '{}' });
    await apiPost('https://api.github.com/repos', 'tok', { name: 'r' }, inject(req));
    assert.equal(req.calls[0].opts.method, 'POST');
    assert.deepStrictEqual(req.calls[0].opts.body, { name: 'r' });
  });

  it('apiPatch calls with PATCH method and body', async () => {
    const req = fakeRequest({ status: 200, headers: {}, body: '{}' });
    await apiPatch('https://api.github.com/repos/x', 'tok', { name: 'new' }, inject(req));
    assert.equal(req.calls[0].opts.method, 'PATCH');
  });
});
