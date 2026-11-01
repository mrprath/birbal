---
title: Claude Code Setup + Presets
tag: Tool
oneLiner: Three CLAUDE.md presets for different project types. Copy, paste, build.
published: 2026-03-04
---

> Save each CLAUDE.md to the root of your project in VS Code. Claude Code reads it automatically every session.

---

## Quick Setup

1. Download VS Code: `https://code.visualstudio.com`
2. Open Extensions (`Cmd+Shift+X` Mac / `Ctrl+Shift+X` Windows) -> search **Claude Code** -> install Anthropic's -> sign in

> Use API key auth when signing in.

---

## VS Code Layout

- **Left sidebar**: file explorer
- **Center**: editor, tabs like a browser
- **Bottom**: terminal (`Ctrl+backtick` to open)
- `Cmd+Shift+P`: Command Palette. Forget every other shortcut, remember this one.

---

### Preset 1: Scentient Website

*Save as CLAUDE.md in your Scentient project root*

A full CLAUDE.md for a Next.js 14 + TypeScript + Tailwind + Supabase project. Includes brand constraints (color palette, tone, typography), code conventions (strict TypeScript, Tailwind only, async/await), folder structure, and environment variable guidance.

Key brand rules: Bone `#F0EDE6`, Ink `#050505`, Ember `#C84B1F`, Ash `#4A4A4A`. Serif headings (Playfair Display), sans body (Inter). No gradients. Clean negative space.

### Preset 2: Blank Template

A generic CLAUDE.md template for any new project. Fill in the brackets: project name, stack, primary goal, code conventions, folder structure, environment variables, current task, done criteria.

### Preset 3: Learning Mode

Merge into any CLAUDE.md when you want Claude Code to explain as it builds. Key behaviors:

- **Explain before you do.** Describe what you're about to do and why in plain English.
- **Name the concept.** When you use a pattern, name it so you can look it up.
- **Flag the tradeoffs.** If there are two ways to do something, say so briefly.
- **Point to the docs.** For anything non-obvious, mention where the official documentation lives.

Includes a concepts-to-reinforce section (state vs props, client vs server, sync vs async, types) and a checkpoint protocol: pause after significant changes and ask if a walkthrough is wanted.

## Key Shortcuts

- `Cmd+Shift+P`: Command Palette
- `Cmd+P`: Open file by name
- `Ctrl+backtick`: Terminal
- `Cmd+Shift+F`: Search all files
