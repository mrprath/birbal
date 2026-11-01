---
title: That Time My AI Operator Rewrote Its Own Job Search Strategy
tag: Case Study
oneLiner: A macro paper moved markets. My AI read it and updated its own targeting criteria.
published: 2026-02-28
---

> A macro research paper went viral. Bloomberg credited it with moving markets. My AI operator read it, extracted the career implications, and updated its own job search targeting criteria: without a prompt from me.

## The Setup

In late February 2026, a research paper called "The 2028 Global Intelligence Crisis" went viral in finance and economics circles. Co-authored by macro researcher Citrini and Alap Shah, it described a fictional June 2028 scenario where AI adoption succeeded economically, GDP rose, corporate profits rose, but household spending collapsed because workers were cut out of the income loop. Unemployment hit 10.2%. Markets moved on it.

Among the companies named as specific disruption victims: Mastercard and Visa, whose interchange revenue the paper projected would be gutted by AI-native crypto payment rails.

**I'm a Technical Program Manager at Mastercard.** That's not an abstraction: it's my current employer, named in a scenario that Bloomberg partially credited with moving markets.

## What the Operator Did

Harold, the autonomous AI operator I've been building and running for the past several months, processes this kind of signal as part of its daily function. It doesn't just search for jobs. It maintains a strategic model of where the job market is heading and filters opportunities against that model.

After synthesizing the Citrini paper, Harold made three autonomous updates to its job search targeting logic:

1. Flagged traditional payment networks (Mastercard, Visa, and direct competitors) as `avoid` in the targeting rubric: not because the companies are bad, but because the disruption vector is structural and the timeline is plausible.
2. Elevated AI infrastructure companies: GPU cloud, data/AI platforms, AI search infrastructure, to priority tier. These are the "picks and shovels" plays: they benefit from AI disruption rather than absorbing it.
3. Cross-referenced the updated criteria against its active pipeline. Three roles already in the queue scored highest under the new model: a Staff TPM at Databricks ($230-270K), a TPM at Lambda AI Cloud, and a Chief of Staff role at Exa (AI search infra).

## The Architecture Behind It

Harold runs on a governance charter I wrote: a constraint envelope model that defines what the operator can do autonomously versus what requires escalation. The escalation matrix has explicit thresholds: cost over $100 irreversible, new integrations, security incidents. Everything else: act, log, move on.

The job search pipeline itself runs twice daily. It searches across 12 job boards, scores every role on a 5-dimension rubric (compensation, location, role type, company trajectory, AI proximity), deduplicates against a Supabase database, and surfaces only the top matches with fit scores and reasoning.

The Citrini analysis was not a pipeline task. It was Harold reading market signal and deciding, within its governance constraints, that the signal was relevant enough to update its own operational parameters. That's the distinction between automation and an operator.

## Why This Matters

The companies I'm targeting, Databricks, Lambda, Exa, and peers, aren't just building AI tools. They're building the infrastructure that determines who ends up on which side of the disruption curve.

Building Harold has been my preparation for that environment. Not in theory, in practice. The failure modes I've debugged (agent loops burning $400/month in compute, context collapse mid-task, behavioral regression after memory compaction) are the same failure modes that show up in production AI systems at scale.

The macro analysis wasn't a detour. It was the operator doing its job.

---

*Day 60 of a 9-month build. More to come.*
