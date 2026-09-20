---
name: repo-update
description: Update the birbal GitHub repo (push-only, DR-3)
version: 1.0.0
triggers:
  - "push to github"
  - "update repo"
  - "sync to github"
security:
  - DR-3: Push-only, never pull
  - DR-9: No shell interpolation
  - CC-2: AI attribution required
  - S6: Never expose credentials in output
  - S7: No auto-update from remote
---

# repo-update

Push local changes to the birbal GitHub repo.

## WHY
GitHub is the distribution mirror (DR-3). Local is truth. This skill makes pushing convenient while enforcing the one-way flow rule. It never pulls, fetches, or syncs from remote.

## Behavior

1. Run `git status` to show the user what will be pushed
2. Confirm with the user before pushing (no autonomous pushes)
3. Execute `git push` to the configured remote
4. Report push result

## Security Constraints

- **NEVER `git pull`, `git fetch`, or any form of remote-to-local sync** (DR-3, S7)
- Flow direction is `local → GitHub` only. One way. Push, never pull.
- Git commands use array-form spawn, never exec with interpolation (DR-9, S15)
- No credential values in output — git URLs with tokens are masked (S6)
- All git operations use repo-relative paths (DR-7, S8)
- AI attribution on commit messages when Birbal generates them (CC-2)

## What This Skill Does NOT Do

- Pull from remote (DR-3 — this is the #1 rule)
- Auto-push on a schedule (user triggers explicitly)
- Modify remote repo settings (branches, permissions, webhooks)
- Force-push (destructive — requires explicit user override)
