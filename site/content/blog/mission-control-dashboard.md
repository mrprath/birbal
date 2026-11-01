---
title: Project: Mission Control
tag: Tool
oneLiner: One dashboard to know if everything is healthy in under five seconds.
published: 2026-03-01
---

*Full-stack operational dashboard - Next.js, TypeScript, Supabase*

## The Problem

I was running a complex system with multiple automated pipelines: job search alerts, competitive intelligence scrapers, security scans, scheduled reports, and I had no single view of what was happening. Everything lived in terminal logs and database tables. When something broke, I found out late. When something worked, I had no visibility into how well.

## What I Built

A real-time mission control interface that consolidates everything into one view:

- Kanban board: task lifecycle from backlog to completion, synced to PostgreSQL
- Objectives tracker: quarterly and monthly goals with progress indicators and contextual signals
- Architecture diagrams: three interactive layers (tech stack, feature flows, feedback loops) with zoom/pan
- Security dashboard: threat detection, escalation tiers, active session management
- API usage analytics: token consumption, cost tracking, model breakdown
- Cron job manager: view, trigger, and monitor all scheduled automation

## Why It Matters

This project forced me to think about operational visibility the way a platform team does. It is not enough to build something that works: you need to know it works, continuously, without manually checking. The dashboard became the forcing function for better logging, better error handling, and better architecture across every other project.

**Stack:** Next.js 16, TypeScript, Supabase (PostgreSQL + pgvector), Tailscale, nginx, PM2, DigitalOcean

---

## Building Operational Visibility From Scratch

There is a moment in every project where you realize you have been flying blind. For me it was a Tuesday night, staring at terminal output, trying to figure out why a scheduled job had silently failed twelve hours earlier. The data pipeline had broken, no alerts fired, and I only noticed because the results looked stale.

That was the moment I decided to build Mission Control.

### The Dashboard Is Not the Product: Visibility Is

The temptation with any dashboard project is to make it look impressive. And yes, mine has interactive architecture diagrams with zoom and pan, animated feedback loops, and a liquid glass UI that looks great on mobile. But none of that is the point.

The point is that at 2 AM on a Saturday, I can glance at my phone and know, in under five seconds, whether everything is healthy. Green dots mean the crons ran. Cost numbers mean the APIs are responding. The Kanban board tells me what is in flight without me needing to remember.

### What I Learned About Platform Thinking

Building this dashboard changed how I think about every other system I build. Before, I would write code that worked and move on. Now, every new feature starts with three questions:

- **How will I know if this breaks?** If the answer is "I will check manually," the feature is not done.
- **What does healthy look like?** If I cannot define a metric or signal for health, I do not understand the feature well enough to ship it.
- **Who else needs to see this?** If I am the only one who can interpret the system state, I have created a bus factor of one.

### Metrics That Matter

The dashboard tracks API costs in real time. This might sound like a minor feature, but it changed my behavior immediately. When you can see that a single sub-agent run costs $0.45 and you are spawning twelve of them per day, you start asking whether all twelve are necessary.

Visibility creates accountability. Not the performative kind: the genuine kind where you make better decisions because you can see the consequences.

> *The best dashboard is the one you check because you want to, not because something is on fire.*
