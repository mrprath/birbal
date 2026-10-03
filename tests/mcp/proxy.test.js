// tests/mcp/proxy.test.js — TDD: RED first
// Tests for mcp/proxy.js — McpProxy supervising layer

import { describe, it, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { McpProxy, _testExports } from '../../mcp/proxy.js';

const { shouldRestart, backoffMs, parseJsonRpcLine, isToolsListResponse, injectRestartTool } = _testExports;

describe('shouldRestart', () => {
  it('allows restart when under cap', () => {
    assert.equal(shouldRestart([], 5, 60_000), true);
  });

  it('allows restart with fewer than max restarts', () => {
    const now = Date.now();
    const timestamps = [now - 10_000, now - 5_000];
    assert.equal(shouldRestart(timestamps, 5, 60_000), true);
  });

  it('denies restart when cap reached in window', () => {
    const now = Date.now();
    const timestamps = [now - 40_000, now - 30_000, now - 20_000, now - 10_000, now - 5_000];
    assert.equal(shouldRestart(timestamps, 5, 60_000), false);
  });

  it('allows restart after timestamps expire from window', () => {
    const now = Date.now();
    // All timestamps are older than 60s
    const timestamps = [now - 70_000, now - 65_000, now - 62_000, now - 61_000, now - 60_500];
    assert.equal(shouldRestart(timestamps, 5, 60_000), true);
  });
});

describe('backoffMs', () => {
  it('returns base for attempt 0', () => {
    assert.equal(backoffMs(0, 1_000, 30_000), 1_000);
  });

  it('doubles each attempt', () => {
    assert.equal(backoffMs(1, 1_000, 30_000), 2_000);
    assert.equal(backoffMs(2, 1_000, 30_000), 4_000);
    assert.equal(backoffMs(3, 1_000, 30_000), 8_000);
  });

  it('caps at max', () => {
    assert.equal(backoffMs(10, 1_000, 30_000), 30_000);
  });
});

describe('parseJsonRpcLine', () => {
  it('parses valid JSON-RPC', () => {
    const msg = parseJsonRpcLine('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}');
    assert.equal(msg.method, 'initialize');
    assert.equal(msg.id, 1);
  });

  it('returns null for invalid JSON', () => {
    assert.equal(parseJsonRpcLine('not json'), null);
  });

  it('returns null for empty string', () => {
    assert.equal(parseJsonRpcLine(''), null);
  });

  it('handles JSON-RPC responses (no method)', () => {
    const msg = parseJsonRpcLine('{"jsonrpc":"2.0","id":1,"result":{"tools":[]}}');
    assert.equal(msg.id, 1);
    assert.ok(msg.result);
  });
});

describe('isToolsListResponse', () => {
  it('detects tools/list response', () => {
    const msg = { jsonrpc: '2.0', id: 5, result: { tools: [] } };
    assert.equal(isToolsListResponse(msg), true);
  });

  it('rejects non-response', () => {
    const msg = { jsonrpc: '2.0', id: 5, method: 'tools/list' };
    assert.equal(isToolsListResponse(msg), false);
  });

  it('rejects response without tools array', () => {
    const msg = { jsonrpc: '2.0', id: 5, result: { data: 'other' } };
    assert.equal(isToolsListResponse(msg), false);
  });
});

describe('injectRestartTool', () => {
  it('appends _restart to tools list', () => {
    const msg = { jsonrpc: '2.0', id: 5, result: { tools: [{ name: 'echo' }] } };
    const injected = injectRestartTool(msg);
    const names = injected.result.tools.map(t => t.name);
    assert.ok(names.includes('_restart'));
    assert.ok(names.includes('echo'));
  });

  it('does not duplicate _restart', () => {
    const msg = { jsonrpc: '2.0', id: 5, result: { tools: [{ name: '_restart' }] } };
    const injected = injectRestartTool(msg);
    const restartCount = injected.result.tools.filter(t => t.name === '_restart').length;
    assert.equal(restartCount, 1);
  });
});

describe('McpProxy constructor', () => {
  it('accepts serverPath and options', () => {
    const proxy = new McpProxy('server.js', { maxRestarts: 3 });
    assert.ok(proxy);
  });
});
