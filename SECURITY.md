# Security Architecture — Birbal

This document is the security contract. It is read on every session load.
Every rule has a WHY. The WHY prevents circular decision-making.

---

## Attack Surface

What CAN be attacked:

| Surface | Risk | Status |
|---------|------|--------|
| Outbound HTTP calls | MITM, cert spoofing, data exfiltration | **Protected** — single transport gate (DR-4) |
| Credential storage | Leak via git, logs, or AI output | **Protected** — .env with mitigations (DR-2) |
| Remote repo (GitHub) | Compromised origin pushes malicious code | **Protected** — one-way local→remote flow (DR-3) |
| Dependency updates | Supply chain attack via auto-update | **Protected** — opt-in only (DR-3) |
| AI agent output | Credential exposure in responses | **Protected** — safety rule S6 |
| Cross-skill file access | Skill reads another skill's data | **Protected** — repo isolation (DR-7) |
| User-supplied input | Code injection via eval/interpolation | **Protected** — no eval contexts (DR-5) |
| JWT token tampering | Spoofed expiry delays refresh | **Accepted risk** — see DR-6 |
| File permission drift | Creds readable by local users after token refresh | **Protected** — atomic secure writes (DR-8) |
| Spawned tool environments | Creds leak into child process env | **Protected** — secret-env-vars in alias (DR-7) |
| Shell command execution | Command injection via exec() interpolation | **Protected** — array-form spawn only (DR-9) |

What we DO NOT protect against (and why):

| Surface | Why not |
|---------|---------|
| Local machine compromise | Out of scope — if the machine is owned, everything is owned. OS-level security is the user's domain. |
| Physical access attacks | Same reasoning. If someone has your laptop, .env is the least of your problems. |
| Insider threat (the user themselves) | Birbal trusts its operator. The security model protects outward, not inward. |
| JWT signature verification | See DR-6. Adds complexity, requires distributing signing CA's public key, provides zero added security in our architecture. |

---

## Decision Records

### DR-1: TLS Certificate Validation Strategy

**Decision:** All HTTPS calls validate certificates through `createSecureAgent()`. No override. No parameter to disable.

**WHY:** A single unvalidated connection is enough for MITM. If we allow a `skipValidation` flag "for development," it will ship to production. It always does. So the option doesn't exist.

**Implementation:**
- `rejectUnauthorized: true` is hardcoded, not configurable
- `NODE_TLS_REJECT_UNAUTHORIZED` env var is checked on startup — if set to `0`, Birbal refuses to start
- No self-signed cert support. Use mkcert for local development if needed — it installs a local CA properly.

**What we rejected:**
- Configurable cert validation → WHY: "temporary" bypasses become permanent. One flag away from insecure.
- Per-request override → WHY: same problem at a finer grain. More surface area, not less.

---

### DR-2: Credential Storage Strategy

**Decision:** All credentials are plaintext in `.env` with layered mitigations.

**WHY:** We need credentials accessible to scripts and skills. OS keychain (macOS Keychain, Windows Credential Manager) would be ideal in theory but fails in practice for our use case.

**What we rejected and WHY:**
- OS Keychain → Cross-platform complexity (Windows/macOS/Linux all different APIs), build dependencies (native modules), setup friction for every new machine. We'd need key management infrastructure that doesn't exist yet.
- Encrypted .env → Requires a master key. Where does the master key live? You've moved the problem, not solved it. Adds complexity without meaningful security gain for a local-first tool.
- Vault/secrets manager → Requires infrastructure we don't operate. Birbal is local-first.

**Mitigations (these ARE enforced, not suggested):**

1. **File permissions:** `chmod 600` enforced on every write to `.env`, not just on init. Every time a script touches `.env`, permissions are re-set. Implemented via `secureWriteFile()` — see DR-8.
   - WHY: Permissions drift. A copy-paste, a restore from backup, a new tool — any of these can reset permissions. So we re-enforce on every write.

2. **Git exclusion:** `.env` is in `.gitignore`. Pre-commit hook verifies this.
   - WHY: `.gitignore` can be edited. The hook catches it before damage is done.

3. **Base64 encoding for multiline values:** Cookies, refresh tokens, and any multiline credential values are stored base64-encoded.
   - WHY: Storage integrity. Multiline values in `.env` files break parsing. Base64 guarantees single-line storage and clean deserialization. This is NOT encryption — it's encoding for correctness.

4. **Safety Rule S6 — AI agents never expose credential values in output:**
   - Birbal will never print, log, or include in any response the value of any credential from `.env`
   - WHY: AI agents produce visible output. Users copy-paste output. Credentials in output become credentials in Slack, in screenshots, in shared docs. The rule is absolute.

---

### DR-3: Auto-Update Policy

**Decision:** Auto-update is opt-in only. Birbal never pulls from remote without explicit user action.

**WHY:** If the GitHub repo is compromised (stolen token, social engineering, supply chain), an auto-update pulls malicious code directly into the trusted local environment. The local folder is the source of truth. GitHub is a distribution mirror.

**Flow direction:** `local → GitHub` only. One way. Push, never pull.

**What this means in practice:**
- `git pull` is never run automatically
- No scheduled sync from remote
- User manually decides when to push
- If GitHub is compromised, the local copy is unaffected

**What we rejected:**
- Bidirectional sync → WHY: opens the attack surface to compromised remote
- Auto-pull with signature verification → WHY: adds complexity, requires key management, and the simpler rule (don't pull) is more robust

---

### DR-4: Single Transport Gate

**Decision:** All outbound HTTP/HTTPS traffic flows through one function: `createSecureAgent()`, exported from `lib/transport`.

**WHY:** If HTTP calls are scattered across the codebase, security is scattered too. One call skips TLS validation. Another has no timeout. A third retries forever. Centralization means one place to enforce, one place to audit, one place to fix.

**What `createSecureAgent()` enforces:**
- TLS certificate validation (DR-1)
- Request timeouts (configurable per-call, with a mandatory ceiling)
- Retry logic (with exponential backoff and a max retry count)
- Request logging (method, URL, status — never bodies or credentials)
- Rate limiting awareness

**Enforcement:**
- Pre-commit hook scans for direct imports of `http`, `https`, `node-fetch`, `axios`, `got`, `undici`, or raw `fetch()` outside of `lib/transport`
- Any match blocks the commit with an explanation pointing to `createSecureAgent()`

---

### DR-5: Input Validation — No Eval Contexts

**Decision:** Never interpolate user-supplied values into eval contexts. All user input passes through `process.argv` or environment variables only.

**WHY:** A `script.sh` that interpolates a user-entered email directly into a Node string like `` `node -e "doThing('${email}')"` `` is a code injection vector. If that email contains JavaScript-breaking characters (`'; process.exit();//`), it executes as code. This is not theoretical — it's the most common injection pattern in shell-to-Node bridges.

**Implementation pattern:**

```bash
# WRONG — injection via interpolation
node -e "import { send } from './src/mail.js'; send('${USER_EMAIL}')"

# RIGHT — value passed via env, never touches eval
USER_EMAIL="$1" node --input-type=module -e "
  import { setEnv } from './src/env.js';
  setEnv('EMAIL', process.env.USER_EMAIL);
"
```

**Input format validation:**
- All user-supplied values are validated BEFORE use
- Email: simple regex check (`/^[^\s@]+@[^\s@]+\.[^\s@]+$/`)
- URLs: parsed via `new URL()` — if it throws, it's rejected
- Freeform text: length-capped, stripped of control characters

**What we rejected:**
- Sanitization/escaping of interpolated values → WHY: escaping is a game of whack-a-mole. Every new context has different escape rules. The simpler rule is: never interpolate. Pass by env. No escaping needed because no interpolation exists.

---

### DR-6: JWT Handling — Decode Without Signature Verification

**Decision:** JWTs are decoded for claims (exp, sub, etc.) but signature verification is NOT performed.

**WHY this is an accepted risk, not a gap:**

The threat model: an attacker modifies the JWT stored in `.env` to spoof the `exp` claim. Birbal thinks the token is still valid, doesn't refresh, and continues using it until the API rejects it — which could be too late for some operations.

**Why we accept this:**
- The JWT lives in `.env` on the local machine. If an attacker can modify `.env`, they already have local access — they can do far worse than spoof a JWT expiry.
- Signature verification would require distributing the signing CA's public key. That's key management infrastructure we don't have (DR-2 explains why).
- It adds complexity for zero added security in our threat model. The API is the ultimate validator — if the token is bad, the API rejects it.

**What we rejected:**
- Adding signature verification → WHY: provides zero security gain (attacker with .env access already owns everything), adds complexity, requires public key distribution.

**Mitigation:**
- API rejection errors trigger immediate token refresh
- Failed API calls due to auth are retried once after refresh

---

### DR-7: Repo Isolation Boundary

**Decision:** Birbal operates as a fully isolated environment. The alias sets Claude's working directory to this repo root, and all discovery happens from here only.

**WHY:** If Birbal reads instructions or config from outside this repo (e.g., `~/.claude/` global config), a compromised or conflicting global file could override security rules, inject instructions, or change behavior without the user knowing.

**Isolation mechanisms:**

1. **Alias scoping:** The `birbal` alias `cd`s to the repo root. All instructions (CLAUDE.md, SECURITY.md) are discovered only from here.
   - WHY: Prevents global config from overriding local security decisions.

2. **Repo-relative paths only:** All file paths in skills, scripts, and configs must be relative to repo root. No absolute paths outside this repo.
   - WHY: Absolute paths are a scope escape. `../../../etc/passwd` is technically relative but escapes scope. Paths are validated to resolve within repo root.

3. **Trusted folders allowlist:** `config.json` contains an allowlist of directories Birbal may access. Scoped to repo root only — not the entire home directory.
   - WHY: Default-deny. If a skill tries to read `/Users/owner/Documents/taxes.pdf`, it's blocked unless explicitly allowed. The allowlist is narrow by design.

4. **Allowed URLs allowlist:** `settings.json` contains allowed outbound URLs, limited to known enterprise endpoints. New URLs require explicit user approval.
   - WHY: Prevents data exfiltration to arbitrary endpoints. A compromised skill can't POST credentials to `evil.com` if `evil.com` isn't on the list.

5. **Secret-env-vars in alias:** The shell alias uses `--secret-env-vars` to prevent credentials from leaking into spawned tool environments.
   - WHY: When Birbal spawns a subprocess (a script, a build tool), that subprocess inherits the environment by default. Secret env vars are excluded from child process inheritance.

6. **Startup conflict detection:** `startup.js` warns if conflicting global Claude files exist (e.g., `~/.claude/CLAUDE.md`) that could interfere with isolation.
   - WHY: Silent conflicts are worse than loud ones. If a global config exists that Birbal might accidentally read, the user should know immediately.

**What we rejected:**
- Using the home directory as trusted scope → WHY: too broad. Home directory contains SSH keys, browser profiles, cloud credentials. Birbal has no business there.
- Implicit trust of global config → WHY: global config is shared with vanilla Claude. Changes made for vanilla Claude could break Birbal's security model.

---

### DR-8: File Permission Lifecycle — Atomic Secure Writes

**Decision:** All writes to sensitive files (`.env`, tokens, credentials) use `secureWriteFile()` which performs atomic write-then-rename with permission enforcement.

**WHY:** The default `fs.writeFileSync()` creates a file with whatever the current umask allows. If the default umask is permissive (e.g., `0o022`), the file is world-readable for the duration of the write. On a multi-user system, or if a token auto-refreshes while the user is away, any local user can read all credentials in that window.

**Implementation in `lib/secure-write.js`:**

```javascript
// secureWriteFile(targetPath, content)
// 1. Write to tmpFile with { mode: 0o600 }
// 2. Rename tmpFile → targetPath (atomic on same filesystem)
// 3. fs.chmodSync(targetPath, 0o600) — explicit, even after rename
```

**WHY the explicit chmod after rename:**
- Some filesystems don't preserve mode bits across rename
- Some OS configurations apply umask even to rename targets
- The cost of an extra chmod is zero. The cost of assuming it worked is credential exposure.

**Integration:**
- `setEnv()` in `src/env.js` uses `secureWriteFile()` — never raw `fs.writeFileSync()`
- Any script that writes to `.env` must import and use `secureWriteFile()`
- Pre-commit hook scans for raw `fs.writeFileSync` calls targeting `.env` or credential files

---

### DR-9: Shell Injection Prevention

**Decision:** No shell interpolation of variables into commands. All subprocess execution uses array-form spawn. User input never passes through shell expansion.

**WHY:** `exec()` runs through `/bin/sh` (or `cmd.exe` on Windows). Any user input containing `;`, `$()`, `|`, or backticks becomes executable code. This is command injection — OWASP #1. The fix isn't escaping (escaping is incomplete by definition). The fix is never entering a shell context with user data.

**Implementation:**

```javascript
// WRONG — exec() passes through shell, user input becomes code
exec(`node script.js ${userArg}`);           // ; rm -rf / executes
exec('node script.js ' + userArg);           // same problem, different syntax

// RIGHT — spawn() with array args, no shell involved
spawn('node', ['script.js', userArg]);        // userArg is a single argv element
execFile('node', ['script.js', userArg]);     // same safety, synchronous option
```

**Rules:**
1. **No `exec()` or `execSync()` with variable interpolation** — these always invoke a shell
2. **Use `spawn()` / `spawnSync()` / `execFile()` with array arguments** — these bypass the shell entirely
3. **Never pass user input through shell expansion** — no `${var}` in shell strings, no string concatenation into commands
4. **If shell: true is needed (rare), variables must not contain user input** — static commands only

**What we rejected:**
- Shell escaping libraries → WHY: escaping is a blocklist approach. You're betting the library knows every shell metacharacter in every shell version. One miss = injection. The safer rule: don't use a shell.
- Allowlist validation of shell arguments → WHY: adds complexity and still requires the developer to remember to validate. Array-form spawn requires nothing — the safety is structural, not procedural.

---

## Communication Constraints

### CC-1: Outbound Email Rules

**Decision:** Every outbound email CC's the session user. No emails to aliases or distribution lists.

**WHY (CC):** If Birbal sends an email on the user's behalf, the user must have visibility. A BCC or a send-without-CC means the user might not know what was sent in their name. The CC ensures a paper trail the user can see.

**WHY (no aliases/distribution lists):** An alias like `team@company.com` or `all-hands@company.com` can reach hundreds of people. A bug or misfire in Birbal's email composition becomes a company-wide incident. Individual recipients only — if you need to email a group, do it manually.

### CC-2: AI Attribution

**Decision:** All content generated by Birbal carries an AI attribution signature.

**WHY:** Transparency. If Birbal writes a blog post, a Substack article, or a LinkedIn update, the audience should know AI was involved. This isn't a legal requirement (yet) — it's an integrity decision. The user's reputation is built on honesty, and undisclosed AI authorship undermines that.

**Format:** Each piece of generated content includes an attribution line appropriate to the platform.

---

## Rules Summary

| # | Rule | Enforcement | DR |
|---|------|-------------|----|
| S1 | All HTTP through `createSecureAgent()` | Pre-commit hook | DR-4 |
| S2 | TLS always validated, no override | Hardcoded in transport gate | DR-1 |
| S3 | Credentials only in `.env` | Pre-commit hook + grep scan | DR-2 |
| S4 | `.env` permissions `chmod 600` on every write | `secureWriteFile()` | DR-2, DR-8 |
| S5 | `.env` always in `.gitignore` | Pre-commit hook | DR-2 |
| S6 | AI agents never expose credential values | Instruction-level rule | DR-2 |
| S7 | No auto-update from remote | Architecture: push-only flow | DR-3 |
| S8 | Repo isolation — no paths outside repo root | Path validation + allowlist | DR-7 |
| S9 | No eval interpolation of user input | Code pattern: env vars only | DR-5 |
| S10 | Atomic secure writes for all credential files | `secureWriteFile()` | DR-8 |
| S11 | Secret env vars excluded from child processes | Shell alias flag | DR-7 |
| S12 | All outbound email CC's session user | Enforced in email skill | CC-1 |
| S13 | No emails to aliases or distribution lists | Enforced in email skill | CC-1 |
| S14 | AI attribution on all generated content | Enforced in content skills | CC-2 |
| S15 | No shell interpolation — array-form spawn only | Pre-commit hook + code review | DR-9 |
