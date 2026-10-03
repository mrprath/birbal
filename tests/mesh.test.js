// tests/mesh.test.js — Mesh contract tests
// WHY: The mesh is the coordination layer. If it breaks, sessions improvise.
// These tests verify the contracts from SKILL.md against real SQLite.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Mesh, initSchema, sweep } from '../mcp/mesh.js';
import Database from 'better-sqlite3';
import { tmpFile, cleanTmp } from './helpers.js';

// Each test gets its own temp database — no shared state, no cleanup races.
function makeMesh(label, dbPath) {
  return new Mesh({ dbPath, label, sessionId: `test-${label}-${Date.now()}` });
}

describe('mesh', () => {
  let dbPath;

  before(() => {
    dbPath = tmpFile('mesh-test') + '.db';
  });

  after(() => {
    cleanTmp([dbPath, dbPath + '-wal', dbPath + '-shm']);
  });

  describe('schema', () => {
    it('initSchema is idempotent', () => {
      const db = new Database(dbPath);
      initSchema(db);
      initSchema(db); // second call must not throw
      db.close();
    });
  });

  describe('rename-on-join: label set before first tap', () => {
    it('rename changes label and returns old/new', () => {
      const m = makeMesh('default', dbPath);
      m.start();
      try {
        const result = m.rename('orchestrator');
        assert.equal(result.renamed, true);
        assert.equal(result.from, 'default');
        assert.equal(result.to, 'orchestrator');
        assert.equal(m.label, 'orchestrator');
      } finally {
        m.stop();
      }
    });

    it('rename rejects duplicate labels from other sessions', () => {
      const m1 = makeMesh('alice', dbPath);
      const m2 = makeMesh('bob', dbPath);
      m1.start();
      m2.start();
      try {
        const result = m2.rename('alice');
        assert.ok(result.error);
        assert.match(result.error, /already taken/);
        assert.equal(m2.label, 'bob'); // unchanged
      } finally {
        m1.stop();
        m2.stop();
      }
    });
  });

  describe('roster-not-proof: stale after 60s cold heartbeat', () => {
    it('reports active peer as active', () => {
      const m = makeMesh('fresh-peer', dbPath);
      m.start();
      try {
        const agents = m.agents();
        const me = agents.find(a => a.is_me);
        assert.ok(me);
        assert.equal(me.status, 'active');
        assert.equal(me.label, 'fresh-peer');
      } finally {
        m.stop();
      }
    });

    it('reports peer as stale when heartbeat is old', () => {
      const m = makeMesh('stale-test', dbPath);
      m.start();
      try {
        // Manually backdate the heartbeat
        const db = new Database(dbPath);
        db.prepare('UPDATE peers SET heartbeat = ? WHERE label = ?')
          .run(Date.now() - 120_000, 'stale-test');
        db.close();

        const agents = m.agents();
        const me = agents.find(a => a.label === 'stale-test');
        assert.ok(me);
        assert.equal(me.status, 'stale');
      } finally {
        m.stop();
      }
    });
  });

  describe('mesh_send and mesh_reply', () => {
    it('send delivers a message, reply answers it', () => {
      const m1 = makeMesh('sender', dbPath);
      const m2 = makeMesh('receiver', dbPath);
      m1.start();
      m2.start();
      try {
        // Send
        const sendResult = m1.send('receiver', 'hello from sender');
        assert.equal(sendResult.sent, true);
        assert.ok(sendResult.message_id);

        // Poll as receiver
        const messages = m2.poll();
        assert.equal(messages.length, 1);
        assert.equal(messages[0].from_label, 'sender');
        assert.equal(messages[0].content, 'hello from sender');

        // Reply
        const replyResult = m2.reply(messages[0].id, 'got it');
        assert.equal(replyResult.sent, true);
        assert.equal(replyResult.reply_to, messages[0].id);
        assert.equal(replyResult.to, 'sender');

        // Poll as sender — should see the reply
        const replies = m1.poll();
        assert.equal(replies.length, 1);
        assert.equal(replies[0].content, 'got it');
        assert.equal(replies[0].reply_to, sendResult.message_id);
      } finally {
        m1.stop();
        m2.stop();
      }
    });

    it('send to nonexistent peer returns error', () => {
      const m = makeMesh('lonely', dbPath);
      m.start();
      try {
        const result = m.send('nobody', 'hello?');
        assert.ok(result.error);
        assert.match(result.error, /No peer/);
      } finally {
        m.stop();
      }
    });

    it('reply to nonexistent message returns error', () => {
      const m = makeMesh('replier', dbPath);
      m.start();
      try {
        const result = m.reply('fake-id', 'what?');
        assert.ok(result.error);
        assert.match(result.error, /not found/);
      } finally {
        m.stop();
      }
    });
  });

  describe('poll marks messages as read', () => {
    it('second poll returns empty after first poll read all', () => {
      const m1 = makeMesh('poll-sender', dbPath);
      const m2 = makeMesh('poll-receiver', dbPath);
      m1.start();
      m2.start();
      try {
        m1.send('poll-receiver', 'once');
        const first = m2.poll();
        assert.equal(first.length, 1);
        const second = m2.poll();
        assert.equal(second.length, 0);
      } finally {
        m1.stop();
        m2.stop();
      }
    });
  });

  describe('db-never-wiped: sweep purges old, not all', () => {
    it('sweep removes old messages but keeps recent ones', () => {
      const db = new Database(dbPath);
      initSchema(db);
      const now = Date.now();
      const old = now - (25 * 60 * 60 * 1000); // 25h ago

      db.prepare('INSERT INTO messages (id, from_label, to_label, content, created_at) VALUES (?, ?, ?, ?, ?)')
        .run('old-msg', 'a', 'b', 'ancient', old);
      db.prepare('INSERT INTO messages (id, from_label, to_label, content, created_at) VALUES (?, ?, ?, ?, ?)')
        .run('new-msg', 'a', 'b', 'fresh', now);

      sweep(db);

      const remaining = db.prepare('SELECT id FROM messages WHERE id IN (?, ?)').all('old-msg', 'new-msg');
      const ids = remaining.map(r => r.id);
      assert.ok(!ids.includes('old-msg'), 'old message should be swept');
      assert.ok(ids.includes('new-msg'), 'new message should survive');
      db.close();
    });
  });

  describe('rename preserves role and spawner', () => {
    it('role survives a rename', () => {
      const dbDirect = new Database(dbPath);
      initSchema(dbDirect);
      // Insert a peer with a role directly
      dbDirect.prepare(`
        INSERT OR REPLACE INTO peers (label, session_id, heartbeat, role, spawner)
        VALUES (?, ?, ?, ?, ?)
      `).run('role-test', 'sid-role', Date.now(), 'verifier', 'parent-orch');
      dbDirect.close();

      const m = new Mesh({ dbPath, label: 'role-test', sessionId: 'sid-role' });
      m.start();
      try {
        m.rename('role-test-renamed');
        const agents = m.agents();
        const me = agents.find(a => a.is_me);
        assert.equal(me.label, 'role-test-renamed');
        assert.equal(me.role, 'verifier');
      } finally {
        m.stop();
      }
    });
  });

  describe('rename updates message references', () => {
    it('messages addressed to old label are rewritten', () => {
      const m1 = makeMesh('msg-sender', dbPath);
      const m2 = makeMesh('old-name', dbPath);
      m1.start();
      m2.start();
      try {
        m1.send('old-name', 'before rename');
        m2.rename('new-name');

        // Message should now be addressed to new-name
        const messages = m2.poll();
        assert.equal(messages.length, 1);
        assert.equal(messages[0].content, 'before rename');
      } finally {
        m1.stop();
        m2.stop();
      }
    });
  });
});
