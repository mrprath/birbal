#!/usr/bin/env node
// scripts/mesh-poll.mjs — Poll the mesh for incoming taps
// WHY: Claude Code's Monitor tool streams stdout lines as notifications.
// This script polls mesh.db for unread messages addressed to this session
// and prints each one as a line. Use with Monitor for real-time tap delivery.
//
// Usage:
//   Monitor({ command: "node scripts/mesh-poll.mjs --label orchestrator" })
//
// Each incoming tap prints as:
//   [mesh tap <from> #<message_id>] <content>
// Each incoming reply prints as:
//   [mesh reply <from> #<message_id> re:#<reply_to>] <content>
//
// The script runs until killed. It polls every 3s (configurable via --interval).

import Database from 'better-sqlite3';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const DEFAULT_DB_PATH = resolve(REPO_ROOT, 'mesh.db');

const { values } = parseArgs({
  options: {
    label:    { type: 'string' },
    interval: { type: 'string', default: '3000' },
    db:       { type: 'string', default: DEFAULT_DB_PATH },
  },
  strict: true,
});

if (!values.label) {
  console.error('Error: --label is required (your mesh label)');
  process.exit(1);
}

const label = values.label;
const intervalMs = parseInt(values.interval, 10);
const dbPath = values.db;

function poll() {
  let db;
  try {
    db = new Database(dbPath, { readonly: false });
    db.pragma('busy_timeout = 3000');

    const rows = db.prepare(`
      SELECT id, from_label, content, reply_to, created_at
      FROM messages
      WHERE to_label = ? AND read = 0
      ORDER BY created_at ASC
    `).all(label);

    if (rows.length > 0) {
      // Mark as read
      const markRead = db.prepare('UPDATE messages SET read = 1 WHERE id = ?');
      const markAll = db.transaction(() => {
        for (const row of rows) markRead.run(row.id);
      });
      markAll();

      // Print each message as a line for Monitor to pick up
      for (const row of rows) {
        if (row.reply_to) {
          console.log(`[mesh reply ${row.from_label} #${row.id} re:#${row.reply_to}] ${row.content}`);
        } else {
          console.log(`[mesh tap ${row.from_label} #${row.id}] ${row.content}`);
        }
      }
    }
  } catch (err) {
    // Database might not exist yet or be locked — that's fine, retry next poll
    if (!err.message.includes('no such table') && !err.message.includes('SQLITE_BUSY')) {
      process.stderr.write(`[mesh-poll] ${err.message}\n`);
    }
  } finally {
    try { db?.close(); } catch { /* ignore */ }
  }
}

// Poll loop
const timer = setInterval(poll, intervalMs);

// Clean shutdown
process.on('SIGTERM', () => { clearInterval(timer); process.exit(0); });
process.on('SIGINT', () => { clearInterval(timer); process.exit(0); });

// First poll immediately
poll();
