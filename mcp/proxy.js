// mcp/proxy.js — Supervising Proxy (the survival layer)
// WHY: The MCP protocol has no built-in restart for stdio transports.
// This proxy holds the client's stdio pipe open for the entire session,
// spawns the tool server as a child, caches the handshake, and auto-restarts
// on crash. The client never knows the server died.
//
// S15: spawn with array args, no shell.
// stdout is sacred — JSON-RPC only. All diagnostics go to stderr.

import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- Pure helper functions (exported for testing) ---

/**
 * Check if a restart is allowed given the timestamps of recent restarts.
 * @param {number[]} timestamps - Date.now() of each recent restart
 * @param {number} maxRestarts - Max allowed in window
 * @param {number} windowMs - Time window in ms
 * @returns {boolean}
 */
function shouldRestart(timestamps, maxRestarts, windowMs) {
  const now = Date.now();
  const recent = timestamps.filter(t => now - t < windowMs);
  return recent.length < maxRestarts;
}

/**
 * Exponential backoff with cap.
 * @param {number} attempt - 0-indexed attempt number
 * @param {number} base - Base delay in ms
 * @param {number} max - Max delay in ms
 * @returns {number}
 */
function backoffMs(attempt, base, max) {
  return Math.min(base * Math.pow(2, attempt), max);
}

/**
 * Parse a line as JSON-RPC. Returns null if invalid.
 */
function parseJsonRpcLine(line) {
  if (!line || !line.trim()) return null;
  try {
    return JSON.parse(line.trim());
  } catch {
    return null;
  }
}

/**
 * Detect if a message is a tools/list response.
 * WHY: The proxy needs to inject _restart into the tool list.
 */
function isToolsListResponse(msg) {
  return !!(msg && msg.result && Array.isArray(msg.result.tools) && !msg.method);
}

/**
 * Inject the _restart synthetic tool into a tools/list response.
 */
function injectRestartTool(msg) {
  const tools = msg.result.tools;
  if (!tools.some(t => t.name === '_restart')) {
    tools.push({
      name: '_restart',
      description: 'Hot-reload server code (restarts the tool server process without losing session)',
      inputSchema: { type: 'object', properties: {}, required: [] },
    });
  }
  return msg;
}

// Synthetic _restart tool definition
const RESTART_TOOL = {
  name: '_restart',
  description: 'Hot-reload server code (restarts the tool server process without losing session)',
  inputSchema: { type: 'object', properties: {}, required: [] },
};

export class McpProxy {
  /**
   * @param {string} serverPath - Path to mcp/server.js
   * @param {object} [options]
   * @param {number} [options.maxRestarts=5]
   * @param {number} [options.restartWindow=60000]
   * @param {number} [options.backoffBase=1000]
   * @param {number} [options.backoffMax=30000]
   * @param {function} [options.delay] - Injectable timer (for testing)
   */
  constructor(serverPath, options = {}) {
    this._serverPath = serverPath;
    this._maxRestarts = options.maxRestarts ?? 5;
    this._restartWindow = options.restartWindow ?? 60_000;
    this._backoffBase = options.backoffBase ?? 1_000;
    this._backoffMax = options.backoffMax ?? 30_000;
    this._delay = options.delay || (ms => new Promise(r => setTimeout(r, ms)));

    this._child = null;
    this._cachedInitialize = null;  // The initialize request from client
    this._cachedInitResponse = null; // The initialize response from server
    this._restartTimestamps = [];
    this._pendingRequests = new Map(); // id -> { resolve, reject } for _restart
    this._toolsListRequestIds = new Set(); // track tools/list request IDs
    this._stopping = false;
    this._restarting = false; // true during manual _restart to suppress auto-restart
    this._childReady = false;
  }

  /**
   * Start the proxy: begin reading client stdin and spawn the child server.
   */
  async start() {
    this._spawnChild();
    this._readClientInput();
    process.stderr.write('[BIRBAL PROXY] Proxy started\n');
  }

  /**
   * Stop the proxy and kill the child.
   */
  stop() {
    this._stopping = true;
    if (this._child && !this._child.killed) {
      this._child.kill('SIGTERM');
    }
  }

  /**
   * Spawn the child server process.
   * S15: array-form spawn, no shell.
   */
  _spawnChild() {
    // S15: spawn with array args — no shell interpolation
    this._child = spawn('node', [this._serverPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    this._childReady = false;

    // Child stdout -> parse and route to client
    const childRl = createInterface({ input: this._child.stdout });
    childRl.on('line', (line) => this._onChildOutput(line));

    // Child stderr -> parent stderr (diagnostics)
    this._child.stderr.on('data', (data) => {
      process.stderr.write(data);
    });

    // Child exit -> restart logic
    this._child.on('exit', (code, signal) => {
      if (this._stopping) return;
      process.stderr.write(
        `[BIRBAL PROXY] Child exited: code=${code} signal=${signal}\n`
      );
      this._onChildExit();
    });

    this._child.on('error', (err) => {
      process.stderr.write(`[BIRBAL PROXY] Child error: ${err.message}\n`);
    });
  }

  /**
   * Read JSON-RPC messages from client stdin, intercept _restart, forward rest to child.
   */
  _readClientInput() {
    const rl = createInterface({ input: process.stdin });

    rl.on('line', (line) => {
      const msg = parseJsonRpcLine(line);
      if (!msg) return;

      // Cache initialize request
      if (msg.method === 'initialize') {
        this._cachedInitialize = msg;
      }

      // Track tools/list request IDs so we know which responses to inject _restart into
      if (msg.method === 'tools/list') {
        this._toolsListRequestIds.add(msg.id);
      }

      // Intercept _restart tool call
      if (msg.method === 'tools/call' && msg.params && msg.params.name === '_restart') {
        this._handleRestart(msg.id);
        return;
      }

      // Forward everything else to child
      this._writeToChild(line);
    });

    rl.on('close', () => {
      this.stop();
    });
  }

  /**
   * Handle output from child — route to client stdout, inject _restart into tool lists.
   */
  _onChildOutput(line) {
    const msg = parseJsonRpcLine(line);

    if (msg) {
      // Cache initialize response
      if (msg.id && this._cachedInitialize && msg.id === this._cachedInitialize.id && msg.result) {
        this._cachedInitResponse = msg;
        this._childReady = true;
      }

      // Inject _restart into tools/list responses
      if (isToolsListResponse(msg) && this._toolsListRequestIds.has(msg.id)) {
        this._toolsListRequestIds.delete(msg.id);
        const injected = injectRestartTool(msg);
        process.stdout.write(JSON.stringify(injected) + '\n');
        return;
      }
    }

    // Passthrough — forward to client as-is
    process.stdout.write(line + '\n');
  }

  /**
   * Handle the _restart synthetic tool call.
   * Kill child, respawn, replay handshake, respond success.
   */
  async _handleRestart(requestId) {
    process.stderr.write('[BIRBAL PROXY] _restart requested\n');

    // WHY: killing the child fires its `exit` event, which triggers _onChildExit.
    // Without this flag, _onChildExit races to spawn a second child and burns
    // through _restartTimestamps, eventually hitting the cap and process.exit(1).
    this._restarting = true;

    // Kill current child
    if (this._child && !this._child.killed) {
      this._child.kill('SIGTERM');
    }

    // Wait a beat for clean shutdown
    await this._delay(200);

    // Spawn new child
    this._spawnChild();

    // Replay cached initialize if we have one
    if (this._cachedInitialize) {
      this._writeToChild(JSON.stringify(this._cachedInitialize));
      // Wait for child to respond to initialize
      await this._delay(500);
    }

    // Respond to the client's _restart call
    const response = {
      jsonrpc: '2.0',
      id: requestId,
      result: {
        content: [{ type: 'text', text: 'Server restarted successfully. New tools will appear in the next tools/list call.' }],
      },
    };
    process.stdout.write(JSON.stringify(response) + '\n');

    // Notify client that tool list may have changed
    const notification = {
      jsonrpc: '2.0',
      method: 'notifications/tools/list_changed',
    };
    process.stdout.write(JSON.stringify(notification) + '\n');

    this._restarting = false;
  }

  /**
   * Auto-restart logic on child crash.
   */
  async _onChildExit() {
    if (this._stopping || this._restarting) return;

    if (!shouldRestart(this._restartTimestamps, this._maxRestarts, this._restartWindow)) {
      process.stderr.write(
        `[BIRBAL PROXY] Restart cap reached (${this._maxRestarts} in ${this._restartWindow / 1000}s). Giving up.\n`
      );
      process.exit(1);
    }

    this._restartTimestamps.push(Date.now());
    const attempt = this._restartTimestamps.filter(
      t => Date.now() - t < this._restartWindow
    ).length - 1;
    const delay = backoffMs(attempt, this._backoffBase, this._backoffMax);

    process.stderr.write(
      `[BIRBAL PROXY] Restarting child in ${delay}ms (attempt ${attempt + 1})\n`
    );

    await this._delay(delay);

    if (this._stopping) return;

    this._spawnChild();

    // Replay cached initialize
    if (this._cachedInitialize) {
      this._writeToChild(JSON.stringify(this._cachedInitialize));
    }

    // Notify client that tools may have changed
    const notification = {
      jsonrpc: '2.0',
      method: 'notifications/tools/list_changed',
    };
    process.stdout.write(JSON.stringify(notification) + '\n');
  }

  /**
   * Write a line to the child's stdin. Safe if child is dead.
   */
  _writeToChild(line) {
    if (this._child && this._child.stdin && !this._child.stdin.destroyed) {
      this._child.stdin.write(line + '\n');
    }
  }
}

// Export test helpers
export const _testExports = {
  shouldRestart,
  backoffMs,
  parseJsonRpcLine,
  isToolsListResponse,
  injectRestartTool,
};

// --- Entry point ---
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));
if (isMain) {
  const serverPath = resolve(__dirname, 'server.js');
  const proxy = new McpProxy(serverPath);
  proxy.start().catch(err => {
    process.stderr.write('[BIRBAL PROXY] Fatal: ' + err.message + '\n');
    process.exit(1);
  });
}
