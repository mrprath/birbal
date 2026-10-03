// tests/email-sort/categories.test.js — Category definition tests
// Ensures categories and actions stay consistent.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

import { CATEGORIES, CATEGORY_NAMES, ACTIONS } from '../../.claude/skills/email-sort/categories.js';

describe('categories — does the spear work', () => {
  it('has exactly 10 categories', () => {
    assert.equal(CATEGORY_NAMES.length, 10);
  });

  it('every category has a non-empty description', () => {
    for (const [name, desc] of Object.entries(CATEGORIES)) {
      assert.ok(desc.length > 0, `${name} has empty description`);
    }
  });

  it('every category has a defined action', () => {
    for (const name of CATEGORY_NAMES) {
      assert.ok(name in ACTIONS, `${name} has no action defined`);
    }
  });

  it('no action references a category that does not exist', () => {
    for (const name of Object.keys(ACTIONS)) {
      assert.ok(CATEGORY_NAMES.includes(name),
        `Action defined for unknown category: ${name}`);
    }
  });

  it('spam action archives without labeling', () => {
    assert.equal(ACTIONS.spam.archive, true);
    assert.equal(ACTIONS.spam.label, undefined);
  });

  it('shopping_promos goes to Promotions tab', () => {
    assert.equal(ACTIONS.shopping_promos.promotions, true);
  });

  it('newsletters gets a label', () => {
    assert.equal(ACTIONS.newsletters.label, 'Newsletters');
  });
});

describe('categories — does the bad spear break correctly', () => {
  it('category names are snake_case', () => {
    for (const name of CATEGORY_NAMES) {
      assert.match(name, /^[a-z][a-z0-9_]*$/,
        `${name} is not snake_case`);
    }
  });

  it('no duplicate category names', () => {
    const unique = new Set(CATEGORY_NAMES);
    assert.equal(unique.size, CATEGORY_NAMES.length);
  });
});
