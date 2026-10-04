// mcp/server.js — MCP Tool Server
// WHY: This is the JSON-RPC layer that AI clients talk to.
// It wires the ToolRegistry to the MCP SDK's request handlers.
// All diagnostics go to stderr. stdout is sacred — JSON-RPC only.

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { ToolRegistry } from './registry.js';
import { sanitizeResponse } from './sanitize.js';
import { Mesh, registerMeshTools } from './mesh.js';

// Mandatory footer — added at the response-building layer, not per-handler.
// WHY here: no write path can skip it. Every tool result passes through formatToolResult().
export const FOOTER = '\n---\nData retrieved by Birbal. Verify independently before acting.';

/**
 * Append a footer to text.
 * @param {string} text
 * @param {string} footer
 * @returns {string}
 */
export function addFooter(text, footer) {
  return text + footer;
}

/**
 * Format any tool result into the MCP content array shape.
 * WHY uniform: the model expects { content: [{ type: "text", text }] } from every tool.
 * Auth prompts skip the footer — they're instructions for the model, not data.
 *
 * @param {*} data - Tool handler result
 * @returns {{ content: Array<{ type: string, text: string }> }}
 */
export function formatToolResult(data) {
  // Null/undefined — no content
  if (data === null || data === undefined) {
    return { content: [{ type: 'text', text: 'No content returned.' }] };
  }

  // Auth prompts — show raw, no footer
  if (data && typeof data === 'object' && data.action_required) {
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  }

  // String — add footer directly
  if (typeof data === 'string') {
    return { content: [{ type: 'text', text: addFooter(data, FOOTER) }] };
  }

  // Object/array — sanitize, stringify, add footer
  const sanitized = sanitizeResponse(data);
  const text = JSON.stringify(sanitized);
  return { content: [{ type: 'text', text: addFooter(text, FOOTER) }] };
}

/**
 * Create a configured MCP server wired to a ToolRegistry.
 *
 * @param {ToolRegistry} registry
 * @returns {{ server: Server, transport: StdioServerTransport, start: () => Promise<void> }}
 */
export function createServer(registry) {
  const server = new Server(
    { name: 'birbal', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  const transport = new StdioServerTransport();

  // Wire tools/list
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: registry.listTools(),
  }));

  // Wire tools/call
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      const result = await registry.callTool(name, args || {});
      return formatToolResult(result);
    } catch (err) {
      // Return error as text content, don't crash the server
      return {
        content: [{ type: 'text', text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  });

  async function start() {
    // Wire registry changes to tool list notifications after connection
    registry._onChanged = () => {
      server.notification({ method: 'notifications/tools/list_changed' });
    };
    await server.connect(transport);
    process.stderr.write('[BIRBAL MCP] Server started\n');
  }

  return { server, transport, start };
}

// When run directly (not imported), start the server
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));
if (isMain) {
  const registry = new ToolRegistry();

  // Start the mesh and register its tools
  const mesh = new Mesh();
  mesh.start();
  registerMeshTools(registry, mesh);

  // Clean shutdown: stop heartbeat, deregister from mesh
  process.on('SIGTERM', () => { mesh.stop(); process.exit(0); });
  process.on('SIGINT', () => { mesh.stop(); process.exit(0); });

  const { start } = createServer(registry);
  start().catch(err => {
    mesh.stop();
    process.stderr.write('[BIRBAL MCP] Fatal: ' + err.message + '\n');
    process.exit(1);
  });
}
