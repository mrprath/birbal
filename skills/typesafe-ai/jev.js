// skills/typesafe-ai/jev.js
// Testable contracts for the typesafe-ai skill.
// WHY this exists: SKILL.md describes how to use Jev, but the payload
// construction, response interpretation, and primitive selection are
// mechanical contracts that should be tested, not just documented.

const VALID_TYPES = new Set(['noul', 'choice', 'score']);

/**
 * Build a TypeSafe System One API payload.
 *
 * @param {string|object|Array} state - The evidence Jev evaluates
 * @param {object} questions - Question definitions keyed by ID
 * @returns {object} API-ready payload
 */
export function buildPayload(state, questions) {
  if (state == null || (typeof state === 'object' && !Array.isArray(state) && Object.keys(state).length === 0)) {
    throw new Error('State is required — Jev can only judge the evidence you send.');
  }

  if (!questions || Object.keys(questions).length === 0) {
    throw new Error('At least one question is required.');
  }

  for (const [id, q] of Object.entries(questions)) {
    if (!VALID_TYPES.has(q.type)) {
      throw new Error(
        `Question "${id}" has invalid type "${q.type}". Must be noul, choice, or score.`
      );
    }
  }

  return {
    state,
    model: 'jev-latest',
    questions,
  };
}

/**
 * Interpret a single question's response into human-readable text.
 *
 * @param {string} questionId - The question ID
 * @param {object} answer - The API response for this question
 * @returns {string} Human-readable interpretation
 */
export function interpretResponse(questionId, answer) {
  switch (answer.type) {
    case 'noul': {
      const pct = Math.round(answer.value * 100);
      if (answer.value > 0.45 && answer.value < 0.55) {
        return `Jev is uncertain on "${questionId}" — near 50/50 (${pct}%). Needs more evidence or a clearer question.`;
      }
      if (answer.value >= 0.55) {
        return `Jev says yes on "${questionId}" (${pct}%).`;
      }
      return `Jev says probably not on "${questionId}" (${pct}%).`;
    }

    case 'choice': {
      const pct = Math.round(answer.probabilities[answer.value] * 100);
      const others = Object.entries(answer.probabilities)
        .filter(([k]) => k !== answer.value)
        .map(([k, v]) => `${k} (${Math.round(v * 100)}%)`)
        .join(', ');

      let text = `Jev chose "${answer.value}" (${pct}%)`;
      if (others) text += ` over ${others}`;
      text += `. Confidence: ${answer.confidence}.`;

      if (answer.confidence < 0.5) {
        text += ' ⚠ Low confidence — consider gathering more context.';
      }
      return text;
    }

    case 'score': {
      const text = `Jev rates this "${answer.value}" (${answer.score}). Confidence: ${answer.confidence}.`;
      if (answer.confidence < 0.5) {
        return text + ' ⚠ Low confidence — consider gathering more context.';
      }
      return text;
    }

    default:
      return `Unknown answer type: ${answer.type}`;
  }
}

/**
 * Suggest a primitive type based on question phrasing.
 * This is a heuristic helper, not a substitute for human judgment.
 *
 * @param {string} question - Natural language question
 * @returns {'noul'|'choice'|'score'} Suggested primitive
 */
export function selectPrimitive(question) {
  const q = question.toLowerCase();

  // "which" / "what ... should" → choosing from a set
  if (/\bwhich\b/.test(q) || /\bwhat\s+\w+\s+should\b/.test(q)) {
    return 'choice';
  }

  // "how much" / "how severe" / "how complex" → degree on a scale
  if (/\bhow\s+(much|severe|complex|bad|good|large|small|urgent|important|risky)\b/.test(q)) {
    return 'score';
  }

  // Default: yes/no probability
  return 'noul';
}
