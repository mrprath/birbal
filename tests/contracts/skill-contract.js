// skill-contract.js — Contract definition for Birbal skills
// WHY: Skills are contract-tested, not unit-tested. This module defines what
// the contract requires and provides check functions that return pass/fail.
// The test file parameterizes these checks across all discovered skills.

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Discover all skill directories under skills/.
 * A skill directory must contain a SKILL.md file.
 *
 * @param {string} skillsDir - Path to the skills/ directory
 * @returns {Array<{ name: string, dir: string, skillMd: string }>}
 */
export function discoverSkills(skillsDir) {
  if (!existsSync(skillsDir)) return [];

  return readdirSync(skillsDir)
    .filter(entry => {
      const full = join(skillsDir, entry);
      return statSync(full).isDirectory() && existsSync(join(full, 'SKILL.md'));
    })
    .map(entry => ({
      name: entry,
      dir: join(skillsDir, entry),
      skillMd: join(skillsDir, entry, 'SKILL.md'),
    }));
}

/**
 * Parse YAML-ish frontmatter from a SKILL.md file.
 * Extracts key: value pairs between --- delimiters.
 * WHY not a yaml lib: zero deps. Frontmatter is simple enough for regex.
 *
 * @param {string} content - Raw SKILL.md content
 * @returns {object} Parsed frontmatter fields
 */
export function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};

  const result = {};
  let currentKey = null;

  for (const line of match[1].split('\n')) {
    // Multi-line value continuation (starts with spaces, no colon)
    if (currentKey && /^\s+/.test(line) && !line.includes(':')) {
      result[currentKey] += ' ' + line.trim();
      continue;
    }

    const kvMatch = line.match(/^(\w[\w-]*):\s*(.*)/);
    if (kvMatch) {
      currentKey = kvMatch[1];
      const val = kvMatch[2].trim();
      // Handle YAML list items
      if (val === '' || val === '>') {
        result[currentKey] = '';
      } else {
        result[currentKey] = val;
      }
    }

    // YAML list item
    const listMatch = line.match(/^\s+-\s+(.*)/);
    if (listMatch && currentKey) {
      if (!Array.isArray(result[currentKey])) {
        result[currentKey] = result[currentKey] === '' ? [] : [result[currentKey]];
      }
      result[currentKey].push(listMatch[1].trim().replace(/^["']|["']$/g, ''));
    }
  }

  return result;
}

// Patterns that indicate direct HTTP imports (should use transport gate)
const HTTP_IMPORT_PATTERNS = [
  /\bimport\b.*\bfrom\s+['"](?:node:)?https?['"]/,
  /\brequire\s*\(\s*['"](?:node:)?https?['"]\s*\)/,
  /\bimport\b.*\bfrom\s+['"](?:node-fetch|axios|got|undici)['"]/,
  /\brequire\s*\(\s*['"](?:node-fetch|axios|got|undici)['"]\s*\)/,
];

// Patterns that look like hardcoded credentials
const CREDENTIAL_PATTERNS = [
  /(?:api[_-]?key|apikey)\s*[:=]\s*['"][a-zA-Z0-9_\-]{20,}['"]/i,
  /(?:secret|password|passwd|token)\s*[:=]\s*['"][a-zA-Z0-9_\-]{8,}['"]/i,
  /ghp_[a-zA-Z0-9]{36}/,
  /sk-[a-zA-Z0-9]{32,}/,
  /ntn_[a-zA-Z0-9]{32,}/,
];

// Eval-context patterns
const EVAL_PATTERNS = [
  /\beval\s*\(/,
  /new\s+Function\s*\(/,
  /exec(?:Sync)?\s*\(\s*`[^`]*\$\{/,
];

/**
 * Check all JS files in a skill directory for banned patterns.
 *
 * @param {string} dir - Skill directory path
 * @param {RegExp[]} patterns - Patterns to check for
 * @returns {string[]} Violation descriptions (empty = pass)
 */
export function scanForPatterns(dir, patterns) {
  const violations = [];

  function walk(d) {
    for (const entry of readdirSync(d)) {
      const full = join(d, entry);
      if (entry === 'node_modules' || entry === '__pycache__') continue;
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (full.endsWith('.js') || full.endsWith('.mjs')) {
        const content = readFileSync(full, 'utf-8');
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const trimmed = lines[i].trim();
          if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
          for (const pattern of patterns) {
            if (pattern.test(lines[i])) {
              const rel = relative(dir, full).replace(/\\/g, '/');
              violations.push(`${rel}:${i + 1} — ${trimmed.slice(0, 100)}`);
            }
          }
        }
      }
    }
  }

  walk(dir);
  return violations;
}

/**
 * The full contract. Returns all check results for a skill.
 */
export const CONTRACT = {
  /** SKILL.md must exist (already guaranteed by discovery, but explicit) */
  hasSkillMd: (skill) => existsSync(skill.skillMd),

  /** Frontmatter must have name, description, version */
  hasFrontmatter: (skill) => {
    const content = readFileSync(skill.skillMd, 'utf-8');
    const fm = parseFrontmatter(content);
    return {
      hasName: !!fm.name,
      hasDescription: !!fm.description,
      hasVersion: !!fm.version,
      frontmatter: fm,
    };
  },

  /** Directory name must be kebab-case */
  isKebabCase: (skill) => /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(skill.name),

  /** Directory name must match frontmatter name */
  nameMatches: (skill) => {
    const content = readFileSync(skill.skillMd, 'utf-8');
    const fm = parseFrontmatter(content);
    return fm.name === skill.name;
  },

  /** No direct HTTP imports in JS files */
  noDirectHttp: (skill) => scanForPatterns(skill.dir, HTTP_IMPORT_PATTERNS),

  /** No hardcoded credentials in JS files */
  noHardcodedCreds: (skill) => scanForPatterns(skill.dir, CREDENTIAL_PATTERNS),

  /** No eval contexts in JS files */
  noEval: (skill) => scanForPatterns(skill.dir, EVAL_PATTERNS),
};
