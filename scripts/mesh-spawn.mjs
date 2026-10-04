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
//   --dry-run           Write the bat file but do not open a window

import { spawn } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdirSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { argv } from 'node:process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

// Bat files live in .mesh/ to keep the repo root clean.
export const BAT_DIR = join(REPO_ROOT, '.mesh');

// Validate inputs: labels and roles must be simple identifiers.
// WHY: these values end up in a .bat file. Unvalidated strings could
// break out of quoting and execute arbitrary commands.
const SAFE_LABEL = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * Build the join prompt that the child session executes on start.
 * Exported for testing.
 */
export function buildJoinPrompt({ label, role, spawner }) {
  return [
    `You are a ${role} on the Birbal Mesh.`,
    `Your label is ${label}.`,
    `Join the mesh: mesh_rename to ${label}, then mesh_agents.`,
    spawner
      ? `Then tap ${spawner} with: ${label} ready for task.`
      : '',
    `Then start a persistent Monitor on the command: node scripts/mesh-poll.mjs --label ${label} -- to receive incoming taps.`,
    'When a tap arrives via the Monitor, execute the instructions in it. Do not act until you receive a tap with your brief.',
    spawner
      ? `When your task is complete, tap ${spawner} with the result, then mesh_rename to parked-${label} and stop your Monitor. Do not exit -- the human will close this window when ready.`
      : `When your task is complete, mesh_rename to parked-${label} and stop your Monitor. Do not exit -- the human will close this window when ready.`,
  ].filter(Boolean).join(' ');
}

/**
 * Build the bat file content for a mesh-spawn child window.
 * Exported for testing.
 */
export function buildBatContent({ label, role, repoRoot, claudeArgs }) {
  return [
    '@echo off',
    `title Birbal Mesh: ${label}`,
    `cd /d "${repoRoot}"`,
    claudeArgs.map(a => a.includes(' ') ? `"${a}"` : a).join(' '),
  ].join('\r\n');
}

// CLI entry point: only runs when invoked directly, not when imported for tests
const isMainModule = argv[1] && resolve(argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMainModule) {
  const { values } = parseArgs({
    options: {
      role:      { type: 'string', default: 'builder' },
      label:     { type: 'string' },
      spawner:   { type: 'string' },
      mcp:       { type: 'string', default: '' },
      skills:    { type: 'string', default: '' },
      'allow-all': { type: 'boolean', default: false },
      'dry-run':   { type: 'boolean', default: false },
    },
    strict: true,
  });

  if (!values.label) {
    console.error('Error: --label is required');
    process.exit(1);
  }

  for (const [name, val] of [['label', values.label], ['role', values.role], ['spawner', values.spawner]]) {
    if (val && !SAFE_LABEL.test(val)) {
      console.error(`Error: --${name} must be alphanumeric/dash/underscore, max 64 chars. Got: ${val}`);
      process.exit(1);
    }
  }

  const joinPrompt = buildJoinPrompt({
    label: values.label,
    role: values.role,
    spawner: values.spawner,
  });

  // Windows only
  const isWindows = process.platform === 'win32';
  if (!isWindows) {
    console.error('mesh-spawn currently supports Windows only. PRs welcome for macOS/Linux.');
    process.exit(1);
  }

  // Build claude command: interactive mode (not -p) so the child gets a
  // full TUI session that can run persistent Monitors and receive taps.
  // --name sets the terminal title inside Claude's TUI.
  const claudeArgs = ['claude'];
  if (values['allow-all']) {
    claudeArgs.push('--dangerously-skip-permissions');
  }
  claudeArgs.push('--name', values.label, joinPrompt);

  // Ensure .mesh/ directory exists
  mkdirSync(BAT_DIR, { recursive: true });

  // Write bat file to .mesh/ directory.
  // resolve() normalizes the path; the startsWith guard prevents directory traversal.
  const batPath = resolve(BAT_DIR, `spawn-${values.label}.bat`);
  if (!batPath.startsWith(BAT_DIR)) {
    console.error('Error: bat path escaped .mesh directory');
    process.exit(1);
  }
  const batContent = buildBatContent({
    label: values.label,
    role: values.role,
    repoRoot: REPO_ROOT,
    claudeArgs,
  });
  writeFileSync(batPath, batContent);

  if (values['dry-run']) {
    console.log(`[mesh-spawn] Wrote ${batPath} (dry run, no window opened)`);
    process.exit(0);
  }

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
}
