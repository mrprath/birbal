// lib/env.js
// DR-2: Credential access layer
// DR-5: Values passed via process.env, never interpolated into eval
// DR-8: All writes go through secureWriteFile

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { secureWriteFile } from './secure-write.js';
import { SecurityError } from './errors.js';

const REPO_ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
const ENV_PATH = join(REPO_ROOT, '.env');

/**
 * Load .env file into process.env
 * WHY we don't use dotenv: one less dependency, one less supply chain surface
 */
export function loadEnv() {
  if (!existsSync(ENV_PATH)) return;

  const content = readFileSync(ENV_PATH, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    // Don't override existing env vars
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

/**
 * Set a value in .env and write securely
 * DR-8: uses secureWriteFile — atomic write, chmod 600
 * DR-5: value is passed as argument, never interpolated into a string that gets eval'd
 */
export function setEnv(key, value) {
  // Validate key: alphanumeric + underscores only (DR-5: no injection surface)
  if (!/^[A-Z_][A-Z0-9_]*$/i.test(key)) {
    throw new SecurityError(
      `Invalid env key: ${key}. Alphanumeric and underscores only.`,
      'SECURITY_INVALID_ENV_KEY',
    );
  }

  // Read existing .env
  let lines = [];
  if (existsSync(ENV_PATH)) {
    lines = readFileSync(ENV_PATH, 'utf-8').split('\n');
  }

  // Update or append
  let found = false;
  lines = lines.map(line => {
    const trimmed = line.trim();
    if (trimmed.startsWith(`${key}=`)) {
      found = true;
      return `${key}=${value}`;
    }
    return line;
  });

  if (!found) {
    lines.push(`${key}=${value}`);
  }

  // DR-8: atomic write with chmod 600
  secureWriteFile(ENV_PATH, lines.join('\n'));

  // Update process.env
  process.env[key] = value;
}

/**
 * Get a value — from process.env only, never printed (S6)
 */
export function getEnv(key) {
  return process.env[key] || null;
}
