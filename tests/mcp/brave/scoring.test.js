// tests/mcp/brave/scoring.test.js
// WHY: Unit tests for the scoring functions in brave-vs-websearch.mjs.
// The comparison harness scores results on 5 axes. These tests verify
// the scoring math is correct before running 500 queries through it.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { scoreResults, loadQueries, aggregateReport } from '../../../scripts/brave-vs-websearch.mjs';

describe('scoreResults', () => {
  it('returns zeros for empty results', () => {
    const score = scoreResults('test query', []);
    assert.equal(score.total, 0);
    assert.equal(score.source_diversity, 0);
    assert.equal(score.recency, 0);
  });

  it('scores source diversity correctly', () => {
    const results = [
      { title: 'A', url: 'https://nytimes.com/1', description: 'test' },
      { title: 'B', url: 'https://bbc.com/1', description: 'test' },
      { title: 'C', url: 'https://reuters.com/1', description: 'test' },
    ];
    const score = scoreResults('test query', results);
    assert.equal(score.source_diversity, 1); // 3 unique domains / 3 results
  });

  it('penalizes low source diversity', () => {
    const results = [
      { title: 'A', url: 'https://nytimes.com/1', description: 'test' },
      { title: 'B', url: 'https://nytimes.com/2', description: 'test' },
      { title: 'C', url: 'https://nytimes.com/3', description: 'test' },
    ];
    const score = scoreResults('test query', results);
    assert.ok(score.source_diversity < 0.5);
  });

  it('scores recency from age strings', () => {
    const results = [
      { title: 'A', url: 'https://a.com', description: 'test', age: '2h' },
      { title: 'B', url: 'https://b.com', description: 'test', age: '1d' },
    ];
    const score = scoreResults('test query', results);
    assert.ok(score.recency > 0.9, `Expected >0.9, got ${score.recency}`);
  });

  it('scores old results lower on recency', () => {
    const results = [
      { title: 'A', url: 'https://a.com', description: 'test', age: '5d' },
    ];
    const score = scoreResults('test query', results);
    assert.ok(score.recency < 0.5, `Expected <0.5, got ${score.recency}`);
  });

  it('scores depth by description length', () => {
    const longDesc = 'A '.repeat(200);
    const results = [
      { title: 'A', url: 'https://a.com', description: longDesc },
    ];
    const score = scoreResults('test query', results);
    assert.ok(score.depth > 0.5, `Expected >0.5 for long descriptions, got ${score.depth}`);
  });

  it('scores signal-to-noise by query term presence', () => {
    const results = [
      { title: 'semiconductor export controls', url: 'https://a.com', description: 'US China semiconductor restrictions' },
      { title: 'weather forecast', url: 'https://b.com', description: 'sunny tomorrow' },
    ];
    const score = scoreResults('semiconductor export controls China', results);
    assert.ok(score.signal_to_noise >= 0.4, `Expected >=0.4, got ${score.signal_to_noise}`);
  });

  it('detects aggregator domains as non-primary', () => {
    const results = [
      { title: 'A', url: 'https://news.google.com/1', description: 'test' },
      { title: 'B', url: 'https://reddit.com/r/news/1', description: 'test' },
      { title: 'C', url: 'https://reuters.com/1', description: 'test' },
    ];
    const score = scoreResults('test query', results);
    assert.ok(score.primary_source < 0.5, `Expected <0.5 (2 of 3 are aggregators), got ${score.primary_source}`);
  });
});

describe('loadQueries', () => {
  it('loads 500 queries across 10 categories', () => {
    const queries = loadQueries();
    assert.equal(queries.length, 500);
    const categories = new Set(queries.map(q => q.category));
    assert.equal(categories.size, 10);
  });

  it('each category has 50 queries', () => {
    const queries = loadQueries();
    const byCat = {};
    for (const q of queries) {
      byCat[q.category] = (byCat[q.category] || 0) + 1;
    }
    for (const [cat, count] of Object.entries(byCat)) {
      assert.equal(count, 50, `${cat} has ${count} queries, expected 50`);
    }
  });
});

describe('aggregateReport', () => {
  it('produces jev_inputs with winner per axis', () => {
    const mockResults = [
      {
        category: 'test',
        query: 'test query',
        news: { count: 5, score: { source_diversity: 0.8, recency: 0.9, depth: 0.5, signal_to_noise: 0.7, primary_source: 0.9, total: 0.76 } },
        web: { count: 5, score: { source_diversity: 0.6, recency: 0.3, depth: 0.8, signal_to_noise: 0.6, primary_source: 0.7, total: 0.6 } },
      },
    ];
    const report = aggregateReport(mockResults);
    assert.ok(report.jev_inputs, 'Missing jev_inputs');
    assert.equal(report.jev_inputs.recency.winner, 'news');
    assert.equal(report.jev_inputs.depth.winner, 'web');
    assert.ok(report.jev_inputs.total.delta >= 0);
  });
});
