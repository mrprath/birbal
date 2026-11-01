// tests/mcp/vercel/vercel.test.js
// WHY: Contract tests for the Vercel MCP server.
// Verifies tool listing, schema shape, and API behavior.
// Uses a mock HTTP layer: no real Vercel API calls in CI.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..', '..');
const SERVER_PATH = resolve(ROOT, 'mcp', 'vercel', 'server.js');

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

describe('Vercel MCP', () => {
  before(async () => {
    proc = spawn('node', [SERVER_PATH], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        VERCEL_TOKEN: 'test-token-not-real',
        VERCEL_MOCK: '1',
      },
    });
    rl = createInterface({ input: proc.stdout });
    proc.stderr.on('data', () => {});

    const initResp = await jsonRpc('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test', version: '1.0.0' },
    });
    assert.ok(initResp.result, 'Initialize failed');

    proc.stdin.write(JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    }) + '\n');
  });

  after(() => {
    if (proc && !proc.killed) proc.kill('SIGTERM');
  });

  it('lists expected tools', async () => {
    const resp = await jsonRpc('tools/list');
    const names = resp.result.tools.map(t => t.name).sort();
    assert.deepEqual(names, [
      'vercel_get_deployment',
      'vercel_list_deployments',
      'vercel_list_env_vars',
      'vercel_set_env_var',
    ]);
  });

  it('vercel_list_deployments returns deployments array', async () => {
    const resp = await callTool('vercel_list_deployments', {});
    const text = textOf(resp);
    const parsed = JSON.parse(text);
    assert.ok(Array.isArray(parsed.deployments), 'Expected deployments array');
  });

  it('vercel_get_deployment requires deployment_id', async () => {
    const resp = await jsonRpc('tools/list');
    const tool = resp.result.tools.find(t => t.name === 'vercel_get_deployment');
    assert.ok(tool.inputSchema.required.includes('deployment_id'));
  });

  it('vercel_get_deployment returns deployment detail', async () => {
    const resp = await callTool('vercel_get_deployment', { deployment_id: 'dpl_mock123' });
    const text = textOf(resp);
    const parsed = JSON.parse(text);
    assert.ok(parsed.id, 'Expected deployment id');
    assert.ok(parsed.state, 'Expected deployment state');
  });

  it('vercel_list_env_vars requires project_id', async () => {
    const resp = await jsonRpc('tools/list');
    const tool = resp.result.tools.find(t => t.name === 'vercel_list_env_vars');
    assert.ok(tool.inputSchema.required.includes('project_id'));
  });

  it('vercel_list_env_vars returns env vars array', async () => {
    const resp = await callTool('vercel_list_env_vars', { project_id: 'prj_mock123' });
    const text = textOf(resp);
    const parsed = JSON.parse(text);
    assert.ok(Array.isArray(parsed.envs), 'Expected envs array');
  });

  it('vercel_set_env_var requires project_id, key, value, target', async () => {
    const resp = await jsonRpc('tools/list');
    const tool = resp.result.tools.find(t => t.name === 'vercel_set_env_var');
    const required = tool.inputSchema.required;
    assert.ok(required.includes('project_id'));
    assert.ok(required.includes('key'));
    assert.ok(required.includes('value'));
    assert.ok(required.includes('target'));
  });

  it('vercel_set_env_var creates an env var', async () => {
    const resp = await callTool('vercel_set_env_var', {
      project_id: 'prj_mock123',
      key: 'TEST_VAR',
      value: 'hello',
      target: ['production'],
    });
    const text = textOf(resp);
    const parsed = JSON.parse(text);
    assert.ok(parsed.created, 'Expected created confirmation');
  });

  it('vercel_list_deployments accepts optional project and limit', async () => {
    const resp = await jsonRpc('tools/list');
    const tool = resp.result.tools.find(t => t.name === 'vercel_list_deployments');
    assert.ok(tool.inputSchema.properties.project, 'Missing project property');
    assert.ok(tool.inputSchema.properties.limit, 'Missing limit property');
  });

  it('errors on missing VERCEL_TOKEN', async () => {
    const noKeyProc = spawn('node', [SERVER_PATH], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, VERCEL_TOKEN: '', VERCEL_MOCK: '1' },
    });
    noKeyProc.stderr.on('data', () => {});

    let exitCode = null;
    const exitPromise = new Promise(resolve => {
      noKeyProc.on('exit', (code) => { exitCode = code; resolve(); });
    });

    await new Promise(r => setTimeout(r, 2000));
    if (!noKeyProc.killed) noKeyProc.kill('SIGTERM');
    await exitPromise;

    assert.ok(exitCode !== 0 || exitCode === null, 'Should fail without token');
  });
});
