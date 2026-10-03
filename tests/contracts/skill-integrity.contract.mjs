// skill-integrity.contract.mjs — Functional contracts for: every skill has valid structure per skill-builder
// Group: SKL (skill-integrity)
//
// Each case asserts a user-visible outcome, not an implementation detail.
// WHY: implementation assertions pass through refactors that break the promise
// and fail on refactors that keep it.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
const SKILLS_DIR = join(REPO_ROOT, '.claude', 'skills');

/** Discover all skill directories that contain SKILL.md */
function discoverSkills() {
  if (!existsSync(SKILLS_DIR)) return [];
  return readdirSync(SKILLS_DIR)
    .filter(entry => {
      const full = join(SKILLS_DIR, entry);
      return statSync(full).isDirectory() && existsSync(join(full, 'SKILL.md'));
    })
    .map(name => ({
      name,
      dir: join(SKILLS_DIR, name),
      content: readFileSync(join(SKILLS_DIR, name, 'SKILL.md'), 'utf-8'),
    }));
}

const skills = discoverSkills();

describe('skill-integrity contracts', () => {

  // covers: skill-builder, skills/*/SKILL.md
  it('SKL-001 at least one skill exists', () => {
    assert.ok(skills.length > 0, 'No skills found in .claude/skills/');
  });

  for (const skill of skills) {

    // covers: skill-builder
    it(`SKL-002 ${skill.name} has an opener with failure mode`, () => {
      // The opener must contain "because" — that is the failure mode (Z)
      // Match after the frontmatter and heading
      const body = skill.content.replace(/^---[\s\S]*?---/, '').trim();
      // Find the first paragraph after the first heading
      const afterHeading = body.replace(/^#[^\n]*\n+/, '').trim();
      const firstParagraph = afterHeading.split('\n\n')[0];
      assert.ok(
        firstParagraph.toLowerCase().includes('because') ||
        firstParagraph.toLowerCase().includes('use this when'),
        `${skill.name}: opener does not follow "This skill X. Use this when Y, because Z." formula.\nGot: ${firstParagraph.slice(0, 200)}`
      );
    });

    // covers: skill-builder
    it(`SKL-003 ${skill.name} has an anatomy block`, () => {
      assert.ok(
        skill.content.includes('anatomy:') && skill.content.includes('failure_mode:'),
        `${skill.name}: missing anatomy YAML block with failure_mode`
      );
    });

    // covers: skill-builder
    it(`SKL-004 ${skill.name} has self-improvement criteria`, () => {
      assert.ok(
        /##\s*self-improvement criteria/i.test(skill.content),
        `${skill.name}: missing "## Self-improvement criteria" section`
      );
    });

    // covers: skill-builder
    it(`SKL-005 ${skill.name} has no per-skill feedback loop block`, () => {
      assert.ok(
        !skill.content.includes('[FEEDBACK-LOOP]'),
        `${skill.name}: contains a per-skill [FEEDBACK-LOOP] block — the global loop handles this`
      );
    });

    // covers: skill-builder
    it(`SKL-006 ${skill.name} has no changelog section`, () => {
      assert.ok(
        !/##\s*changelog/i.test(skill.content),
        `${skill.name}: contains a changelog section — changelogs belong in git, not skills`
      );
    });

    // covers: skill-builder
    it(`SKL-007 ${skill.name} directory is kebab-case`, () => {
      assert.ok(
        /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(skill.name),
        `${skill.name}: directory name is not kebab-case`
      );
    });
  }
});
