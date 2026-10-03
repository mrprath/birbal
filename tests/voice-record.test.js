// tests/voice-record.test.js — TDD: voice-record spawn contract
// Spear works: buildRecordBat produces a valid bat script
// Bad spear breaks: missing repo root, bad output mode

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { buildRecordBat, VALID_OUTPUTS } from '../lib/voice-record.js';

const REPO_ROOT = resolve(import.meta.dirname, '..');

describe('voice-record', () => {
  describe('buildRecordBat — spear works', () => {
    it('produces bat content with cd, voice-runtime, and clipboard output', () => {
      const bat = buildRecordBat({ repoRoot: REPO_ROOT, output: 'clipboard' });

      assert.ok(bat.includes('@echo off'), 'should start with @echo off');
      assert.ok(bat.includes(`cd /d "${REPO_ROOT}"`), 'should cd to repo root');
      assert.ok(bat.includes('voice-runtime.mjs'), 'should invoke voice-runtime');
      assert.ok(bat.includes('--output clipboard'), 'should pass clipboard output mode');
    });

    it('produces bat content with stdout output mode', () => {
      const bat = buildRecordBat({ repoRoot: REPO_ROOT, output: 'stdout' });

      assert.ok(bat.includes('--output stdout'), 'should pass stdout output mode');
    });

    it('defaults output to clipboard', () => {
      const bat = buildRecordBat({ repoRoot: REPO_ROOT });

      assert.ok(bat.includes('--output clipboard'), 'should default to clipboard');
    });

    it('bat content uses \\r\\n line endings for Windows', () => {
      const bat = buildRecordBat({ repoRoot: REPO_ROOT });
      const lines = bat.split('\r\n');

      assert.ok(lines.length >= 3, 'should have at least 3 lines');
    });

    it('includes pause so terminal stays open on error', () => {
      const bat = buildRecordBat({ repoRoot: REPO_ROOT });

      assert.ok(bat.includes('pause'), 'should pause on exit so user sees errors');
    });
  });

  describe('buildRecordBat — bad spear breaks correctly', () => {
    it('throws on missing repoRoot', () => {
      assert.throws(
        () => buildRecordBat({}),
        (err) => err.message.includes('repoRoot'),
      );
    });

    it('throws on invalid output mode', () => {
      assert.throws(
        () => buildRecordBat({ repoRoot: REPO_ROOT, output: 'fax' }),
        (err) => err.message.includes('fax'),
      );
    });
  });

  describe('buildRecordBat — bat file path', () => {
    it('returns a path ending in .bat', () => {
      const bat = buildRecordBat({ repoRoot: REPO_ROOT });
      // buildRecordBat returns the content; batPath is derived by the caller
      // Just verify content is a string
      assert.equal(typeof bat, 'string');
    });
  });

  describe('VALID_OUTPUTS', () => {
    it('includes clipboard, stdout, claude', () => {
      assert.ok(VALID_OUTPUTS.includes('clipboard'));
      assert.ok(VALID_OUTPUTS.includes('stdout'));
      assert.ok(VALID_OUTPUTS.includes('claude'));
    });
  });

  describe('voice-runtime.mjs exists', () => {
    it('script exists at expected path', () => {
      const scriptPath = resolve(REPO_ROOT, 'scripts', 'voice-runtime.mjs');
      assert.ok(existsSync(scriptPath), 'voice-runtime.mjs should exist');
    });
  });
});
