# Birbal

Security-first AI agent skill library. Skills are small, testable units that
follow a shared contract. The security model is documented in
[SECURITY.md](SECURITY.md) and enforced by automated tests.

## Setup

```bash
npm install
cp .env.example .env   # fill in real values — see SECURITY.md DR-2
```

## Architecture

```
lib/            Spine — security infrastructure, tested bottom-up
.claude/skills/ Skills — each has a SKILL.md with YAML frontmatter
tests/          TDD — behavioral, security regression, skill contracts
mcp/            MCP tool server and proxy
```

See [spine.md](spine.md) for the full dependency map and design decisions.

## Skills

| Skill | Description |
|-------|-------------|
| [typesafe-ai](.claude/skills/typesafe-ai/SKILL.md) | Jev integration: typed AI judgments (Choice, Score, Noul) |
| [skill-builder](.claude/skills/skill-builder/SKILL.md) | Meta-skill for creating new skills |
| [email-sort](.claude/skills/email-sort/SKILL.md) | Gmail triage via Jev classification |
| [newsletter](.claude/skills/newsletter/SKILL.md) | Daily digest: source sweep, clustering, Beehiiv + Notion |
| [blog-it](.claude/skills/blog-it/SKILL.md) | Draft and publish blog posts to Notion |

## Tests

```bash
npm test              # all tests
npm run test:spine    # spine behavioral tests
npm run test:security # security regression guards
npm run test:contracts # skill contract checks
npm run test:mcp      # MCP server tests
```

## Security

Every rule has a WHY. See [SECURITY.md](SECURITY.md) for the full architecture:
9 decision records, 15 enforced rules, and an explicit attack surface map.

Key constraints:
- All HTTP through a single transport gate (DR-4)
- TLS always validated, no override (DR-1)
- Credentials only in `.env`, `chmod 600` on every write (DR-2, DR-8)
- Push-only flow to GitHub — local is truth (DR-3)
- No eval interpolation of user input (DR-5)
- Array-form spawn only, no shell injection (DR-9)

## License

ISC
