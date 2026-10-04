// lib/judge.js — Structured judgment layer
// Default backend: Claude (Anthropic API) with JSON schema
// Optional backend: Jev (TypeSafe API) when TYPESAFE_API_KEY is set
// DR-2: API keys from getEnv()
// S6: Never log credentials

import { secureRequest } from './resilient-request.js';
import { getEnv } from './env.js';
import { ValidationError } from './errors.js';

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const TYPESAFE_API = 'https://api.typesafe.ai/v1/systemone';

/**
 * Determine which backend to use.
 * Jev when TYPESAFE_API_KEY is set, Claude otherwise.
 */
export function getBackend() {
  return getEnv('TYPESAFE_API_KEY') ? 'jev' : 'claude';
}

/**
 * Make a structured judgment call.
 *
 * For whats-new digest: clusters items into topics, scores stance per source,
 * detects divergence, writes takes.
 *
 * @param {string} task - What judgment to make (e.g. 'digest', 'sponsor-check', 'voice-lint')
 * @param {object} state - The data to judge
 * @param {object} schema - Expected output JSON schema
 * @returns {object} The judgment result matching the schema
 */
export async function judge(task, state, schema) {
  const backend = getBackend();
  if (backend === 'jev') {
    return judgeWithJev(task, state, schema);
  }
  return judgeWithClaude(task, state, schema);
}

/**
 * Claude backend: structured output via Anthropic API
 */
async function judgeWithClaude(task, state, schema) {
  const apiKey = getEnv('ANTHROPIC_API_KEY');
  if (!apiKey) throw new ValidationError('ANTHROPIC_API_KEY not set', 'VALIDATION_MISSING_KEY');

  const systemPrompt = buildSystemPrompt(task);
  const userMessage = JSON.stringify(state);

  const res = await secureRequest(ANTHROPIC_API, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    },
    retries: 2,
  });

  const data = JSON.parse(res.body);
  if (data.error) {
    throw new ValidationError(
      `Anthropic API: ${data.error.message}`,
      'VALIDATION_JUDGE_API',
    );
  }

  const text = data.content[0].text;
  return parseJsonResponse(text);
}

/**
 * Jev backend: TypeSafe System One API
 */
async function judgeWithJev(task, state, schema) {
  const apiKey = getEnv('TYPESAFE_API_KEY');
  if (!apiKey) throw new ValidationError('TYPESAFE_API_KEY not set', 'VALIDATION_MISSING_KEY');

  const questions = buildJevQuestions(task, state);

  const res = await secureRequest(TYPESAFE_API, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: {
      state: JSON.stringify(state),
      model: 'jev-latest',
      questions,
    },
    retries: 2,
  });

  const data = JSON.parse(res.body);
  return data;
}

/**
 * Build system prompt based on the judgment task
 */
function buildSystemPrompt(task) {
  const prompts = {
    digest: `You are a news digest curator. Given a list of news items from multiple sources (TLDR newsletters, GitHub trending, madewithjev.com, WSJ), your job is to:

1. Cluster items into topics that appear across multiple sources.
2. Pick exactly 5 topics, prioritized by: source count desc, item count desc, recency.
3. At least 3 of the 5 must span 2+ sources when the input allows.
4. For each topic, assign a stance per source: bullish, mixed, or bearish.
5. Mark topics as divergent when sources disagree.
6. Write a one-sentence "take" for each topic in a casual, smart voice.
7. Rank leftover items by metrics for up to 8 quick links.

Respond with valid JSON only. No markdown fences. Schema:
{
  "topics": [{
    "name": string,
    "emoji": string,
    "items": [item_ids],
    "sources": [source_names],
    "stance": { source_name: { "label": "bullish"|"mixed"|"bearish", "why": string } },
    "temp": number (-2 to 2),
    "divergent": boolean,
    "take": string
  }],
  "quick_links": [item_ids]
}`,

    'digest-v2': `You are a news digest curator for Newsletter v2.0. Given items from two paths:
- Path A: fixed sources (TLDR, GitHub trending, WSJ, madewithjev, Gmail labels)
- Path B: open-web sweep by category

Your job:
1. Cluster items by STORY, not by source. Same event from 3 outlets = 1 cluster with 3 links.
2. Score each cluster on three dimensions:
   - corroboration: found in both A and B = 3. Each extra independent outlet = +1 (cap total at 6)
   - relevance: would this change what a technical PM building AI tools would build or bet on? 0 to 3
   - novelty: if uncategorized and relevance >= 2, add +2
3. Drop any cluster with relevance 0.
4. Rank by total score desc, cut to top 12.
5. Tag each cluster: [A+B] if items from both paths, [A] if path A only, [B] if path B only.
6. For each cluster write a one-sentence "why it matters" line.
7. Flag any category that appears in Uncategorized for 2+ consecutive days as a "new this week" candidate.

Respond with valid JSON only. No markdown fences. Schema:
{
  "clusters": [{
    "rank": number,
    "headline": string,
    "category": string,
    "why_it_matters": string,
    "tag": "[A+B]" | "[A]" | "[B]",
    "score": { "corroboration": number, "relevance": number, "novelty": number, "total": number },
    "items": [{ "title": string, "source": string, "url": string, "path": "A" | "B" }]
  }],
  "new_this_week": [string],
  "dropped_count": number
}`,

    sponsor: `You detect sponsored or promotional content in news items. Given an item, respond with JSON: { "is_sponsor": boolean, "confidence": number, "reason": string }`,

    voice: `You check text against voice rules. Given text and rules, respond with JSON: { "violations": [{ "rule": string, "location": string, "suggestion": string }] }`,
  };

  return prompts[task] || `You are a judgment engine. Analyze the input and respond with valid JSON matching the requested schema.`;
}

/**
 * Build Jev questions from task and state
 */
function buildJevQuestions(task, state) {
  if (task === 'digest') {
    return state.items.map(item => ({
      type: 'choice',
      instructions: `Which topic cluster does this item belong to? Item: "${item.title}" from ${item.source}`,
      criteria: state.topicCandidates || [],
    }));
  }

  if (task === 'digest-v2') {
    const questions = {};
    for (const item of (state.items || [])) {
      questions[`item_${item.id}`] = {
        type: 'score',
        instructions: `Rate this news item for a technical PM building AI tools. Title: "${item.title}", Source: ${item.source}, Category: ${item.category || 'unknown'}`,
        criteria: {
          relevance: 'Would this change what the reader builds or bets on? 0=no, 3=immediately actionable',
          corroboration: 'How many independent sources report this? 1=single source, 6=widely reported',
        },
      };
    }
    return questions;
  }

  if (task === 'sponsor') {
    return [{
      type: 'noul',
      instructions: `Is this item sponsored or promotional content? Title: "${state.title}", Summary: "${state.summary}"`,
    }];
  }

  return [{
    type: 'noul',
    instructions: `Does this satisfy the requirement? ${JSON.stringify(state)}`,
  }];
}

/**
 * Parse JSON from a model response, handling potential markdown fences
 */
function parseJsonResponse(text) {
  let clean = text.trim();
  // Strip markdown code fences if present
  if (clean.startsWith('```')) {
    clean = clean.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }
  try {
    return JSON.parse(clean);
  } catch (e) {
    throw new ValidationError(
      `Failed to parse judge response as JSON: ${e.message}`,
      'VALIDATION_JUDGE_PARSE',
    );
  }
}
