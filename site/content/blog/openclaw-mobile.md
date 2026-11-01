---
title: Project: OpenClaw Mobile
tag: Tool
oneLiner: A native app because "works on mobile" and "works well on mobile" are different things.
published: 2026-02-18
---

*Cross-platform mobile client - Expo, React Native, TypeScript*

## The Problem

I needed to interact with my backend systems on the go: not through a mobile browser, but through a native app that felt right. The web dashboard worked but mobile Safari had constant issues with caching, authentication state, and performance on complex pages.

## What I Built

A React Native app designed as a universal client. It does not hardcode any backend: you point it at any instance and it connects over WebSocket JSON-RPC. The protocol supports real-time streaming, so you see output as it happens rather than waiting for a complete response.

- Real-time WebSocket communication with automatic reconnection and exponential backoff
- Secure credential storage using Expo SecureStore (keychain on iOS, encrypted prefs on Android)
- Conversation persistence across sessions
- Session management: switch between multiple active contexts

---

## Why I Built a Native App Instead of Fixing the Mobile Web

The obvious question: why build a native mobile app when you already have a web dashboard? Because "works" and "works well" are different things on mobile.

### The Browser Is Not Your Friend on Mobile

Here is what kept happening with the web dashboard on my phone:

- Safari would cache old JavaScript chunks and refuse to load new deployments
- The basic auth prompt appeared every time Safari decided to forget my credentials
- Complex SVG diagrams would stutter during scroll
- Switching between the dashboard tab and another app often killed the tab entirely
- There was no way to receive notifications or run any logic in the background

Each of these individually is a minor annoyance. Together, they made the mobile web experience unreliable enough that I would avoid checking it unless I had to.

### The WebSocket Decision

The backend uses a JSON-RPC protocol over WebSocket, not REST. WebSockets give you something REST cannot: real-time bidirectional communication. When I send a command, I see the response streaming in character by character. The difference in feel is significant: one feels like a conversation, the other feels like submitting a form and waiting for the page to reload.

Building the WebSocket layer taught me about reconnection strategies. Mobile networks are unreliable. The app implements exponential backoff with jitter, which means it reconnects quickly after brief disconnections but does not hammer the server during extended outages.

### Security on Mobile Is a Different Problem

On the web, security means HTTPS, cookies, CORS headers. On mobile, the threat model shifts. Credentials need to survive app restarts but not device theft.

Expo provides SecureStore, which maps to the iOS Keychain and Android encrypted shared preferences. This means credentials are encrypted at the OS level: even if someone gets access to the app sandbox, they cannot read the stored tokens without the device unlock.

> *The best tool is the one you actually use. If checking on your systems requires opening a browser, logging in, and hoping the page loads: you will not check as often as you should.*

**Stack:** React Native, Expo, TypeScript, WebSocket JSON-RPC, SecureStore, EAS Build
