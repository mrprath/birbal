#!/usr/bin/env node
// scripts/brave-comparison-mesh.mjs -- Mesh-orchestrated parallel comparison
// WHY: 500 queries at 0.5s delay = ~8 minutes serial. 10 mesh children = ~50s each.
// Spawns 10 searcher children (one per category), sends batch briefs over the mesh,
// collects results, aggregates, and writes the final report.
//
// Usage:
//   1. This session (orchestrator): runs this script to spawn children
//   2. Each child: receives batch brief via mesh, runs brave-vs-websearch.mjs, taps back results
//   3. Orchestrator: collects all 10 result taps, aggregates, writes report
//
// Alternatively, run standalone without mesh:
//   node scripts/brave-comparison-mesh.mjs --no-mesh

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, spawn } from 'node:child_process';
import { parseArgs } from 'node:util';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const RESULTS_DIR = resolve(ROOT, 'tests', 'mcp', 'brave', 'results');
const REPORT_PATH = resolve(RESULTS_DIR, 'comparison-report.json');

import { loadQueries, aggregateReport } from './brave-vs-websearch.mjs';

const { values } = parseArgs({
  options: {
    'no-mesh': { type: 'boolean', default: false },
    'aggregate-only': { type: 'boolean', default: false },
  },
  strict: true,
});

// -- Aggregate existing batch results ----------------------------------------

if (values['aggregate-only']) {
  mkdirSync(RESULTS_DIR, { recursive: true });

  const batchFiles = readdirSync(RESULTS_DIR).filter(f => f.startsWith('batch-') && f.endsWith('.json'));
  if (batchFiles.length === 0) {
    console.error('No batch result files found in', RESULTS_DIR);
    process.exit(1);
  }

  const allResults = [];
  for (const f of batchFiles.sort()) {
    const data = JSON.parse(readFileSync(resolve(RESULTS_DIR, f), 'utf8'));
    allResults.push(...data);
  }

  const report = aggregateReport(allResults);
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(`Aggregated ${allResults.length} results from ${batchFiles.length} batches`);
  console.log(`Report: ${REPORT_PATH}`);
  console.log(JSON.stringify(report.jev_inputs, null, 2));
  process.exit(0);
}

// -- No-mesh mode: run all batches serially -----------------------------------

if (values['no-mesh']) {
  const allQueries = loadQueries();
  const batchSize = 50;
  const totalBatches = Math.ceil(allQueries.length / batchSize);

  console.log(`Running ${totalBatches} batches of ${batchSize} serially (no mesh)`);

  for (let i = 0; i < totalBatches; i++) {
    console.log(`\nBatch ${i}/${totalBatches}...`);
    spawnSync('node', ['scripts/brave-vs-websearch.mjs', '--batch', String(i), '--size', String(batchSize), '--delay', '500'], {
      cwd: ROOT,
      stdio: 'inherit',
      env: process.env,
    });
  }

  // Aggregate
  spawnSync('node', ['scripts/brave-comparison-mesh.mjs', '--aggregate-only'], {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env,
  });

  process.exit(0);
}

// -- Mesh mode: print spawn commands for orchestrator to run ------------------

const allQueries = loadQueries();
const categories = [...new Set(allQueries.map(q => q.category))];
const batchSize = 50;

console.log(`\n=== Brave vs WebSearch: Mesh Parallel Comparison ===`);
console.log(`${allQueries.length} queries across ${categories.length} categories`);
console.log(`Each child runs ${batchSize} queries\n`);

console.log('--- Step 1: Spawn children (run these from orchestrator) ---\n');

for (let i = 0; i < categories.length; i++) {
  const cat = categories[i];
  const label = `searcher-${cat}`;
  console.log(`node scripts/mesh-spawn.mjs --role builder --label ${label} --spawner orchestrator --allow-all`);
}

console.log('\n--- Step 2: After all children tap "ready", send briefs ---\n');

for (let i = 0; i < categories.length; i++) {
  const cat = categories[i];
  const label = `searcher-${cat}`;
  const brief = [
    `TASK: Run Brave search comparison batch.`,
    `Run: node scripts/brave-vs-websearch.mjs --batch ${i} --size ${batchSize} --delay 500`,
    `When done, read the output file at tests/mcp/brave/results/batch-${i}.json`,
    `and tap orchestrator with: BATCH ${i} COMPLETE - ${cat} - <number of results> queries scored.`,
    `Then park yourself.`,
  ].join(' ');
  console.log(`mesh_send(workspace="${label}", content="${brief}")`);
}

console.log('\n--- Step 3: After all children report back, aggregate ---\n');
console.log('node scripts/brave-comparison-mesh.mjs --aggregate-only');
console.log('\nThis produces the final report at:');
console.log(REPORT_PATH);
