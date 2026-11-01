#!/usr/bin/env node
// scripts/brave-vs-websearch.mjs -- Brave vs WebSearch comparison harness
// WHY: Runs 500 queries through Brave Search API, scores results on 5 axes,
// then produces a structured report that Jev can use to decide which source
// to route to during newsletter research.
//
// Usage (standalone, no mesh):
//   node scripts/brave-vs-websearch.mjs --batch 0 --size 50
//
// Usage (from mesh child):
//   Receives batch via mesh tap, runs it, taps back results.
//
// Scoring axes:
//   1. source_diversity  - unique domains in results
//   2. recency           - age of newest result (hours)
//   3. depth             - avg description length (chars)
//   4. signal_to_noise   - ratio of on-topic results (heuristic: query terms in title/desc)
//   5. primary_source    - ratio of non-aggregator domains

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { loadEnv } from '../lib/env.js';

loadEnv();

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const QUERIES_PATH = resolve(ROOT, 'tests', 'mcp', 'brave', 'queries.json');
const RESULTS_DIR = resolve(ROOT, 'tests', 'mcp', 'brave', 'results');

// Known aggregator domains: results from these are lower signal
const AGGREGATORS = new Set([
  'news.google.com', 'news.yahoo.com', 'msn.com', 'flipboard.com',
  'apple.news', 'smartnews.com', 'ground.news', 'feedly.com',
  'reddit.com', 'twitter.com', 'x.com', 'facebook.com',
]);

// -- Query loading -----------------------------------------------------------

export function loadQueries() {
  const data = JSON.parse(readFileSync(QUERIES_PATH, 'utf8'));
  const flat = [];
  for (const [category, queries] of Object.entries(data.categories)) {
    for (const query of queries) {
      flat.push({ category, query });
    }
  }
  return flat;
}

export function getBatch(allQueries, batchIndex, batchSize) {
  const start = batchIndex * batchSize;
  return allQueries.slice(start, start + batchSize);
}

// -- Scoring -----------------------------------------------------------------

/**
 * Score a set of Brave search results on 5 axes.
 * Each axis is 0-1 normalized.
 */
export function scoreResults(query, results) {
  if (!results || results.length === 0) {
    return { source_diversity: 0, recency: 0, depth: 0, signal_to_noise: 0, primary_source: 0, total: 0 };
  }

  // 1. Source diversity: unique domains / total results
  const domains = new Set();
  for (const r of results) {
    try {
      domains.add(new URL(r.url).hostname.replace('www.', ''));
    } catch { /* skip malformed URLs */ }
  }
  const source_diversity = Math.min(domains.size / Math.max(results.length, 1), 1);

  // 2. Recency: parse age strings like "2h", "1d", "3w"
  let bestAgeHours = Infinity;
  for (const r of results) {
    if (r.age) {
      const hours = parseAge(r.age);
      if (hours < bestAgeHours) bestAgeHours = hours;
    }
  }
  // Score: <1h = 1.0, 24h = 0.5, 7d = 0.1, older = 0
  const recency = bestAgeHours === Infinity ? 0 : Math.max(0, 1 - (bestAgeHours / 168));

  // 3. Depth: avg description length, normalized to 0-1 (300 chars = 1.0)
  const avgDescLen = results.reduce((sum, r) => sum + (r.description || '').length, 0) / results.length;
  const depth = Math.min(avgDescLen / 300, 1);

  // 4. Signal-to-noise: how many results have query terms in title or description
  const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 3);
  let onTopic = 0;
  for (const r of results) {
    const text = ((r.title || '') + ' ' + (r.description || '')).toLowerCase();
    const matches = queryTerms.filter(t => text.includes(t)).length;
    if (matches >= Math.ceil(queryTerms.length * 0.3)) onTopic++;
  }
  const signal_to_noise = onTopic / results.length;

  // 5. Primary source rate: ratio of non-aggregator domains
  let primary = 0;
  for (const r of results) {
    try {
      const host = new URL(r.url).hostname.replace('www.', '');
      if (!AGGREGATORS.has(host)) primary++;
    } catch { primary++; }
  }
  const primary_source = primary / results.length;

  const total = (source_diversity + recency + depth + signal_to_noise + primary_source) / 5;

  return { source_diversity, recency, depth, signal_to_noise, primary_source, total };
}

function parseAge(age) {
  if (!age) return Infinity;
  const match = age.match(/(\d+)\s*([hdwmy])/i);
  if (!match) return Infinity;
  const [, num, unit] = match;
  const n = parseInt(num, 10);
  switch (unit.toLowerCase()) {
    case 'h': return n;
    case 'd': return n * 24;
    case 'w': return n * 168;
    case 'm': return n * 720;
    case 'y': return n * 8760;
    default: return Infinity;
  }
}

// -- Brave API call ----------------------------------------------------------

const BRAVE_API_KEY = process.env.BRAVE_API_KEY;

async function braveSearch(query, type = 'news') {
  const endpoint = type === 'web' ? 'web/search' : 'news/search';
  const url = new URL(`https://api.search.brave.com/res/v1/${endpoint}`);
  url.searchParams.set('q', query);
  url.searchParams.set('count', '10');
  url.searchParams.set('freshness', 'pw'); // past week

  const resp = await fetch(url.toString(), {
    headers: {
      'Accept': 'application/json',
      'Accept-Encoding': 'gzip',
      'X-Subscription-Token': BRAVE_API_KEY,
    },
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Brave ${resp.status}: ${body.slice(0, 200)}`);
  }

  const data = await resp.json();

  if (type === 'web') {
    return (data.web?.results || []).map(r => ({
      title: r.title, url: r.url,
      description: r.description || '',
      age: r.age || null,
    }));
  }

  return (data.results || []).map(r => ({
    title: r.title, url: r.url,
    description: r.description || '',
    age: r.age || null,
    source: r.meta_url?.hostname || null,
  }));
}

// -- Batch runner ------------------------------------------------------------

async function braveSearchWithRetry(query, type, delayMs) {
  const maxRetries = 3;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const result = await braveSearch(query, type);
      // Always wait after a successful call to respect rate limits
      if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
      return result;
    } catch (err) {
      if (err.message.includes('429') && attempt < maxRetries - 1) {
        // Exponential backoff: 2s, 4s, 8s
        const backoff = 2000 * Math.pow(2, attempt);
        process.stderr.write(`[brave] 429 on ${type} "${query.slice(0, 30)}..." retry in ${backoff}ms\n`);
        await new Promise(r => setTimeout(r, backoff));
        continue;
      }
      throw err;
    }
  }
}

export async function runBatch(queries, delayMs = 200) {
  const results = [];

  for (let i = 0; i < queries.length; i++) {
    const { category, query } = queries[i];
    try {
      // News search, then wait, then web search, then wait
      // Each call gets its own delay to stay under 1 req/sec
      const newsResults = await braveSearchWithRetry(query, 'news', delayMs);
      const webResults = await braveSearchWithRetry(query, 'web', delayMs);

      const newsScore = scoreResults(query, newsResults);
      const webScore = scoreResults(query, webResults);

      results.push({
        category,
        query,
        news: { count: newsResults.length, score: newsScore },
        web: { count: webResults.length, score: webScore },
      });

      if ((i + 1) % 10 === 0) {
        process.stderr.write(`[brave] Progress: ${i + 1}/${queries.length}\n`);
      }

    } catch (err) {
      results.push({
        category,
        query,
        error: err.message,
        news: { count: 0, score: scoreResults(query, []) },
        web: { count: 0, score: scoreResults(query, []) },
      });
    }
  }

  return results;
}

// -- Aggregate report --------------------------------------------------------

export function aggregateReport(results) {
  const byCategory = {};

  for (const r of results) {
    if (!byCategory[r.category]) {
      byCategory[r.category] = { news: [], web: [], errors: 0 };
    }
    byCategory[r.category].news.push(r.news.score);
    byCategory[r.category].web.push(r.web.score);
    if (r.error) byCategory[r.category].errors++;
  }

  const report = { categories: {}, overall: {} };

  const allNews = [];
  const allWeb = [];

  for (const [cat, data] of Object.entries(byCategory)) {
    report.categories[cat] = {
      queries: data.news.length,
      errors: data.errors,
      news_avg: avgScores(data.news),
      web_avg: avgScores(data.web),
    };
    allNews.push(...data.news);
    allWeb.push(...data.web);
  }

  report.overall = {
    total_queries: results.length,
    total_errors: results.filter(r => r.error).length,
    news_avg: avgScores(allNews),
    web_avg: avgScores(allWeb),
  };

  // Jev decision inputs: which axes does Brave news beat Brave web on?
  const axes = ['source_diversity', 'recency', 'depth', 'signal_to_noise', 'primary_source', 'total'];
  report.jev_inputs = {};
  for (const axis of axes) {
    const newsVal = report.overall.news_avg[axis];
    const webVal = report.overall.web_avg[axis];
    report.jev_inputs[axis] = {
      news: round(newsVal),
      web: round(webVal),
      winner: newsVal > webVal ? 'news' : 'web',
      delta: round(Math.abs(newsVal - webVal)),
    };
  }

  return report;
}

function avgScores(scores) {
  if (scores.length === 0) return {};
  const keys = Object.keys(scores[0]);
  const avg = {};
  for (const k of keys) {
    avg[k] = round(scores.reduce((sum, s) => sum + (s[k] || 0), 0) / scores.length);
  }
  return avg;
}

function round(n) {
  return Math.round(n * 1000) / 1000;
}

// -- CLI entry point ---------------------------------------------------------

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));

if (isMain) {
  const { values } = parseArgs({
    options: {
      batch: { type: 'string', default: '0' },
      size:  { type: 'string', default: '50' },
      delay: { type: 'string', default: '500' },
      output: { type: 'string' },
    },
    strict: true,
  });

  if (!BRAVE_API_KEY) {
    console.error('Fatal: BRAVE_API_KEY not set');
    process.exit(1);
  }

  const allQueries = loadQueries();
  const batchIndex = parseInt(values.batch, 10);
  const batchSize = parseInt(values.size, 10);
  const delayMs = parseInt(values.delay, 10);
  const batch = getBatch(allQueries, batchIndex, batchSize);

  console.log(`Running batch ${batchIndex}: ${batch.length} queries (delay ${delayMs}ms)`);

  const results = await runBatch(batch, delayMs);

  mkdirSync(RESULTS_DIR, { recursive: true });
  const outPath = values.output || resolve(RESULTS_DIR, `batch-${batchIndex}.json`);
  writeFileSync(outPath, JSON.stringify(results, null, 2));

  console.log(`Wrote ${results.length} results to ${outPath}`);

  // If this is the last batch, aggregate
  if ((batchIndex + 1) * batchSize >= allQueries.length) {
    console.log('Last batch. Run aggregate separately after all batches complete.');
  }
}
