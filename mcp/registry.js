// mcp/registry.js — Dynamic tool registration with auth guard wrapping
// WHY: Tools need a central place to register, and each tool needs its auth guard.
// The registry owns the tool map. callTool() routes through guard.wrap() automatically.
// onChanged fires on add/remove — wired to notifications/tools/list_changed in server.js.

import { githubGuard, notionGuard, graphGuard, typesafeGuard } from '../lib/token-validator.js';

const GUARDS = {
  github: githubGuard,
  notion: notionGuard,
  graph: graphGuard,
  typesafe: typesafeGuard,
};

export class ToolRegistry {
  /**
   * @param {function} [onChanged] - Callback when tools are added/removed
   */
  constructor(onChanged) {
    this._tools = new Map();
    this._onChanged = onChanged || (() => {});
  }

  /**
   * Register a tool.
   * @param {string} name - Tool name (e.g. "github-list-repos")
   * @param {object} schema - JSON Schema for inputSchema (must have .description)
   * @param {string|null} guardName - Key in GUARDS map, or null for no auth
   * @param {function} handler - async (args, token) => result
   */
  registerTool(name, schema, guardName, handler) {
    if (typeof schema !== 'object' || schema === null) {
      throw new Error('schema must be an object');
    }
    if (typeof handler !== 'function') {
      throw new Error('handler must be a function');
    }
    if (this._tools.has(name)) {
      throw new Error(`Tool already registered: ${name}`);
    }

    let guard = null;
    if (guardName !== null && guardName !== undefined) {
      guard = GUARDS[guardName];
      if (!guard) {
        throw new Error(`Unknown guard: ${guardName}. Valid: ${Object.keys(GUARDS).join(', ')}`);
      }
    }

    this._tools.set(name, {
      schema,
      guard,
      handler,
      description: schema.description || name,
    });

    this._onChanged();
  }

  /**
   * Remove a tool.
   * @param {string} name
   * @returns {boolean} true if removed, false if not found
   */
  removeTool(name) {
    if (!this._tools.has(name)) return false;
    this._tools.delete(name);
    this._onChanged();
    return true;
  }

  /**
   * List all tools in MCP format.
   * @returns {Array<{ name: string, description: string, inputSchema: object }>}
   */
  listTools() {
    return Array.from(this._tools.entries()).map(([name, t]) => ({
      name,
      description: t.description,
      inputSchema: t.schema,
    }));
  }

  /**
   * Call a tool by name, routing through its guard if one is assigned.
   * @param {string} name
   * @param {object} args
   * @returns {Promise<any>}
   */
  async callTool(name, args) {
    const tool = this._tools.get(name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);

    if (!tool.guard) {
      return tool.handler(args, null);
    }

    return tool.guard.wrap(token => tool.handler(args, token));
  }
}
