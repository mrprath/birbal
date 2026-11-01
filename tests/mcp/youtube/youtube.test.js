// tests/mcp/youtube/youtube.test.js
// WHY: Contract tests for the YouTube MCP server.
// Verifies tool listing, schema shape, and mock behavior.
// YT_MOCK=1: no real yt-dlp/ffmpeg calls in CI.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..', '..');
const SERVER_PATH = resolve(ROOT, 'mcp', 'youtube', 'server.js');

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

function parseResult(resp) {
  return JSON.parse(textOf(resp));
}

describe('YouTube MCP', () => {
  before(async () => {
    proc = spawn('node', [SERVER_PATH], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, YT_MOCK: '1' },
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

  // -- Tool listing --

  it('lists exactly six tools', async () => {
    const resp = await jsonRpc('tools/list');
    const names = resp.result.tools.map(t => t.name).sort();
    assert.deepEqual(names, [
      'yt_cached',
      'yt_frames',
      'yt_info',
      'yt_moments',
      'yt_process',
      'yt_transcript',
    ]);
  });

  // -- Schema: yt_process --

  it('yt_process requires url', async () => {
    const resp = await jsonRpc('tools/list');
    const tool = resp.result.tools.find(t => t.name === 'yt_process');
    assert.ok(tool.inputSchema.properties.url);
    assert.ok(tool.inputSchema.required.includes('url'));
  });

  // -- Schema: yt_transcript --

  it('yt_transcript requires video_id', async () => {
    const resp = await jsonRpc('tools/list');
    const tool = resp.result.tools.find(t => t.name === 'yt_transcript');
    assert.ok(tool.inputSchema.properties.video_id);
    assert.ok(tool.inputSchema.required.includes('video_id'));
  });

  it('yt_transcript has optional format param', async () => {
    const resp = await jsonRpc('tools/list');
    const tool = resp.result.tools.find(t => t.name === 'yt_transcript');
    assert.ok(tool.inputSchema.properties.format);
  });

  // -- Schema: yt_frames --

  it('yt_frames requires video_id and timestamps', async () => {
    const resp = await jsonRpc('tools/list');
    const tool = resp.result.tools.find(t => t.name === 'yt_frames');
    assert.ok(tool.inputSchema.properties.video_id);
    assert.ok(tool.inputSchema.properties.timestamps);
    assert.ok(tool.inputSchema.required.includes('video_id'));
    assert.ok(tool.inputSchema.required.includes('timestamps'));
  });

  // -- Schema: yt_info --

  it('yt_info requires url', async () => {
    const resp = await jsonRpc('tools/list');
    const tool = resp.result.tools.find(t => t.name === 'yt_info');
    assert.ok(tool.inputSchema.properties.url);
    assert.ok(tool.inputSchema.required.includes('url'));
  });

  // -- Schema: yt_moments --

  it('yt_moments requires video_id and query', async () => {
    const resp = await jsonRpc('tools/list');
    const tool = resp.result.tools.find(t => t.name === 'yt_moments');
    assert.ok(tool.inputSchema.properties.video_id);
    assert.ok(tool.inputSchema.properties.query);
    assert.ok(tool.inputSchema.required.includes('video_id'));
    assert.ok(tool.inputSchema.required.includes('query'));
  });

  // -- Mock behavior: yt_process --

  it('yt_process returns metadata + transcript for mock video', async () => {
    const data = parseResult(
      await callTool('yt_process', { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' })
    );
    assert.ok(data.video_id, 'Missing video_id');
    assert.ok(data.title, 'Missing title');
    assert.ok(data.channel, 'Missing channel');
    assert.ok(typeof data.duration_seconds === 'number', 'Missing duration_seconds');
    assert.ok(data.transcript, 'Missing transcript');
    assert.ok(data.transcript.length > 0, 'Empty transcript');
  });

  it('yt_process accepts bare video IDs', async () => {
    const data = parseResult(
      await callTool('yt_process', { url: 'dQw4w9WgXcQ' })
    );
    assert.equal(data.video_id, 'dQw4w9WgXcQ');
  });

  it('yt_process accepts youtu.be short URLs', async () => {
    const data = parseResult(
      await callTool('yt_process', { url: 'https://youtu.be/dQw4w9WgXcQ' })
    );
    assert.equal(data.video_id, 'dQw4w9WgXcQ');
  });

  // -- Mock behavior: yt_transcript --

  it('yt_transcript returns plain text by default', async () => {
    // Process first to populate cache
    await callTool('yt_process', { url: 'dQw4w9WgXcQ' });

    const data = parseResult(
      await callTool('yt_transcript', { video_id: 'dQw4w9WgXcQ' })
    );
    assert.ok(typeof data.text === 'string', 'Missing text');
    assert.ok(data.text.length > 0, 'Empty text');
    assert.equal(data.video_id, 'dQw4w9WgXcQ');
  });

  it('yt_transcript returns segments when format=srt', async () => {
    const data = parseResult(
      await callTool('yt_transcript', { video_id: 'dQw4w9WgXcQ', format: 'srt' })
    );
    assert.ok(Array.isArray(data.segments), 'Missing segments array');
    assert.ok(data.segments.length > 0, 'Empty segments');
    assert.ok(typeof data.segments[0].text === 'string', 'Segment missing text');
    assert.ok(typeof data.segments[0].start === 'number', 'Segment missing start');
    assert.ok(typeof data.segments[0].end === 'number', 'Segment missing end');
  });

  it('yt_transcript errors for unknown video_id', async () => {
    const resp = await callTool('yt_transcript', { video_id: 'NONEXISTENT1' });
    assert.ok(resp.result.isError, 'Should error for unknown video');
  });

  // -- Mock behavior: yt_info --

  it('yt_info returns metadata without transcript', async () => {
    const data = parseResult(
      await callTool('yt_info', { url: 'dQw4w9WgXcQ' })
    );
    assert.ok(data.title, 'Missing title');
    assert.ok(data.channel, 'Missing channel');
    assert.ok(typeof data.duration_seconds === 'number', 'Missing duration');
    assert.equal(data.transcript, undefined, 'yt_info should not include transcript');
  });

  // -- Mock behavior: yt_frames --

  it('yt_frames returns frame paths for mock video', async () => {
    await callTool('yt_process', { url: 'dQw4w9WgXcQ' });

    const data = parseResult(
      await callTool('yt_frames', { video_id: 'dQw4w9WgXcQ', timestamps: [5, 10] })
    );
    assert.ok(Array.isArray(data.frames), 'Missing frames array');
    assert.ok(data.frames.length > 0, 'Empty frames');
    assert.ok(typeof data.frames[0].timestamp === 'number', 'Frame missing timestamp');
    assert.ok(typeof data.frames[0].path === 'string', 'Frame missing path');
  });

  it('yt_frames errors for uncached video', async () => {
    const resp = await callTool('yt_frames', { video_id: 'NONEXISTENT1', timestamps: [5] });
    assert.ok(resp.result.isError, 'Should error for uncached video');
  });

  // -- Mock behavior: yt_moments --

  it('yt_moments returns matching segments', async () => {
    await callTool('yt_process', { url: 'dQw4w9WgXcQ' });

    const data = parseResult(
      await callTool('yt_moments', { video_id: 'dQw4w9WgXcQ', query: 'interesting' })
    );
    assert.ok(Array.isArray(data.moments), 'Missing moments array');
    // Mock data should match "interesting"
    assert.ok(data.moments.length > 0, 'Expected at least one moment');
    assert.ok(typeof data.moments[0].text === 'string', 'Moment missing text');
    assert.ok(typeof data.moments[0].start === 'number', 'Moment missing start');
  });

  it('yt_moments returns empty for no-match query', async () => {
    const data = parseResult(
      await callTool('yt_moments', { video_id: 'dQw4w9WgXcQ', query: 'xyzzyplugh' })
    );
    assert.ok(Array.isArray(data.moments), 'Missing moments array');
    assert.equal(data.moments.length, 0, 'Should find no matches');
  });

  // -- Mock behavior: yt_cached --

  it('yt_cached lists processed videos', async () => {
    await callTool('yt_process', { url: 'dQw4w9WgXcQ' });

    const data = parseResult(await callTool('yt_cached', {}));
    assert.ok(Array.isArray(data.videos), 'Missing videos array');
    assert.ok(data.videos.length > 0, 'Should have at least one cached video');
    const v = data.videos.find(v => v.video_id === 'dQw4w9WgXcQ');
    assert.ok(v, 'Mock video should appear in cache');
    assert.ok(v.title, 'Cached video missing title');
  });

  // -- Error cases --

  it('yt_process errors on empty url', async () => {
    const resp = await callTool('yt_process', { url: '' });
    assert.ok(resp.result.isError, 'Should error on empty URL');
  });

  it('unknown tool returns error', async () => {
    const resp = await callTool('yt_nonexistent', {});
    assert.ok(resp.result.isError, 'Should error on unknown tool');
  });
});
