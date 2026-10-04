// tests/skills/typesafe-ai.test.js
// Tests the typesafe-ai skill's core contracts:
//   - Payload construction matches TypeSafe API schema
//   - Response interpretation produces correct human-readable output
//   - Primitive selection maps question types correctly
//
// WHY: The skill is instructional (SKILL.md), but the contracts it describes
// are mechanical. Extracting them into a testable module prevents drift
// between what the skill says and what it does.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPayload,
  interpretResponse,
  selectPrimitive,
} from '../../.claude/skills/typesafe-ai/jev.js';

// --- Payload construction ---

describe('buildPayload', () => {
  it('produces valid structure with state, model, and questions', () => {
    const payload = buildPayload(
      { message: 'Please refund the duplicate charge.' },
      {
        refund: {
          type: 'noul',
          instructions: 'Does `message` request a refund?',
          criteria: {
            true: 'The message asks for money back',
            false: 'The message does not ask for money back',
          },
        },
      }
    );

    assert.ok(payload.state, 'payload must have state');
    assert.equal(payload.model, 'jev-latest');
    assert.ok(payload.questions, 'payload must have questions');
    assert.ok(payload.questions.refund, 'question ID must be preserved');
  });

  it('rejects empty state', () => {
    assert.throws(
      () => buildPayload(null, { q: { type: 'noul', instructions: 'test' } }),
      /state/i
    );
  });

  it('rejects empty questions', () => {
    assert.throws(
      () => buildPayload({ text: 'hello' }, {}),
      /question/i
    );
  });

  it('rejects invalid primitive type', () => {
    assert.throws(
      () =>
        buildPayload({ text: 'hello' }, {
          q: { type: 'invalid', instructions: 'test' },
        }),
      /type/i
    );
  });

  it('accepts all three primitive types', () => {
    const payload = buildPayload({ text: 'test' }, {
      a: { type: 'noul', instructions: 'Is this true?', criteria: { true: 'yes', false: 'no' } },
      b: { type: 'choice', instructions: 'Which one?', criteria: { x: 'Option X', y: 'Option Y' } },
      c: { type: 'score', instructions: 'How severe?', criteria: ['low', 'medium', 'high'] },
    });

    assert.equal(Object.keys(payload.questions).length, 3);
  });
});

// --- Response interpretation ---

describe('interpretResponse', () => {
  it('interprets a Noul response as yes/no with percentage', () => {
    const result = interpretResponse('refund', {
      type: 'noul',
      value: 0.92,
    });

    assert.match(result, /yes/i);
    assert.match(result, /92%/);
  });

  it('interprets a low Noul as "probably not"', () => {
    const result = interpretResponse('refund', {
      type: 'noul',
      value: 0.23,
    });

    assert.match(result, /no/i);
    assert.match(result, /23%/);
  });

  it('flags Noul near 0.5 as uncertain', () => {
    const result = interpretResponse('clarity', {
      type: 'noul',
      value: 0.51,
    });

    assert.match(result, /uncertain|unclear|near 50/i);
  });

  it('interprets a Choice response with winner and alternatives', () => {
    const result = interpretResponse('route', {
      type: 'choice',
      value: 'bugfix',
      probabilities: { bugfix: 0.74, feature: 0.15, refactor: 0.11 },
      confidence: 0.82,
    });

    assert.match(result, /bugfix/i);
    assert.match(result, /74%/);
    assert.match(result, /confidence/i);
  });

  it('flags low Choice confidence', () => {
    const result = interpretResponse('route', {
      type: 'choice',
      value: 'bugfix',
      probabilities: { bugfix: 0.35, feature: 0.33, refactor: 0.32 },
      confidence: 0.38,
    });

    assert.match(result, /low confidence|uncertain/i);
  });

  it('interprets a Score response with level and confidence', () => {
    const result = interpretResponse('risk', {
      type: 'score',
      value: 'high',
      score: 0.78,
      confidence: 0.71,
    });

    assert.match(result, /high/i);
    assert.match(result, /0\.78|78%/);
  });
});

// --- Primitive selection ---

describe('selectPrimitive', () => {
  it('returns noul for yes/no questions', () => {
    assert.equal(selectPrimitive('is this true?'), 'noul');
    assert.equal(selectPrimitive('does this need review?'), 'noul');
  });

  it('returns choice for "which" questions', () => {
    assert.equal(selectPrimitive('which team should handle this?'), 'choice');
    assert.equal(selectPrimitive('which route fits best?'), 'choice');
  });

  it('returns score for degree/severity questions', () => {
    assert.equal(selectPrimitive('how severe is the impact?'), 'score');
    assert.equal(selectPrimitive('how complex is this task?'), 'score');
  });
});
