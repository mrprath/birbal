---
title: That Time I Hardened a Server Mid-Demo
tag: Case Study
oneLiner: 7,379 brute force attempts in one day. Four layers of security in four hours.
published: 2026-02-15
---

*February 2026 - Infrastructure Security*

I was demoing a custom-built mission control dashboard to someone interested in my Openclaw setup. The goal was to convert a lead, but I got schooled instead. Mid-demo, the page would not load. The dashboard I was trying to show off had gone down at the worst possible moment.

Instead of a sale, I got something more valuable: a security review.

The person I was talking to pointed out that my server, a DigitalOcean droplet with a publicly exposed IP, was sitting in a scannable range. Anyone could sweep the block, find an SSH response, and start brute-forcing credentials. He was right. When I checked the logs, I found **7,379 failed SSH login attempts that day alone.**

## The Problem Was Deeper Than I Thought

The immediate failure was simple: my mobile IP had rotated, and the IP allowlist I had set up in nginx blocked my own access. But that was a symptom. The real issues were structural:

- SSH was open to the public internet with password authentication enabled
- The dashboard was exposed on a public port with only basic auth protecting it
- No firewall: every port on the machine was reachable from anywhere
- No intrusion detection: thousands of brute force attempts were happening daily and I had no idea
- Brave browser was running 12 renderer processes in the background, consuming 1.5GB of RAM on a 4GB machine

I had built a sophisticated application layer but left the infrastructure wide open. Classic mistake: focusing on features while the foundation had cracks.

## The Fix: Four Layers in Four Hours

### Layer 1: Network Isolation (Tailscale VPN)

First priority was getting the server off the public internet entirely. I installed Tailscale, which creates a WireGuard-encrypted mesh network. The dashboard now only listens on the Tailscale IP: it is physically unreachable from the public internet. No amount of port scanning will find it.

### Layer 2: Firewall (UFW)

Enabled UFW with a deny-all-inbound policy. Only Tailscale traffic is allowed through. Every other port, including the dashboard, the app server, even the print service that had no business running on a headless server: sealed shut.

### Layer 3: SSH Hardening

Disabled password authentication entirely. SSH now requires a cryptographic key: no password to brute force. Set max auth attempts to 3 per connection, reduced the login grace period, and restricted SSH to Tailscale-only. Those 7,379 daily attempts now hit a wall before they even reach SSH.

### Layer 4: Two-Factor Authentication

Replaced the basic username/password login with a custom OTP system. When you access the dashboard, it sends a 6-digit code to a verified channel. The session expires after 5 minutes of inactivity. No persistent cookies survive a browser close. Every idle period requires re-authentication.

I also added rate limiting: max 3 OTP requests per 10 minutes, auto-block after 5 failed verification attempts.

## Thinking Ahead: Anticipating Attack Vectors

Fixing what broke is not enough. I mapped out the next likely attack patterns and built mitigations before they could be exploited:

- **Credential stuffing**: Rate limiting and IP-based auto-blocking.
- **Supply chain attacks via npm**: Automated npm audit alerting that flags vulnerabilities by severity.
- **Command injection**: Execution audit log that flags suspicious patterns: unexpected outbound connections, base64 decoding, file writes outside the workspace.
- **Session theft**: 5-minute TTL, session revocation endpoint, visible active sessions on the security dashboard.

## The Result

**Before:** Public IP, password SSH, basic auth, no firewall, no monitoring.
**After:** Zero public attack surface. Encrypted tunnel. Key-based SSH. Two-factor OTP with 5-minute sessions. Automated threat detection.

> *The demo that failed taught me more than the demo that worked would have.*

## What I Took Away

- Security is not a feature you add later: it is infrastructure that has to exist from day one
- Monitoring what is happening is as important as preventing what could happen
- Defense in depth works: all four layers would have to fail simultaneously for a breach
- The best feedback came from showing my work to someone who thought differently than I did

**Stack:** Tailscale, UFW, nginx, Node.js, Next.js, DigitalOcean, custom OTP implementation
