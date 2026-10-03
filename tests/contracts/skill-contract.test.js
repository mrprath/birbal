// skill-contract.test.js — Run every skill through the contract
// Not unit tests — interface verification.
// Discovers all skills/*/SKILL.md, parameterizes contract checks across them.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { repoRoot } from '../helpers.js';
import { discoverSkills, CONTRACT } from './skill-contract.js';

const SKILLS_DIR = join(repoRoot(), '.claude', 'skills');
const skills = discoverSkills(SKILLS_DIR);

describe('skill discovery', () => {
  it('finds at least one skill', () => {
    assert.ok(skills.length > 0, `No skills found in ${SKILLS_DIR}`);
  });
});

describe('contract: SKILL.md exists', () => {
  for (const skill of skills) {
    it(`${skill.name} has SKILL.md`, () => {
      assert.ok(CONTRACT.hasSkillMd(skill));
    });
  }
});

describe('contract: frontmatter has name, description, version', () => {
  for (const skill of skills) {
    it(`${skill.name} has required frontmatter fields`, () => {
      const result = CONTRACT.hasFrontmatter(skill);
      assert.ok(result.hasName, `${skill.name}: missing 'name' in frontmatter`);
      assert.ok(result.hasDescription, `${skill.name}: missing 'description' in frontmatter`);
      assert.ok(result.hasVersion, `${skill.name}: missing 'version' in frontmatter`);
    });
  }
});

describe('contract: directory name is kebab-case', () => {
  for (const skill of skills) {
    it(`${skill.name} is kebab-case`, () => {
      assert.ok(CONTRACT.isKebabCase(skill),
        `${skill.name} is not kebab-case`);
    });
  }
});

describe('contract: directory name matches frontmatter name', () => {
  for (const skill of skills) {
    it(`${skill.name} matches frontmatter`, () => {
      assert.ok(CONTRACT.nameMatches(skill),
        `Directory '${skill.name}' does not match frontmatter name`);
    });
  }
});

describe('contract: no direct HTTP imports (transport gate)', () => {
  for (const skill of skills) {
    it(`${skill.name} uses transport gate`, () => {
      const violations = CONTRACT.noDirectHttp(skill);
      assert.deepEqual(violations, [],
        `${skill.name} has direct HTTP imports:\n${violations.join('\n')}`);
    });
  }
});

describe('contract: no hardcoded credentials', () => {
  for (const skill of skills) {
    it(`${skill.name} has no hardcoded creds`, () => {
      const violations = CONTRACT.noHardcodedCreds(skill);
      assert.deepEqual(violations, [],
        `${skill.name} has hardcoded credentials:\n${violations.join('\n')}`);
    });
  }
});

describe('contract: no eval contexts', () => {
  for (const skill of skills) {
    it(`${skill.name} has no eval`, () => {
      const violations = CONTRACT.noEval(skill);
      assert.deepEqual(violations, [],
        `${skill.name} has eval contexts:\n${violations.join('\n')}`);
    });
  }
});
