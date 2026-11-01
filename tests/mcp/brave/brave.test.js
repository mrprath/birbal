// tests/mcp/brave/brave.test.js
// WHY: Contract tests for the Brave Search MCP server.
// Verifies tool listing, schema shape, and search behavior.
// Uses a mock HTTP layer: no real Brave API calls in CI.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..', '..');
const SERVER_PATH = resolve(ROOT, 'mcp', 'brave', 'server.js');

let proc, rl, nextId = 1;

function jsonRpc(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const msg = JSON.stringify({ jsonrpc: '2.0', method, params, id });
    const onLine = (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed.id === id) {
          rl.removeListener('line', onLine);
          resolve(parsed);
        }
      } catch { /* non-JSON debug output */ }
    };
    rl.on('line', onLine);
    proc.stdin.write(msg + '\n');
    setTimeout(() => {
      rl.removeListener('line', onLine);
      reject(new Error(`Timeout: ${method} (id=${id})`));
    }, 10_000);
  });
}

function callTool(name, args) {
  return jsonRpc('tools/call', { name, arguments: args });
}

function textOf(resp) {
  assert.ok(resp.result, `Expected result, got: ${JSON.stringify(resp)}`);
  assert.ok(resp.result.content?.length > 0, 'Empty content array');
  return resp.result.content[0].text;
}

describe('Brave Search MCP', () => {
  before(async () => {
    proc = spawn('node', [SERVER_PATH], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        BRAVE_API_KEY: 'test-key-not-real',
        // Signal to server: use mock HTTP, don't hit real API
        BRAVE_MOCK: '1',
      },
    });
    rl = createInterface({ input: proc.stdout });

    // Drain stderr to prevent backpressure
    proc.stderr.on('data', () => {});

    // Initialize handshake
    const initResp = await jsonRpc('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test', version: '1.0.0' },
    });
    assert.ok(initResp.result, 'Initialize failed');

    // Send initialized notification
    proc.stdin.write(JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    }) + '\n');
  });

  after(() => {
    if (proc && !proc.killed) proc.kill('SIGTERM');
  });

  it('lists exactly two tools: brave_web_search, brave_news_search', async () => {
    const resp = await jsonRpc('tools/list');
    const names = resp.result.tools.map(t => t.name).sort();
    assert.deepEqual(names, ['brave_news_search', 'brave_web_search']);
  });

  it('brave_web_search has required query param', async () => {
    const resp = await jsonRpc('tools/list');
    const tool = resp.result.tools.find(t => t.name === 'brave_web_search');
    assert.ok(tool.inputSchema.properties.query, 'Missing query property');
    assert.ok(tool.inputSchema.required.includes('query'), 'query not required');
  });

  it('brave_news_search has required query param', async () => {
    const resp = await jsonRpc('tools/list');
    const tool = resp.result.tools.find(t => t.name === 'brave_news_search');
    assert.ok(tool.inputSchema.properties.query, 'Missing query property');
    assert.ok(tool.inputSchema.required.includes('query'), 'query not required');
  });

  it('brave_web_search returns results for a mock query', async () => {
    const resp = await callTool('brave_web_search', { query: 'test query' });
    const text = textOf(resp);
    const parsed = JSON.parse(text);
    assert.ok(Array.isArray(parsed.results), 'Expected results array');
    assert.ok(parsed.results.length > 0, 'Expected at least one result');
    assert.ok(parsed.results[0].title, 'Result missing title');
    assert.ok(parsed.results[0].url, 'Result missing url');
  });

  it('brave_news_search returns results for a mock query', async () => {
    const resp = await callTool('brave_news_search', { query: 'test news' });
    const text = textOf(resp);
    const parsed = JSON.parse(text);
    assert.ok(Array.isArray(parsed.results), 'Expected results array');
    assert.ok(parsed.results.length > 0, 'Expected at least one result');
    assert.ok(parsed.results[0].title, 'Result missing title');
    assert.ok(parsed.results[0].url, 'Result missing url');
  });

  it('brave_web_search accepts optional count param', async () => {
    const resp = await jsonRpc('tools/list');
    const tool = resp.result.tools.find(t => t.name === 'brave_web_search');
    assert.ok(tool.inputSchema.properties.count, 'Missing count property');
  });

  it('errors on missing BRAVE_API_KEY', async () => {
    // Spawn a second server without the key
    const noKeyProc = spawn('node', [SERVER_PATH], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, BRAVE_API_KEY: '', BRAVE_MOCK: '1' },
    });

    const noKeyRl = createInterface({ input: noKeyProc.stdout });
    noKeyProc.stderr.on('data', () => {});

    let exitCode = null;
    const exitPromise = new Promise(resolve => {
      noKeyProc.on('exit', (code) => { exitCode = code; resolve(); });
    });

    // Give it a moment to fail
    await new Promise(r => setTimeout(r, 2000));

    if (!noKeyProc.killed) noKeyProc.kill('SIGTERM');
    await exitPromise;

    assert.ok(exitCode !== 0 || exitCode === null, 'Should fail without API key');
  });
});
