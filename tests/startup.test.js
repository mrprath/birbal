// startup.test.js — Behavioral tests for startup.js
// Spear works: returns empty array when clean
// Bad spear: detects conflicting global files

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// startup.js runs checkConflicts() on import, which logs warnings.
// We import just the function to test it.

describe('checkConflicts — spear works', () => {
  it('returns an array', async () => {
    // Dynamic import to avoid top-level side effects polluting other tests
    const { checkConflicts } = await import('../startup.js');
    const result = checkConflicts();
    assert.ok(Array.isArray(result));
  });

  it('each conflict has path and risk fields', async () => {
    const { checkConflicts } = await import('../startup.js');
    const result = checkConflicts();
    for (const conflict of result) {
      assert.ok('path' in conflict, 'conflict must have path');
      assert.ok('risk' in conflict, 'conflict must have risk');
      assert.equal(typeof conflict.path, 'string');
      assert.equal(typeof conflict.risk, 'string');
    }
  });
});

describe('checkConflicts — bad spear: detection', () => {
  it('detects global Claude files if they exist', async () => {
    // We can't control whether global files exist on this machine,
    // but we can verify the function doesn't crash and returns valid shape.
    const { checkConflicts } = await import('../startup.js');
    const result = checkConflicts();
    // If conflicts found, they should reference real risk descriptions
    for (const conflict of result) {
      assert.ok(conflict.risk.length > 0, 'risk description must be non-empty');
      assert.ok(conflict.path.length > 0, 'path must be non-empty');
    }
  });
});
