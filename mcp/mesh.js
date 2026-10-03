// mcp/mesh.js — Birbal Mesh: peer-to-peer bus over SQLite
// WHY: Independent Claude windows need to tap each other without a server.
// One SQLite file, four verbs. No broker, no socket.
//
// This module owns the database schema, heartbeat, and tool registration.
// It registers mesh_agents, mesh_send, mesh_reply, mesh_rename with the ToolRegistry.

import Database from 'better-sqlite3';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DB_PATH = resolve(__dirname, '..', 'mesh.db');

// Stale after 60s without heartbeat
const STALE_MS = 60_000;
// Purge dead rows after 24h
const PURGE_MS = 24 * 60 * 60 * 1000;
// Heartbeat interval
const HEARTBEAT_MS = 15_000;

/**
 * Initialize the mesh database schema.
 * Idempotent — safe to call on every startup.
 */
export function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS peers (
      label       TEXT PRIMARY KEY,
      session_id  TEXT NOT NULL,
      heartbeat   INTEGER NOT NULL,
      spawner     TEXT,
      role        TEXT DEFAULT 'builder'
    );

    CREATE TABLE IF NOT EXISTS messages (
      id          TEXT PRIMARY KEY,
      from_label  TEXT NOT NULL,
      to_label    TEXT NOT NULL,
      content     TEXT NOT NULL,
      reply_to    TEXT,
      created_at  INTEGER NOT NULL,
      read        INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_messages_to ON messages(to_label, read);
  `);
}

/**
 * Sweep: purge messages older than PURGE_MS, remove peers stale beyond PURGE_MS.
 */
export function sweep(db) {
  const cutoff = Date.now() - PURGE_MS;
  db.prepare('DELETE FROM messages WHERE created_at < ?').run(cutoff);
  db.prepare('DELETE FROM peers WHERE heartbeat < ?').run(cutoff);
}

/**
 * The Mesh instance — one per MCP server process.
 * Manages this session's identity, heartbeat, and the four verbs.
 */
export class Mesh {
  /**
   * @param {object} [opts]
   * @param {string} [opts.dbPath] - Path to mesh.db
   * @param {string} [opts.sessionId] - Unique session ID (default: random UUID)
   * @param {string} [opts.label] - Initial label (default: 'birbal')
   */
  constructor(opts = {}) {
    this._dbPath = opts.dbPath || DEFAULT_DB_PATH;
    this._sessionId = opts.sessionId || randomUUID();
    this._label = opts.label || 'birbal';
    this._heartbeatTimer = null;
    this._db = null;
  }

  /** Open the database, init schema, register self, start heartbeat. */
  start() {
    this._db = new Database(this._dbPath);
    this._db.pragma('journal_mode = WAL');  // WAL for concurrent reads
    this._db.pragma('busy_timeout = 5000');
    initSchema(this._db);
    sweep(this._db);
    this._registerSelf();
    this._startHeartbeat();
  }

  /** Stop heartbeat, deregister self, close database. */
  stop() {
    this._stopHeartbeat();
    if (this._db) {
      try {
        this._db.prepare('DELETE FROM peers WHERE session_id = ?').run(this._sessionId);
      } catch { /* db may already be closed */ }
      try { this._db.close(); } catch { /* ignore */ }
      this._db = null;
    }
  }

  /** Register this session in the peers table. */
  _registerSelf() {
    this._db.prepare(`
      INSERT INTO peers (label, session_id, heartbeat)
      VALUES (?, ?, ?)
      ON CONFLICT(label) DO UPDATE SET session_id = excluded.session_id, heartbeat = excluded.heartbeat
    `).run(this._label, this._sessionId, Date.now());
  }

  _startHeartbeat() {
    this._heartbeatTimer = setInterval(() => {
      try {
        this._db.prepare('UPDATE peers SET heartbeat = ? WHERE session_id = ?')
          .run(Date.now(), this._sessionId);
      } catch { /* db closed, timer will be cleared */ }
    }, HEARTBEAT_MS);
    // Don't block process exit
    if (this._heartbeatTimer.unref) this._heartbeatTimer.unref();
  }

  _stopHeartbeat() {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
  }

  // --- The four verbs ---

  /** mesh_agents: who's on the mesh */
  agents() {
    const now = Date.now();
    const rows = this._db.prepare('SELECT label, session_id, heartbeat, spawner, role FROM peers').all();
    return rows.map(r => ({
      label: r.label,
      role: r.role,
      status: (now - r.heartbeat) < STALE_MS ? 'active' : 'stale',
      last_heartbeat_ms_ago: now - r.heartbeat,
      spawner: r.spawner || null,
      is_me: r.session_id === this._sessionId,
    }));
  }

  /** mesh_send: tap a peer by label */
  send(toLabel, content) {
    const peer = this._db.prepare('SELECT label FROM peers WHERE label = ?').get(toLabel);
    if (!peer) {
      return { error: `No peer with label "${toLabel}" on the mesh. Use mesh_agents to see who's here.` };
    }
    const id = randomUUID();
    this._db.prepare(`
      INSERT INTO messages (id, from_label, to_label, content, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, this._label, toLabel, content, Date.now());
    return { sent: true, message_id: id, to: toLabel };
  }

  /** mesh_reply: answer a tap by message ID */
  reply(messageId, content) {
    const original = this._db.prepare('SELECT id, from_label FROM messages WHERE id = ?').get(messageId);
    if (!original) {
      return { error: `Message "${messageId}" not found.` };
    }
    const id = randomUUID();
    this._db.prepare(`
      INSERT INTO messages (id, from_label, to_label, content, reply_to, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, this._label, original.from_label, content, messageId, Date.now());
    return { sent: true, message_id: id, reply_to: messageId, to: original.from_label };
  }

  /** mesh_rename: change this session's label */
  rename(newLabel) {
    const oldLabel = this._label;
    // Check for collision
    const existing = this._db.prepare('SELECT session_id FROM peers WHERE label = ?').get(newLabel);
    if (existing && existing.session_id !== this._sessionId) {
      return { error: `Label "${newLabel}" is already taken by another session.` };
    }

    const renameAll = this._db.transaction(() => {
      const current = this._db.prepare('SELECT role, spawner FROM peers WHERE session_id = ?').get(this._sessionId);
      this._db.prepare('DELETE FROM peers WHERE session_id = ?').run(this._sessionId);
      this._db.prepare(`
        INSERT INTO peers (label, session_id, heartbeat, role, spawner)
        VALUES (?, ?, ?, ?, ?)
      `).run(newLabel, this._sessionId, Date.now(), current?.role || 'builder', current?.spawner || null);
      this._db.prepare('UPDATE messages SET from_label = ? WHERE from_label = ?').run(newLabel, oldLabel);
      this._db.prepare('UPDATE messages SET to_label = ? WHERE to_label = ?').run(newLabel, oldLabel);
    });
    renameAll();

    this._label = newLabel;
    return { renamed: true, from: oldLabel, to: newLabel };
  }

  /** Poll for unread messages addressed to this session */
  poll() {
    const rows = this._db.prepare(`
      SELECT id, from_label, content, reply_to, created_at
      FROM messages
      WHERE to_label = ? AND read = 0
      ORDER BY created_at ASC
    `).all(this._label);

    if (rows.length > 0) {
      const ids = rows.map(r => r.id);
      this._db.prepare(
        `UPDATE messages SET read = 1 WHERE id IN (${ids.map(() => '?').join(',')})`
      ).run(...ids);
    }

    return rows;
  }

  get label() { return this._label; }
  get sessionId() { return this._sessionId; }
}

// --- Tool schemas for MCP registration ---

const MESH_TOOLS = {
  mesh_agents: {
    schema: {
      type: 'object',
      description: 'List all peers on the Birbal Mesh with their labels, roles, and liveness status.',
      properties: {},
      required: [],
    },
    handler: (mesh) => (_args) => mesh.agents(),
  },

  mesh_send: {
    schema: {
      type: 'object',
      description: 'Send a message (tap) to a peer on the mesh by their label.',
      properties: {
        workspace: { type: 'string', description: 'The label of the peer to tap' },
        content: { type: 'string', description: 'The message content' },
      },
      required: ['workspace', 'content'],
    },
    handler: (mesh) => (args) => mesh.send(args.workspace, args.content),
  },

  mesh_reply: {
    schema: {
      type: 'object',
      description: 'Reply to a specific mesh message by its ID.',
      properties: {
        message_id: { type: 'string', description: 'The ID of the message to reply to' },
        content: { type: 'string', description: 'The reply content' },
      },
      required: ['message_id', 'content'],
    },
    handler: (mesh) => (args) => mesh.reply(args.message_id, args.content),
  },

  mesh_rename: {
    schema: {
      type: 'object',
      description: 'Rename this session on the mesh. Use a unique, descriptive label.',
      properties: {
        label: { type: 'string', description: 'The new label for this session' },
      },
      required: ['label'],
    },
    handler: (mesh) => (args) => mesh.rename(args.label),
  },
};

/**
 * Register all mesh tools with a ToolRegistry.
 * @param {import('./registry.js').ToolRegistry} registry
 * @param {Mesh} mesh
 */
export function registerMeshTools(registry, mesh) {
  for (const [name, tool] of Object.entries(MESH_TOOLS)) {
    registry.registerTool(name, tool.schema, null, tool.handler(mesh));
  }
}
