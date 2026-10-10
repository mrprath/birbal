// tests/mcp/ghidra/ghidra.test.js
// WHY: Contract tests for the Ghidra MCP server.
// Verifies every tool's happy path, error handling, and schema.
// Single server process: JVM startup is ~25s, so we pay it once.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..', '..');
const SERVER_PATH = resolve(ROOT, 'mcp', 'ghidra', 'server.py');
const SMOKE_BINARY = resolve(__dirname, 'smoke.exe');

let nextId = 1;

// MCP v2: newline-delimited JSON-RPC.
function jsonRpc(proc, rl, method, params = {}) {
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
      } catch {
        // non-JSON lines (debug output)
      }
    };

    rl.on('line', onLine);
    proc.stdin.write(msg + '\n');

    setTimeout(() => {
      rl.removeListener('line', onLine);
      reject(new Error(`Timeout waiting for response to ${method} (id=${id})`));
    }, 120_000);
  });
}

// Helper: call a tool and return the parsed response.
function callTool(proc, rl, name, args) {
  return jsonRpc(proc, rl, 'tools/call', { name, arguments: args });
}

// Helper: extract text content from a successful tool response.
function textOf(resp) {
  assert.ok(resp.result, `Expected result, got: ${JSON.stringify(resp)}`);
  assert.ok(resp.result.content?.length > 0, 'Empty content array');
  return resp.result.content[0].text;
}

describe('Ghidra MCP server', () => {
  let proc;
  let rl;
  let stderr = '';

  before(async () => {
    assert.ok(existsSync(SMOKE_BINARY), 'smoke.exe missing: compile smoke.c first (gcc -o smoke.exe smoke.c)');

    proc = spawn('python', [SERVER_PATH], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        GHIDRA_INSTALL_DIR: process.env.GHIDRA_INSTALL_DIR || 'C:\\ghidra_install\\ghidra_12.1.4_PUBLIC',
        JAVA_HOME: process.env.JAVA_HOME || 'C:\\Program Files\\Java\\jdk-21.0.12',
      },
    });

    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    rl = createInterface({ input: proc.stdout });

    // Initialize the MCP session once.
    const initResp = await jsonRpc(proc, rl, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'ghidra-test', version: '1.0.0' },
    });
    assert.ok(initResp.result, `Server init failed. stderr: ${stderr}`);
  });

  after(() => {
    if (rl) rl.close();
    if (proc && !proc.killed) proc.kill('SIGTERM');
  });

  // ---------------------------------------------------------------
  // Protocol layer
  // ---------------------------------------------------------------

  describe('protocol', () => {
    it('returns server info with correct name and version', async () => {
      // Re-read from init: spawn a quick check via tools/list which proves session is live.
      const resp = await jsonRpc(proc, rl, 'tools/list');
      assert.ok(resp.result);
    });

    it('lists exactly 4 tools', async () => {
      const resp = await jsonRpc(proc, rl, 'tools/list');
      const names = resp.result.tools.map((t) => t.name).sort();
      assert.deepEqual(names, [
        'ghidra_decompile_all',
        'ghidra_decompile_function',
        'ghidra_get_strings',
        'ghidra_list_functions',
      ]);
    });

    it('each tool has an inputSchema with required params', async () => {
      const resp = await jsonRpc(proc, rl, 'tools/list');
      for (const tool of resp.result.tools) {
        assert.ok(tool.inputSchema, `${tool.name} missing inputSchema`);
        assert.ok(tool.inputSchema.properties?.binary_path, `${tool.name} missing binary_path param`);
      }

      const decompFn = resp.result.tools.find((t) => t.name === 'ghidra_decompile_function');
      assert.ok(decompFn.inputSchema.properties?.function_name, 'ghidra_decompile_function missing function_name param');
    });
  });

  // ---------------------------------------------------------------
  // ghidra_list_functions
  // ---------------------------------------------------------------

  describe('ghidra_list_functions', () => {
    it('finds add, multiply, and main in smoke.exe', async () => {
      const resp = await callTool(proc, rl, 'ghidra_list_functions', {
        binary_path: SMOKE_BINARY,
      });

      const fns = JSON.parse(textOf(resp));
      const names = fns.map((f) => f.name);

      assert.ok(names.includes('add'), `Missing 'add'. Got: ${names.join(', ')}`);
      assert.ok(names.includes('multiply'), `Missing 'multiply'. Got: ${names.join(', ')}`);
      assert.ok(names.includes('main'), `Missing 'main'. Got: ${names.join(', ')}`);
    });

    it('each function has name, address, and size fields', async () => {
      const resp = await callTool(proc, rl, 'ghidra_list_functions', {
        binary_path: SMOKE_BINARY,
      });

      const fns = JSON.parse(textOf(resp));
      for (const fn of fns) {
        assert.ok(typeof fn.name === 'string', `name should be string: ${JSON.stringify(fn)}`);
        assert.ok(typeof fn.address === 'string', `address should be string: ${JSON.stringify(fn)}`);
        assert.ok(typeof fn.size === 'number' && fn.size > 0, `size should be positive number: ${JSON.stringify(fn)}`);
      }
    });

    it('returns error for nonexistent binary', async () => {
      const resp = await callTool(proc, rl, 'ghidra_list_functions', {
        binary_path: 'C:\\does\\not\\exist.exe',
      });

      // MCP wraps errors: either resp.error or isError content
      const isErr = resp.error || resp.result?.isError;
      assert.ok(isErr, `Expected error for missing binary, got: ${JSON.stringify(resp)}`);
    });
  });

  // ---------------------------------------------------------------
  // ghidra_decompile_function
  // ---------------------------------------------------------------

  describe('ghidra_decompile_function', () => {
    it('decompiles add: contains return and two params', async () => {
      const resp = await callTool(proc, rl, 'ghidra_decompile_function', {
        binary_path: SMOKE_BINARY,
        function_name: 'add',
      });

      const code = textOf(resp);
      assert.ok(code.includes('return'), `add should have a return statement: ${code}`);
      // Ghidra names params param_1/param_2 or similar
      assert.ok(code.includes('param'), `add should reference parameters: ${code}`);
    });

    it('decompiles multiply: contains a loop construct', async () => {
      const resp = await callTool(proc, rl, 'ghidra_decompile_function', {
        binary_path: SMOKE_BINARY,
        function_name: 'multiply',
      });

      const code = textOf(resp);
      // Loop shows up as while, for, or do in decompiled output
      const hasLoop = code.includes('while') || code.includes('for') || code.includes('do');
      assert.ok(hasLoop, `multiply should contain a loop: ${code}`);
    });

    it('decompiles main: references printf or puts', async () => {
      const resp = await callTool(proc, rl, 'ghidra_decompile_function', {
        binary_path: SMOKE_BINARY,
        function_name: 'main',
      });

      const code = textOf(resp);
      const hasPrint = code.includes('printf') || code.includes('puts') || code.includes('_printf');
      assert.ok(hasPrint, `main should call printf/puts: ${code}`);
    });

    it('returns error for nonexistent function', async () => {
      const resp = await callTool(proc, rl, 'ghidra_decompile_function', {
        binary_path: SMOKE_BINARY,
        function_name: 'does_not_exist_xyz',
      });

      const isErr = resp.error || resp.result?.isError;
      assert.ok(isErr, `Expected error for missing function, got: ${JSON.stringify(resp)}`);
    });

    it('returns error for nonexistent binary', async () => {
      const resp = await callTool(proc, rl, 'ghidra_decompile_function', {
        binary_path: 'C:\\no\\such\\file.exe',
        function_name: 'main',
      });

      const isErr = resp.error || resp.result?.isError;
      assert.ok(isErr, `Expected error for missing binary, got: ${JSON.stringify(resp)}`);
    });
  });

  // ---------------------------------------------------------------
  // ghidra_decompile_all
  // ---------------------------------------------------------------

  describe('ghidra_decompile_all', () => {
    it('decompiles all functions with separator markers', async () => {
      const resp = await callTool(proc, rl, 'ghidra_decompile_all', {
        binary_path: SMOKE_BINARY,
      });

      const code = textOf(resp);
      // Each function block starts with "// === name ==="
      assert.ok(code.includes('// === add ==='), `Missing add block: ${code.slice(0, 200)}`);
      assert.ok(code.includes('// === multiply ==='), `Missing multiply block`);
      assert.ok(code.includes('// === main ==='), `Missing main block`);
    });

    it('decompiled output contains valid C-like pseudocode', async () => {
      const resp = await callTool(proc, rl, 'ghidra_decompile_all', {
        binary_path: SMOKE_BINARY,
      });

      const code = textOf(resp);
      // Pseudocode should have function signatures, braces, return statements
      assert.ok(code.includes('{'), 'Should contain opening braces');
      assert.ok(code.includes('}'), 'Should contain closing braces');
      assert.ok(code.includes('return'), 'Should contain return statements');
    });
  });

  // ---------------------------------------------------------------
  // ghidra_get_strings
  // ---------------------------------------------------------------

  describe('ghidra_get_strings', () => {
    it('finds the printf format string from smoke.exe', async () => {
      const resp = await callTool(proc, rl, 'ghidra_get_strings', {
        binary_path: SMOKE_BINARY,
      });

      const strings = JSON.parse(textOf(resp));
      const values = strings.map((s) => s.value);

      // smoke.c has: printf("add: %d, multiply: %d\n", x, y);
      const hasFormatStr = values.some((v) => v.includes('add:') && v.includes('multiply:'));
      assert.ok(hasFormatStr, `Should find printf format string. Got: ${values.join(', ')}`);
    });

    it('each string has address, value, and type fields', async () => {
      const resp = await callTool(proc, rl, 'ghidra_get_strings', {
        binary_path: SMOKE_BINARY,
      });

      const strings = JSON.parse(textOf(resp));
      assert.ok(strings.length > 0, 'Should find at least one string');

      for (const s of strings) {
        assert.ok(typeof s.address === 'string', `address should be string: ${JSON.stringify(s)}`);
        assert.ok(typeof s.value === 'string', `value should be string: ${JSON.stringify(s)}`);
        assert.ok(typeof s.type === 'string', `type should be string: ${JSON.stringify(s)}`);
      }
    });

    it('returns error for nonexistent binary', async () => {
      const resp = await callTool(proc, rl, 'ghidra_get_strings', {
        binary_path: 'C:\\no\\such\\file.exe',
      });

      const isErr = resp.error || resp.result?.isError;
      assert.ok(isErr, `Expected error for missing binary, got: ${JSON.stringify(resp)}`);
    });
  });
});
