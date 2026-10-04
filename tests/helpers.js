// tests/helpers.js — Shared test utilities
// WHY: repoRoot, withEnv, walkJs, fakeJwt are copy-pasted across 6+ test files.
// One import. One place to fix. No drift.

import { readdirSync, statSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

/**
 * Consistent repo root path, Windows-safe.
 * WHY a function: avoids top-level side effects in the import.
 */
export function repoRoot() {
  return new URL('../', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
}

/**
 * Run a sync function with a temporary env var value.
 * Restores the original value in `finally` — cleanup runs even if assert throws.
 * WHY: test 2 must never inherit test 1's mess.
 *
 * @param {string} key - env var name
 * @param {string|undefined} value - value to set (undefined = delete)
 * @param {() => T} fn - function to run
 * @returns {T}
 */
export function withEnv(key, value, fn) {
  const saved = process.env[key];
  const hadKey = key in process.env;
  try {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
    return fn();
  } finally {
    if (hadKey) process.env[key] = saved;
    else delete process.env[key];
  }
}

/**
 * Async version of withEnv. Same guarantee: finally runs even if assert throws.
 */
export async function withEnvAsync(key, value, fn) {
  const saved = process.env[key];
  const hadKey = key in process.env;
  try {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
    return await fn();
  } finally {
    if (hadKey) process.env[key] = saved;
    else delete process.env[key];
  }
}

/**
 * Walk a directory tree, collecting .js and .mjs files.
 * Skips node_modules and .git. Used by static analysis security tests.
 */
export function walkJs(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (entry === 'node_modules' || entry === '.git') continue;
    if (statSync(full).isDirectory()) {
      walkJs(full, files);
    } else if (full.endsWith('.js') || full.endsWith('.mjs')) {
      files.push(full);
    }
  }
  return files;
}

/**
 * Create a fake JWT with a given payload. For testing token-validator logic.
 * NOT a real JWT — signature is fake. That's the point: we test decode, not verify.
 *
 * @param {object} payload - JWT payload (e.g. { exp: ..., sub: '...' })
 * @returns {string} A three-part dot-separated JWT string
 */
export function fakeJwt(payload = {}) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.fakesig`;
}

/**
 * Create a temp file path in os.tmpdir(). Does NOT create the file.
 * Use with cleanTmp() in a finally block.
 *
 * @param {string} [prefix='birbal-test'] - filename prefix
 * @returns {string} Full path to a temp file
 */
export function tmpFile(prefix = 'birbal-test') {
  const name = `${prefix}-${randomBytes(6).toString('hex')}`;
  return join(tmpdir(), name);
}

/**
 * Delete temp files. Safe to call with paths that don't exist.
 * Use in `finally` blocks to guarantee cleanup.
 *
 * @param {string|string[]} paths - file path(s) to delete
 */
export function cleanTmp(paths) {
  const list = Array.isArray(paths) ? paths : [paths];
  for (const p of list) {
    try { unlinkSync(p); } catch { /* file may not exist — that's fine */ }
  }
}
