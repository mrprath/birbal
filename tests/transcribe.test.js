// tests/transcribe.test.js — TDD: lib/transcribe.js contract
// Spear works: valid audio buffer -> text
// Bad spear breaks correctly: missing key, bad audio, API errors

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// We test the module's contract without hitting the real API.
// Strategy: validate inputs, build the request correctly, parse responses.

describe('transcribe', () => {
  let originalEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    process.env.OPENAI_API_KEY = 'sk-test-key-for-unit-tests';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('buildWhisperRequest', () => {
    it('builds multipart form data with correct boundary', async () => {
      const { buildWhisperRequest } = await import('../lib/transcribe.js');
      const audio = Buffer.from('fake-wav-data');
      const { boundary, body, headers } = buildWhisperRequest(audio, { format: 'wav' });

      assert.ok(boundary, 'should produce a boundary string');
      assert.ok(body instanceof Buffer, 'body should be a Buffer');
      assert.equal(headers['Content-Type'], `multipart/form-data; boundary=${boundary}`);
      assert.ok(headers['Authorization'].startsWith('Bearer '), 'should have Bearer token');

      // Body should contain the model field and audio part
      const bodyStr = body.toString('utf-8');
      assert.ok(bodyStr.includes('name="model"'), 'should include model field');
      assert.ok(bodyStr.includes('whisper'), 'should specify whisper model');
      assert.ok(bodyStr.includes('name="file"'), 'should include file field');
      assert.ok(bodyStr.includes('filename="audio.wav"'), 'should name the file');
    });

    it('defaults to wav format', async () => {
      const { buildWhisperRequest } = await import('../lib/transcribe.js');
      const audio = Buffer.from('fake-wav-data');
      const { body } = buildWhisperRequest(audio);

      const bodyStr = body.toString('utf-8');
      assert.ok(bodyStr.includes('audio.wav'), 'should default to wav');
    });

    it('supports mp3 format', async () => {
      const { buildWhisperRequest } = await import('../lib/transcribe.js');
      const audio = Buffer.from('fake-mp3-data');
      const { body } = buildWhisperRequest(audio, { format: 'mp3' });

      const bodyStr = body.toString('utf-8');
      assert.ok(bodyStr.includes('audio.mp3'), 'should use mp3 extension');
    });

    it('supports webm format', async () => {
      const { buildWhisperRequest } = await import('../lib/transcribe.js');
      const audio = Buffer.from('fake-webm-data');
      const { body } = buildWhisperRequest(audio, { format: 'webm' });

      const bodyStr = body.toString('utf-8');
      assert.ok(bodyStr.includes('audio.webm'), 'should use webm extension');
    });
  });

  describe('parseWhisperResponse', () => {
    it('extracts text from successful response', async () => {
      const { parseWhisperResponse } = await import('../lib/transcribe.js');
      const result = parseWhisperResponse(200, '{"text":"hello world"}');

      assert.equal(result.text, 'hello world');
      assert.equal(result.error, null);
    });

    it('returns error on 401 (bad key)', async () => {
      const { parseWhisperResponse } = await import('../lib/transcribe.js');
      const result = parseWhisperResponse(401, '{"error":{"message":"Invalid API key"}}');

      assert.equal(result.text, null);
      assert.equal(result.error.code, 'AUTH_OPENAI_INVALID_KEY');
    });

    it('returns error on 429 (rate limit)', async () => {
      const { parseWhisperResponse } = await import('../lib/transcribe.js');
      const result = parseWhisperResponse(429, '{"error":{"message":"Rate limit"}}');

      assert.equal(result.text, null);
      assert.equal(result.error.code, 'TRANSPORT_RATE_LIMITED');
    });

    it('returns error on 400 (bad audio)', async () => {
      const { parseWhisperResponse } = await import('../lib/transcribe.js');
      const result = parseWhisperResponse(400, '{"error":{"message":"Invalid file format"}}');

      assert.equal(result.text, null);
      assert.equal(result.error.code, 'VALIDATION_BAD_AUDIO');
    });

    it('returns error on 500 (server error)', async () => {
      const { parseWhisperResponse } = await import('../lib/transcribe.js');
      const result = parseWhisperResponse(500, '{"error":{"message":"Internal error"}}');

      assert.equal(result.text, null);
      assert.equal(result.error.code, 'TRANSPORT_OPENAI_ERROR');
    });

    it('handles malformed JSON gracefully', async () => {
      const { parseWhisperResponse } = await import('../lib/transcribe.js');
      const result = parseWhisperResponse(200, 'not json');

      assert.equal(result.text, null);
      assert.ok(result.error, 'should return an error');
    });
  });

  describe('input validation', () => {
    it('rejects empty audio buffer', async () => {
      const { validateAudioInput } = await import('../lib/transcribe.js');
      const result = validateAudioInput(Buffer.alloc(0));

      assert.equal(result.valid, false);
      assert.ok(result.reason.includes('empty'), 'should mention empty');
    });

    it('rejects non-buffer input', async () => {
      const { validateAudioInput } = await import('../lib/transcribe.js');
      const result = validateAudioInput('not a buffer');

      assert.equal(result.valid, false);
      assert.ok(result.reason.includes('Buffer'), 'should mention Buffer');
    });

    it('rejects audio over 25MB (Whisper limit)', async () => {
      const { validateAudioInput } = await import('../lib/transcribe.js');
      const big = Buffer.alloc(26 * 1024 * 1024);
      const result = validateAudioInput(big);

      assert.equal(result.valid, false);
      assert.ok(result.reason.includes('25'), 'should mention 25MB limit');
    });

    it('accepts valid audio buffer', async () => {
      const { validateAudioInput } = await import('../lib/transcribe.js');
      const result = validateAudioInput(Buffer.from('valid audio data'));

      assert.equal(result.valid, true);
    });

    it('rejects unsupported format', async () => {
      const { validateAudioInput } = await import('../lib/transcribe.js');
      const result = validateAudioInput(Buffer.from('data'), { format: 'exe' });

      assert.equal(result.valid, false);
      assert.ok(result.reason.includes('format'), 'should mention format');
    });
  });

  describe('missing API key', () => {
    it('throws AuthError when OPENAI_API_KEY is not set', async () => {
      delete process.env.OPENAI_API_KEY;
      const { buildWhisperRequest } = await import('../lib/transcribe.js');

      assert.throws(
        () => buildWhisperRequest(Buffer.from('audio')),
        (err) => err.code === 'AUTH_OPENAI_MISSING_KEY'
      );
    });
  });
});
