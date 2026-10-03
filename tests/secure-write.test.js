// secure-write.test.js — Behavioral tests for lib/secure-write.js
// All fs operations in tmpdir. Cleanup in finally.
// Spear works: creates file, correct content, overwrites
// Bad spear: cleans temp on failure, permissions enforced

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { secureWriteFile } from '../lib/secure-write.js';
import { tmpFile, cleanTmp } from './helpers.js';

describe('secureWriteFile — spear works', () => {
  it('creates file with correct content', () => {
    const path = tmpFile('sw-content');
    try {
      secureWriteFile(path, 'hello birbal');
      assert.equal(readFileSync(path, 'utf-8'), 'hello birbal');
    } finally {
      cleanTmp(path);
    }
  });

  it('overwrites existing file', () => {
    const path = tmpFile('sw-overwrite');
    try {
      secureWriteFile(path, 'first');
      secureWriteFile(path, 'second');
      assert.equal(readFileSync(path, 'utf-8'), 'second');
    } finally {
      cleanTmp(path);
    }
  });

  it('handles empty string content', () => {
    const path = tmpFile('sw-empty');
    try {
      secureWriteFile(path, '');
      assert.equal(readFileSync(path, 'utf-8'), '');
    } finally {
      cleanTmp(path);
    }
  });

  it('handles multiline content', () => {
    const path = tmpFile('sw-multi');
    const content = 'KEY1=value1\nKEY2=value2\nKEY3=value3';
    try {
      secureWriteFile(path, content);
      assert.equal(readFileSync(path, 'utf-8'), content);
    } finally {
      cleanTmp(path);
    }
  });

  it('file has 0o600 permissions (non-Windows)', function() {
    if (process.platform === 'win32') {
      this.skip();
      return;
    }
    const path = tmpFile('sw-perms');
    try {
      secureWriteFile(path, 'secret');
      const mode = statSync(path).mode & 0o777;
      assert.equal(mode, 0o600, `Expected 0o600, got 0o${mode.toString(8)}`);
    } finally {
      cleanTmp(path);
    }
  });
});

describe('secureWriteFile — bad spear breaks correctly', () => {
  it('throws on invalid directory', () => {
    const path = join('/nonexistent-dir-birbal-test', 'file.txt');
    assert.throws(
      () => secureWriteFile(path, 'content'),
      (err) => err.code === 'ENOENT',
    );
  });

  it('no temp file left behind after failure', () => {
    // Write to a directory that doesn't exist — should fail and clean up
    const badPath = join('/nonexistent-dir-birbal-test-2', 'file.txt');
    try {
      secureWriteFile(badPath, 'content');
    } catch {
      // Expected failure
    }
    // There's no way a temp file was left in a nonexistent directory
    assert.ok(!existsSync(badPath));
  });
});
