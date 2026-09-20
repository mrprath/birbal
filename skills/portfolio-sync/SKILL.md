---
name: portfolio-sync
description: Update Notion with projects, resume, and professional profile
version: 1.0.0
triggers:
  - "sync portfolio"
  - "update notion"
  - "update resume"
security:
  - DR-4: All HTTP through createSecureAgent()
  - DR-7: Repo isolation — no paths outside repo root
  - DR-9: No shell interpolation
  - CC-2: AI attribution required
  - S6: Never expose credentials in output
---

# portfolio-sync

Sync project data and resume content to Notion.

## WHY
Notion is the professional profile platform. Keeping it updated with current projects, skills, and experience ensures the portfolio reflects reality. Manual updates are forgotten — automated sync from the source of truth (this repo) prevents drift.

## Behavior

1. Read project metadata from repo (package.json, skills/, README if present)
2. Format project data for Notion page structure
3. Push updates to Notion via API through `createSecureAgent()` (DR-4)
4. Include AI attribution on any generated content (CC-2)
5. Report what was updated

## Security Constraints

- Notion API token comes from `.env` via `getEnv()` — never hardcoded (DR-2, S3)
- All HTTP through `createSecureAgent()` from `lib/transport.js` (DR-4, S1)
- Notion API URL must be in `settings.json` allowedUrls (DR-7)
- No credential values in any output (S6)
- No shell interpolation (DR-9, S15)
- Repo-relative paths only — no reading outside repo root (DR-7, S8)

## What This Skill Does NOT Do

- Create new Notion workspaces or databases (user sets these up)
- Share Notion pages with others (user manages permissions)
- Access any Notion content outside the designated portfolio pages
