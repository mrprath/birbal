// startup.js
// DR-7: Conflict detection — warn if global Claude files could interfere with Birbal's isolation
// WHY: Silent conflicts are worse than loud ones. If a global config exists that could
// override Birbal's security rules, the user should know immediately.

import { existsSync } from 'node:fs';
import { join } from 'node:path';

const HOME = process.env.USERPROFILE || process.env.HOME;

// Files that could conflict with Birbal's isolated config
const CONFLICT_PATHS = [
  { path: join(HOME, '.claude', 'CLAUDE.md'), risk: 'Global CLAUDE.md could inject instructions that override Birbal security rules' },
  { path: join(HOME, '.claude', 'settings.json'), risk: 'Global settings.json could override Birbal allowed URLs or permissions' },
  { path: join(HOME, '.claude', 'config.json'), risk: 'Global config.json could override Birbal trusted folders allowlist' },
];

export function checkConflicts() {
  const conflicts = [];

  for (const { path, risk } of CONFLICT_PATHS) {
    if (existsSync(path)) {
      conflicts.push({ path, risk });
    }
  }

  if (conflicts.length > 0) {
    console.warn('\n⚠️  BIRBAL CONFLICT DETECTION (DR-7)');
    console.warn('The following global Claude files exist and could interfere with Birbal isolation:\n');
    for (const { path, risk } of conflicts) {
      console.warn(`  → ${path}`);
      console.warn(`    Risk: ${risk}\n`);
    }
    console.warn('Birbal uses repo-local config only. Verify these global files don\'t conflict.');
    console.warn('See SECURITY.md DR-7 for WHY isolation matters.\n');
  }

  return conflicts;
}

// Run on import
checkConflicts();
