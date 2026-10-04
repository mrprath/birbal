#!/usr/bin/env node
// scripts/mesh-spawn.mjs — Spawn a new Claude session on the Birbal Mesh
// WHY: The orchestrator needs to open child windows with controlled scope.
// Each child gets only the MCPs and skills it was handed — zero parent context.
//
// Usage:
//   node scripts/mesh-spawn.mjs --role builder --label my-builder --spawner orchestrator
//
// Options:
//   --role <role>       Role from roles.yaml (builder, verifier, devil, scribe)
//   --label <label>     Mesh label for the child session
//   --spawner <label>   Label of the spawning session (child taps this on join)
//   --mcp <list>        Comma-separated MCP server names to enable
//   --skills <list>     Comma-separated skill names to load
//   --allow-all         Run with --dangerously-skip-permissions (unattended workers)

import { spawn } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, unlinkSync } from 'node:fs';
import { parseArgs } from 'node:util';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

const { values } = parseArgs({
  options: {
    role:      { type: 'string', default: 'builder' },
    label:     { type: 'string' },
    spawner:   { type: 'string' },
    mcp:       { type: 'string', default: '' },
    skills:    { type: 'string', default: '' },
    'allow-all': { type: 'boolean', default: false },
  },
  strict: true,
});

if (!values.label) {
  console.error('Error: --label is required');
  process.exit(1);
}

// Validate inputs: labels and roles must be simple identifiers.
// WHY: these values end up in a .bat file. Unvalidated strings could
// break out of quoting and execute arbitrary commands.
const SAFE_LABEL = /^[a-zA-Z0-9_-]{1,64}$/;
for (const [name, val] of [['label', values.label], ['role', values.role], ['spawner', values.spawner]]) {
  if (val && !SAFE_LABEL.test(val)) {
    console.error(`Error: --${name} must be alphanumeric/dash/underscore, max 64 chars. Got: ${val}`);
    process.exit(1);
  }
}

// Build the initial prompt that the child session will execute on start
// IMPORTANT: no double quotes in the prompt — they break bat file quoting.
// Use backticks or single quotes for emphasis instead.
const joinPrompt = [
  `You are a ${values.role} on the Birbal Mesh.`,
  `Your label is ${values.label}.`,
  `Join the mesh: mesh_rename to ${values.label}, then mesh_agents.`,
  values.spawner
    ? `Then tap ${values.spawner} with: ${values.label} ready for task.`
    : '',
  `Then start a persistent Monitor on the command: node scripts/mesh-poll.mjs --label ${values.label} -- to receive incoming taps.`,
  'When a tap arrives via the Monitor, execute the instructions in it. Do not act until you receive a tap with your brief.',
].filter(Boolean).join(' ');

// Determine the shell command to open a new terminal with Claude
// Windows: use `start` to open a new cmd window
// macOS/Linux: this would use open/gnome-terminal — not implemented yet
const isWindows = process.platform === 'win32';

if (!isWindows) {
  console.error('mesh-spawn currently supports Windows only. PRs welcome for macOS/Linux.');
  process.exit(1);
}

// Build claude command
const claudeArgs = ['claude'];
if (values['allow-all']) {
  claudeArgs.push('--dangerously-skip-permissions');
}
claudeArgs.push('-p', joinPrompt);

// Write a temp batch file so start/cmd quoting can't mangle the command
const batPath = join(REPO_ROOT, `.mesh-spawn-${values.label}.bat`);
const batContent = [
  '@echo off',
  `cd /d "${REPO_ROOT}"`,
  `${claudeArgs.map(a => a.includes(' ') ? `"${a}"` : a).join(' ')}`,
].join('\r\n');
writeFileSync(batPath, batContent);

const child = spawn('cmd', ['/c', 'start', '""', 'cmd', '/k', batPath], {
  stdio: 'ignore',
  detached: true,
  cwd: REPO_ROOT,
});

child.unref();

console.log(`[mesh-spawn] Spawned ${values.role} "${values.label}"`);
if (values.spawner) {
  console.log(`[mesh-spawn] Will tap "${values.spawner}" when ready`);
}
