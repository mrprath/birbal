// lib/secure-write.js
// DR-8: Atomic secure writes with permission enforcement
// WHY: fs.writeFileSync inherits umask. If umask is 0o022, credentials are
// world-readable during the write window. Atomic write-then-rename + explicit
// chmod eliminates that window.

import { writeFileSync, renameSync, chmodSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

/**
 * Write a file atomically with 0o600 permissions.
 * 1. Write to a temp file in the same directory (same filesystem = atomic rename)
 * 2. Rename temp → target
 * 3. chmod 0o600 explicitly (some filesystems don't preserve mode across rename)
 */
export function secureWriteFile(targetPath, content) {
  const dir = dirname(targetPath);
  const tmpName = `.tmp-${randomBytes(8).toString('hex')}`;
  const tmpPath = join(dir, tmpName);

  try {
    // Step 1: write to temp with restricted permissions
    writeFileSync(tmpPath, content, { mode: 0o600, encoding: 'utf-8' });

    // Step 2: atomic rename
    renameSync(tmpPath, targetPath);

    // Step 3: explicit chmod — belt AND suspenders (DR-8 WHY)
    chmodSync(targetPath, 0o600);
  } catch (err) {
    // Clean up temp file if rename failed
    try { unlinkSync(tmpPath); } catch { /* temp may not exist */ }
    throw err;
  }
}
