// tests/mcp/integration.test.js — End-to-end MCP server tests
// Spawns the actual server as a child process, sends JSON-RPC over stdin,
// validates responses on stdout.
// WHY: Unit tests prove the pieces work. Integration tests prove they work together.

import { describe, it, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = resolve(__dirname, '..', '..', 'mcp', 'server.js');

let children = [];

function spawnServer() {
  // S15: array-form spawn
  const child = spawn('node', [SERVER_PATH], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  children.push(child);
  return child;
}

function sendJsonRpc(child, msg) {
  child.stdin.write(JSON.stringify(msg) + '\n');
}

/**
 * Read lines from child stdout until we get a JSON-RPC response matching the given id.
 * Times out after 5s.
 */
function waitForResponse(child, id, timeoutMs = 5_000) {
  return new Promise((resolve, reject) => {
    const rl = createInterface({ input: child.stdout });
    const timer = setTimeout(() => {
      rl.close();
      reject(new Error(`Timeout waiting for response id=${id}`));
    }, timeoutMs);

    rl.on('line', (line) => {
      try {
        const msg = JSON.parse(line);
        if (msg.id === id) {
          clearTimeout(timer);
          rl.close();
          resolve(msg);
        }
      } catch {
        // Not JSON, skip
      }
    });

    rl.on('close', () => {
      clearTimeout(timer);
    });
  });
}

afterEach(() => {
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM');
  }
  children = [];
});

describe('MCP Server Integration', () => {
  it('completes initialize handshake', async () => {
    const child = spawnServer();

    // Give server a moment to start
    await new Promise(r => setTimeout(r, 300));

    const initRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' },
      },
    };

    sendJsonRpc(child, initRequest);
    const response = await waitForResponse(child, 1);

    assert.equal(response.jsonrpc, '2.0');
    assert.equal(response.id, 1);
    assert.ok(response.result, 'Should have result');
    assert.ok(response.result.capabilities, 'Should have capabilities');
  });

  it('responds to tools/list with empty tools', async () => {
    const child = spawnServer();
    await new Promise(r => setTimeout(r, 300));

    // Initialize first
    sendJsonRpc(child, {
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1.0.0' } },
    });
    await waitForResponse(child, 1);

    // Send initialized notification
    sendJsonRpc(child, { jsonrpc: '2.0', method: 'notifications/initialized' });

    // Then list tools
    sendJsonRpc(child, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    const response = await waitForResponse(child, 2);

    assert.ok(response.result, 'Should have result');
    assert.ok(Array.isArray(response.result.tools), 'Should have tools array');
  });
});
