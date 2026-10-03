// tests/mcp/server.test.js — TDD: RED first
// Tests for mcp/server.js — formatToolResult, addFooter, createServer

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { formatToolResult, addFooter, FOOTER } from '../../mcp/server.js';

describe('addFooter', () => {
  it('appends footer to text', () => {
    const result = addFooter('some data', '\n---\nDisclaimer');
    assert.ok(result.endsWith('\n---\nDisclaimer'));
    assert.ok(result.startsWith('some data'));
  });

  it('handles empty text', () => {
    const result = addFooter('', '\n---\nFooter');
    assert.equal(result, '\n---\nFooter');
  });
});

describe('formatToolResult', () => {
  it('wraps string in MCP content array', () => {
    const result = formatToolResult('hello');
    assert.equal(result.content.length, 1);
    assert.equal(result.content[0].type, 'text');
    assert.ok(result.content[0].text.includes('hello'));
  });

  it('adds footer to string results', () => {
    const result = formatToolResult('data here');
    assert.ok(result.content[0].text.includes(FOOTER));
  });

  it('JSON-stringifies objects', () => {
    const result = formatToolResult({ id: 1, name: 'test' });
    assert.equal(result.content[0].type, 'text');
    const parsed = JSON.parse(result.content[0].text.split(FOOTER)[0]);
    assert.equal(parsed.id, 1);
  });

  it('returns fallback text for null input', () => {
    const result = formatToolResult(null);
    assert.equal(result.content[0].type, 'text');
    assert.ok(result.content[0].text.includes('No content returned'));
  });

  it('handles auth_choice prompts without footer', () => {
    const authPrompt = {
      action_required: 'auth_choice',
      service: 'GitHub',
      message: 'Token expired',
      choices: ['refresh', 'skip'],
    };
    const result = formatToolResult(authPrompt);
    const text = result.content[0].text;
    // Auth prompts should be shown raw for the model to act on
    assert.ok(text.includes('auth_choice'));
    assert.ok(text.includes('GitHub'));
    // No footer on auth prompts — they're instructions, not data
    assert.ok(!text.includes(FOOTER));
  });

  it('handles undefined input', () => {
    const result = formatToolResult(undefined);
    assert.ok(result.content[0].text.includes('No content returned'));
  });

  it('handles array results', () => {
    const result = formatToolResult([1, 2, 3]);
    const text = result.content[0].text;
    assert.ok(text.includes('[1,2,3]') || text.includes('1'));
  });
});
