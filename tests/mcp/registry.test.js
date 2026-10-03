// tests/mcp/registry.test.js — TDD: RED first
// Tests for mcp/registry.js — ToolRegistry class with guard wrapping

import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { ToolRegistry } from '../../mcp/registry.js';

// Sample tool schema
const echoSchema = {
  description: 'Echo a message back',
  type: 'object',
  properties: { message: { type: 'string' } },
  required: ['message'],
};

// Simple handler that returns args
const echoHandler = async (args, token) => ({ echo: args.message, hasToken: !!token });

describe('ToolRegistry', () => {
  let registry;
  let changedCount;

  beforeEach(() => {
    changedCount = 0;
    registry = new ToolRegistry(() => { changedCount++; });
  });

  describe('registerTool', () => {
    it('adds a tool to the registry', () => {
      registry.registerTool('echo', echoSchema, null, echoHandler);
      const tools = registry.listTools();
      assert.equal(tools.length, 1);
      assert.equal(tools[0].name, 'echo');
    });

    it('fires onChanged callback', () => {
      registry.registerTool('echo', echoSchema, null, echoHandler);
      assert.equal(changedCount, 1);
    });

    it('rejects duplicate name', () => {
      registry.registerTool('echo', echoSchema, null, echoHandler);
      assert.throws(
        () => registry.registerTool('echo', echoSchema, null, echoHandler),
        /already registered/
      );
    });

    it('validates schema is an object', () => {
      assert.throws(
        () => registry.registerTool('bad', 'not-an-object', null, echoHandler),
        /schema must be an object/
      );
    });

    it('validates handler is a function', () => {
      assert.throws(
        () => registry.registerTool('bad', echoSchema, null, 'not-a-function'),
        /handler must be a function/
      );
    });

    it('rejects unknown guard name', () => {
      assert.throws(
        () => registry.registerTool('bad', echoSchema, 'nonexistent', echoHandler),
        /Unknown guard/
      );
    });
  });

  describe('removeTool', () => {
    it('removes a registered tool', () => {
      registry.registerTool('echo', echoSchema, null, echoHandler);
      const removed = registry.removeTool('echo');
      assert.equal(removed, true);
      assert.equal(registry.listTools().length, 0);
    });

    it('fires onChanged callback', () => {
      registry.registerTool('echo', echoSchema, null, echoHandler);
      changedCount = 0; // reset after register
      registry.removeTool('echo');
      assert.equal(changedCount, 1);
    });

    it('returns false for unknown tool', () => {
      assert.equal(registry.removeTool('nonexistent'), false);
    });
  });

  describe('listTools', () => {
    it('returns MCP tool format', () => {
      registry.registerTool('echo', echoSchema, null, echoHandler);
      const tools = registry.listTools();
      assert.equal(tools[0].name, 'echo');
      assert.equal(tools[0].description, 'Echo a message back');
      assert.ok(tools[0].inputSchema);
      assert.equal(tools[0].inputSchema.type, 'object');
    });

    it('returns empty array when no tools registered', () => {
      assert.deepStrictEqual(registry.listTools(), []);
    });

    it('lists multiple tools', () => {
      registry.registerTool('a', { ...echoSchema, description: 'Tool A' }, null, echoHandler);
      registry.registerTool('b', { ...echoSchema, description: 'Tool B' }, null, echoHandler);
      assert.equal(registry.listTools().length, 2);
    });
  });

  describe('callTool', () => {
    it('calls handler with args and null token when no guard', async () => {
      registry.registerTool('echo', echoSchema, null, echoHandler);
      const result = await registry.callTool('echo', { message: 'hello' });
      assert.deepStrictEqual(result, { echo: 'hello', hasToken: false });
    });

    it('throws for unknown tool name', async () => {
      await assert.rejects(
        () => registry.callTool('nonexistent', {}),
        /Unknown tool/
      );
    });

    it('passes args to handler', async () => {
      let capturedArgs;
      registry.registerTool('capture', echoSchema, null, async (args) => {
        capturedArgs = args;
        return 'ok';
      });
      await registry.callTool('capture', { message: 'test', extra: 42 });
      assert.equal(capturedArgs.message, 'test');
      assert.equal(capturedArgs.extra, 42);
    });

    it('propagates handler errors', async () => {
      registry.registerTool('fail', echoSchema, null, async () => {
        throw new Error('handler broke');
      });
      await assert.rejects(
        () => registry.callTool('fail', {}),
        /handler broke/
      );
    });
  });

  describe('constructor defaults', () => {
    it('works without onChanged callback', () => {
      const reg = new ToolRegistry();
      reg.registerTool('echo', echoSchema, null, echoHandler);
      assert.equal(reg.listTools().length, 1);
    });
  });
});
