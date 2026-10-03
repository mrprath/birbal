// lib/transcribe.js — Voice transcription via OpenAI Whisper API
// WHY separate from resilient-request: Whisper needs multipart/form-data,
// not JSON. resilient-request does text bodies. Mixing them would compromise
// both contracts.
//
// Security: DR-1 (HTTPS only), DR-2 (key from env), DR-7 (URL allowlisted),
// S6 (key never logged). Audio is user input: validated before upload.

import https from 'node:https';
import { randomUUID } from 'node:crypto';
import { createSecureAgent } from './secure-transport.js';
import { AuthError, ValidationError, TransportError } from './errors.js';

const WHISPER_URL = 'https://api.openai.com/v1/audio/transcriptions';
const WHISPER_MODEL = 'whisper-1';
const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // 25MB Whisper limit
const SUPPORTED_FORMATS = ['wav', 'mp3', 'mp4', 'mpeg', 'mpga', 'm4a', 'webm', 'ogg', 'flac'];
const MIME_MAP = {
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  mp4: 'audio/mp4',
  mpeg: 'audio/mpeg',
  mpga: 'audio/mpeg',
  m4a: 'audio/mp4',
  webm: 'audio/webm',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
};

/**
 * Validate audio input before sending to Whisper.
 *
 * @param {Buffer} audio - Raw audio data
 * @param {object} opts
 * @param {string} opts.format - Audio format (default: 'wav')
 * @returns {{ valid: boolean, reason: string|null }}
 */
export function validateAudioInput(audio, opts = {}) {
  if (!Buffer.isBuffer(audio)) {
    return { valid: false, reason: 'Audio must be a Buffer' };
  }

  if (audio.length === 0) {
    return { valid: false, reason: 'Audio buffer is empty' };
  }

  if (audio.length > MAX_AUDIO_BYTES) {
    return { valid: false, reason: `Audio exceeds 25MB limit (${(audio.length / 1024 / 1024).toFixed(1)}MB)` };
  }

  const format = opts.format || 'wav';
  if (!SUPPORTED_FORMATS.includes(format)) {
    return { valid: false, reason: `Unsupported format "${format}". Supported: ${SUPPORTED_FORMATS.join(', ')}` };
  }

  return { valid: true, reason: null };
}

/**
 * Build the multipart form request for Whisper API.
 * WHY manual multipart: avoids adding form-data as a dependency.
 * One less supply chain surface, same as env.js avoiding dotenv.
 *
 * @param {Buffer} audio - Raw audio data
 * @param {object} opts
 * @param {string} opts.format - Audio format (default: 'wav')
 * @param {string} opts.language - Language hint (optional, ISO 639-1)
 * @returns {{ boundary: string, body: Buffer, headers: object }}
 */
export function buildWhisperRequest(audio, opts = {}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new AuthError(
      'OPENAI_API_KEY not set. Add it to .env.',
      'AUTH_OPENAI_MISSING_KEY',
    );
  }

  const format = opts.format || 'wav';
  const mime = MIME_MAP[format] || 'application/octet-stream';
  const boundary = `----BirbalAudio${randomUUID().replace(/-/g, '')}`;

  // Build multipart body
  const parts = [];

  // model field
  parts.push(
    `--${boundary}\r\n`,
    'Content-Disposition: form-data; name="model"\r\n\r\n',
    `${WHISPER_MODEL}\r\n`,
  );

  // language field (optional)
  if (opts.language) {
    parts.push(
      `--${boundary}\r\n`,
      'Content-Disposition: form-data; name="language"\r\n\r\n',
      `${opts.language}\r\n`,
    );
  }

  // audio file
  parts.push(
    `--${boundary}\r\n`,
    `Content-Disposition: form-data; name="file"; filename="audio.${format}"\r\n`,
    `Content-Type: ${mime}\r\n\r\n`,
  );

  const header = Buffer.from(parts.join(''));
  const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([header, audio, footer]);

  return {
    boundary,
    body,
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Authorization': `Bearer ${apiKey}`,
      'Content-Length': body.length.toString(),
    },
  };
}

/**
 * Parse Whisper API response into a typed result.
 *
 * @param {number} status - HTTP status code
 * @param {string} rawBody - Response body string
 * @returns {{ text: string|null, error: { code: string, message: string }|null }}
 */
export function parseWhisperResponse(status, rawBody) {
  let parsed;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return {
      text: null,
      error: { code: 'TRANSPORT_OPENAI_ERROR', message: `Unparseable response: ${rawBody.slice(0, 200)}` },
    };
  }

  if (status === 200 && parsed.text !== undefined) {
    return { text: parsed.text, error: null };
  }

  const msg = parsed.error?.message || `HTTP ${status}`;

  if (status === 401) {
    return { text: null, error: { code: 'AUTH_OPENAI_INVALID_KEY', message: msg } };
  }
  if (status === 429) {
    return { text: null, error: { code: 'TRANSPORT_RATE_LIMITED', message: msg } };
  }
  if (status === 400) {
    return { text: null, error: { code: 'VALIDATION_BAD_AUDIO', message: msg } };
  }

  return { text: null, error: { code: 'TRANSPORT_OPENAI_ERROR', message: msg } };
}

/**
 * Transcribe audio via OpenAI Whisper API.
 * This is the high-level function that wires validation, request, and parsing.
 *
 * @param {Buffer} audio - Raw audio data
 * @param {object} opts
 * @param {string} opts.format - Audio format (default: 'wav')
 * @param {string} opts.language - Language hint (optional)
 * @param {number} opts.timeout - Request timeout in ms (default: 60000)
 * @returns {Promise<string>} Transcribed text
 */
export async function transcribe(audio, opts = {}) {
  const validation = validateAudioInput(audio, opts);
  if (!validation.valid) {
    throw new ValidationError(validation.reason, 'VALIDATION_BAD_AUDIO');
  }

  const { body, headers } = buildWhisperRequest(audio, opts);
  const timeout = opts.timeout || 60_000;
  const agent = createSecureAgent();
  const parsed = new URL(WHISPER_URL);

  const { status, responseBody } = await new Promise((resolve, reject) => {
    const req = https.request(parsed, {
      method: 'POST',
      headers,
      agent,
      timeout,
    }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          responseBody: Buffer.concat(chunks).toString('utf-8'),
        });
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new TransportError(
        `Whisper API timeout after ${timeout}ms`,
        'TRANSPORT_TIMEOUT',
      ));
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });

  const result = parseWhisperResponse(status, responseBody);
  if (result.error) {
    const ErrorClass = result.error.code.startsWith('AUTH_') ? AuthError
      : result.error.code.startsWith('VALIDATION_') ? ValidationError
      : TransportError;
    throw new ErrorClass(result.error.message, result.error.code);
  }

  return result.text;
}
