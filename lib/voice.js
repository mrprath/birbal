// lib/voice.js — Blog voice linter
// Loads rules from references/voice.md, checks text against hard rules.
// Returns violations list. Zero violations = post is publish-ready.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');

const BANNED_WORDS = [
  'delve', 'leverage', 'robust', 'seamless',
  "in today's", "it's worth noting", "at its core",
];

const EM_DASH = /\u2014/g;
const EN_DASH = /\u2013/g;

/**
 * Lint a blog post against the voice rules.
 *
 * @param {string} text - The full post text (markdown)
 * @param {string} title - The post title
 * @param {object} opts
 * @param {string} opts.tag - Post tag (Field Note, Case Study, etc.)
 * @returns {{ violations: Array<{rule: string, location: string, suggestion: string}>, clean: boolean }}
 */
export function lint(text, title, opts = {}) {
  const violations = [];

  // Rule: title all lowercase
  if (title !== title.toLowerCase()) {
    violations.push({
      rule: 'title-lowercase',
      location: 'title',
      suggestion: `Title must be all lowercase. Got: "${title}". Use: "${title.toLowerCase()}"`,
    });
  }

  // Rule: first sentence starts lowercase
  const firstLine = text.split('\n').find(l => l.trim().length > 0);
  if (firstLine) {
    const firstChar = firstLine.trim()[0];
    if (firstChar && firstChar === firstChar.toUpperCase() && firstChar !== firstChar.toLowerCase()) {
      violations.push({
        rule: 'first-sentence-lowercase',
        location: 'line 1',
        suggestion: 'First sentence must start lowercase.',
      });
    }
  }

  // Rule: no em dashes
  const emDashMatches = text.match(EM_DASH);
  if (emDashMatches) {
    violations.push({
      rule: 'no-em-dash',
      location: `${emDashMatches.length} occurrence(s)`,
      suggestion: 'Replace em dashes with period, comma, colon, or ->',
    });
  }

  // Also catch en dashes used as em dashes
  const enDashMatches = text.match(EN_DASH);
  if (enDashMatches) {
    violations.push({
      rule: 'no-en-dash',
      location: `${enDashMatches.length} occurrence(s)`,
      suggestion: 'Replace en dashes with period, comma, colon, or ->',
    });
  }

  // Rule: no headers unless post exceeds 900 words
  const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;
  const headerMatches = text.match(/^#{1,6}\s/gm);
  if (headerMatches && headerMatches.length > 0 && wordCount <= 900) {
    violations.push({
      rule: 'no-headers-under-900',
      location: `${headerMatches.length} header(s), ${wordCount} words`,
      suggestion: 'Remove headers. Posts under 900 words do not use headers.',
    });
  }

  // Rule: TLDR block present
  const hasTldr = /\*\*TLDR:\*\*/.test(text);
  if (!hasTldr) {
    violations.push({
      rule: 'tldr-required',
      location: 'missing',
      suggestion: 'Add a bold **TLDR:** paragraph near the end, 4 to 6 sentences.',
    });
  }

  // Rule: TLDR block length (4-6 sentences)
  if (hasTldr) {
    const tldrMatch = text.match(/\*\*TLDR:\*\*\s*([\s\S]*?)(?:\n\n|\n(?=[^\s]))/);
    if (tldrMatch) {
      const tldrText = tldrMatch[1].trim();
      const sentences = tldrText.split(/[.!?]+\s/).filter(s => s.trim().length > 0);
      if (sentences.length < 4 || sentences.length > 6) {
        violations.push({
          rule: 'tldr-length',
          location: 'TLDR block',
          suggestion: `TLDR must be 4 to 6 sentences. Found ${sentences.length}.`,
        });
      }

      // Rule: no slang inside TLDR
      const slangTerms = ['the sauce', 'dream with me', 'type shit', 'cooked', 'lowkey', 'no notes', 'insane'];
      for (const term of slangTerms) {
        if (tldrText.toLowerCase().includes(term)) {
          violations.push({
            rule: 'tldr-no-slang',
            location: 'TLDR block',
            suggestion: `No slang inside TLDR. Found: "${term}"`,
          });
        }
      }
    }
  }

  // Rule: banned words
  for (const word of BANNED_WORDS) {
    const regex = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    const matches = text.match(regex);
    if (matches) {
      violations.push({
        rule: 'banned-word',
        location: `"${word}" (${matches.length}x)`,
        suggestion: `Remove or replace "${word}".`,
      });
    }
  }

  // Rule: slang budget (one hit per ~200 words max)
  const slangTerms = ['the sauce', 'dream with me', 'type shit', 'cooked', 'lowkey', 'no notes', 'insane'];
  let slangCount = 0;
  for (const term of slangTerms) {
    const regex = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    const matches = text.match(regex);
    if (matches) slangCount += matches.length;
  }
  const maxSlang = Math.max(1, Math.floor(wordCount / 200));
  if (slangCount > maxSlang) {
    violations.push({
      rule: 'slang-budget',
      location: `${slangCount} slang hits in ${wordCount} words`,
      suggestion: `Max ${maxSlang} slang terms for this length. Cut ${slangCount - maxSlang}.`,
    });
  }

  // Rule: length by tag
  const tag = opts.tag || 'Field Note';
  if (tag === 'Field Note' && (wordCount < 500 || wordCount > 900)) {
    violations.push({
      rule: 'length-field-note',
      location: `${wordCount} words`,
      suggestion: 'Field notes should be 500 to 900 words.',
    });
  }
  if (tag === 'Case Study' && (wordCount < 800 || wordCount > 1200)) {
    violations.push({
      rule: 'length-case-study',
      location: `${wordCount} words`,
      suggestion: 'Case studies should be 800 to 1200 words.',
    });
  }

  return { violations, clean: violations.length === 0 };
}

/**
 * Lint a newsletter digest against voice rules.
 * Lighter than blog lint: no title case, no TLDR block, no length limits.
 * Enforces: no em/en dashes, no banned words, no slang, no editorializing.
 *
 * @param {string} text - The rendered digest markdown
 * @returns {{ violations: Array<{rule: string, location: string, suggestion: string}>, clean: boolean }}
 */
export function lintDigest(text) {
  const violations = [];

  // No em dashes
  const emDashMatches = text.match(EM_DASH);
  if (emDashMatches) {
    violations.push({
      rule: 'no-em-dash',
      location: `${emDashMatches.length} occurrence(s)`,
      suggestion: 'Replace em dashes with period, comma, colon, or ->',
    });
  }

  const enDashMatches = text.match(EN_DASH);
  if (enDashMatches) {
    violations.push({
      rule: 'no-en-dash',
      location: `${enDashMatches.length} occurrence(s)`,
      suggestion: 'Replace en dashes with period, comma, colon, or ->',
    });
  }

  // Banned words
  for (const word of BANNED_WORDS) {
    const regex = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    const matches = text.match(regex);
    if (matches) {
      violations.push({
        rule: 'banned-word',
        location: `"${word}" (${matches.length}x)`,
        suggestion: `Remove or replace "${word}".`,
      });
    }
  }

  // No editorializing: digest summaries should state facts, not editorialize
  // These patterns signal opinion injected into what should be a summary
  const EDITORIAL_PATTERNS = [
    { pattern: /\bjust became\b/gi, name: 'just became' },
    { pattern: /\bthis is huge\b/gi, name: 'this is huge' },
    { pattern: /\bgame.?changer\b/gi, name: 'game changer' },
    { pattern: /\bwake.?up call\b/gi, name: 'wake-up call' },
    { pattern: /\bno one is talking about\b/gi, name: 'no one is talking about' },
    { pattern: /\beveryone is\b/gi, name: 'everyone is' },
    { pattern: /\bmark my words\b/gi, name: 'mark my words' },
  ];
  for (const { pattern, name } of EDITORIAL_PATTERNS) {
    const matches = text.match(pattern);
    if (matches) {
      violations.push({
        rule: 'no-editorial',
        location: `"${name}" (${matches.length}x)`,
        suggestion: `State the fact, don't editorialize. Rewrite without "${name}".`,
      });
    }
  }

  return { violations, clean: violations.length === 0 };
}

/**
 * Load the voice.md reference file.
 */
export function loadVoiceRules() {
  const voicePath = join(REPO_ROOT, 'skills', 'blog-it', 'references', 'voice.md');
  return readFileSync(voicePath, 'utf-8');
}

/**
 * Count words in text.
 */
export function wordCount(text) {
  return text.split(/\s+/).filter(w => w.length > 0).length;
}
