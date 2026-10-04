// lib/voice-record.js — Build the bat script to spawn a voice recording terminal
// WHY separate from voice-runtime: voice-runtime is the interactive recorder.
// This module builds the shell command to launch it in a new window, so the
// skill and mesh can invoke it without duplicating bat-file logic.

export const VALID_OUTPUTS = ['clipboard', 'claude', 'stdout'];

/**
 * Build a Windows bat script that opens voice-runtime in a new terminal.
 *
 * @param {object} opts
 * @param {string} opts.repoRoot - Absolute path to the birbal repo root
 * @param {string} opts.output - Output mode: clipboard | claude | stdout (default: clipboard)
 * @returns {string} Bat file content
 */
export function buildRecordBat(opts = {}) {
  if (!opts.repoRoot) {
    throw new Error('repoRoot is required');
  }

  const output = opts.output || 'clipboard';
  if (!VALID_OUTPUTS.includes(output)) {
    throw new Error(`Invalid output mode "${output}". Valid: ${VALID_OUTPUTS.join(', ')}`);
  }

  const lines = [
    '@echo off',
    `cd /d "${opts.repoRoot}"`,
    `node scripts/voice-runtime.mjs --once --output ${output}`,
    'pause',
  ];

  return lines.join('\r\n');
}
