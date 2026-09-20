---
name: draft-post
description: Draft content for Substack (free tier)
version: 1.0.0
triggers:
  - "draft a post"
  - "write a substack post"
  - "draft content"
security:
  - DR-4: All HTTP through createSecureAgent()
  - DR-9: No shell interpolation
  - CC-2: AI attribution required
  - S6: Never expose credentials in output
---

# draft-post

Draft content for Substack publication (free tier).

## WHY
Content strategy is a Birbal platform pillar. Drafting locally ensures quality control before publishing. The user reviews, edits, and publishes manually — Birbal never publishes autonomously.

## Behavior

1. Accept a topic, angle, or rough outline from the user
2. Draft the post in markdown format
3. Include AI attribution footer per CC-2:
   `---`
   `*Drafted with AI assistance (Birbal). Edited and published by [author].*`
4. Save draft to `skills/draft-post/drafts/` with a timestamped filename
5. Present the draft for user review

## Security Constraints

- All outbound HTTP (if fetching references) MUST go through `createSecureAgent()` from `lib/transport.js` (DR-4, S1)
- No credential values in any output (S6)
- No shell interpolation of any user-provided topic or content (DR-9, S15)
- AI attribution is mandatory — no exceptions (CC-2, S14)

## What This Skill Does NOT Do

- Publish directly to Substack (user publishes manually)
- Access paid Substack features (free tier only)
- Send emails or notifications (CC-1 applies if that ever changes)
