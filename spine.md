# Spine — Birbal

WHY this spine exists: Two cross-cutting concerns — Jev as a decision layer and TDD
as default workflow — touch operating instructions, skill governance, and project
initialization. This map prevents drift between the pieces.

---

## Current Architecture

```
birbal/
├── CLAUDE.md              ← operating instructions (identity, philosophy, governance)
├── SECURITY.md            ← security contract (9 DRs, 15 rules, attack surface)
├── .env                   ← credentials (JEV_API_KEY, platform keys)
└── skills/
    ├── car-edit/          ← content editing skill
    ├── draft-post/        ← Substack content drafting
    ├── portfolio-sync/    ← cross-platform sync (Substack/GitHub/Notion)
    ├── repo-update/       ← GitHub repo maintenance
    └── typesafe-ai/       ← Jev integration ("ask jev" trigger)
```

## What Changed

### Jev Decision Layer (CLAUDE.md § Jev Decision Layer)

Jev is no longer just a callable skill — it's an operating principle.

```
Before:  User says "ask jev" → skill fires → API call → result
After:   Birbal thinks in Jev terms by default:
         ├── Split: generate vs. decide vs. execute
         ├── Atomic questions over giant prompts
         ├── Jev before the LLM (narrow the job)
         ├── Jev after the LLM (validate the output)
         ├── Route by confidence (auto / ask / escalate)
         ├── Batch independent decisions
         └── Bounded jobs (only what the branch needs)
```

**Live API gates** (actual Jev calls, not just philosophy):
- Spine gate (On Load) — Noul: "Does this project need a spine.md?"
- Risk gate — Score: before destructive/irreversible actions
- Route gate — Choice: when multiple valid approaches exist
- Validation gate — Noul: after generating significant artifacts

### TDD Protocol (CLAUDE.md § Test-Driven Development)

```
Default workflow for all code:
  Red   → write failing test (the spec)
  Green → minimum code to pass
  Refactor → clean up under test safety net

What gets tested:
  ├── Skills (core judgment/output against known input)
  ├── Jev decisions (boundary assertions on typed outputs)
  ├── Integrations (contract, not implementation)
  └── NOT: exploratory work, conversations, content drafts

Where tests live:
  tests/
  └── mirrors skills/ structure
```

### Integration Points

```
Skill Feedback Loop (existing, updated):
  └── Now includes: "Does this skill have tests?"
      If no → the ONE improvement proposed is: add a test

On Load (existing, updated):
  └── Now includes: spine.md gate via Jev Noul call

typesafe-ai skill (unchanged):
  └── Still handles explicit "ask jev" commands
      Jev Decision Layer principles apply alongside, not instead
```

## Dependencies

| Component | Depends on | WHY |
|-----------|-----------|-----|
| Jev Decision Layer | `.env` (JEV_API_KEY) | Live API calls for gates |
| Jev Decision Layer | `typesafe-ai` skill | Execution mechanism for "ask jev" |
| TDD Protocol | `tests/` directory | Test files need a home |
| Spine gate | Jev Decision Layer | Uses Noul primitive |
| Feedback Loop update | TDD Protocol | Checks for test existence |
