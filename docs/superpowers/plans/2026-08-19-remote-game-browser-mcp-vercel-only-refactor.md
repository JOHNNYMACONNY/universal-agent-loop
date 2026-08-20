# Vercel-Only Browser Runtime Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove Redis/Upstash from the remote game-browser runtime while preserving stateless-coordinator correctness through signed registration capabilities and persistent Vercel Sandbox-local session state.

**Architecture:** The Vercel coordinator remains stateless. Registration state becomes a short-lived signed capability. Per-session mutable state moves into the named persistent Sandbox and is serialized by the closed sandbox worker using a cross-process lock and atomic file replacement. Browser continuity remains separate from filesystem persistence and fails closed if Chromium is lost.

**Tech Stack:** Node 24, TypeScript, MCP v2, Express 5, Zod, Vercel Sandbox, agent-browser/Chromium, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-08-19-remote-game-browser-mcp-design.md` plus `docs/superpowers/specs/2026-08-19-remote-game-browser-mcp-vercel-only-amendment.md`

## Global Constraints

- No local-computer dependency.
- No generic shell/JavaScript/browser escape hatch exposed through MCP.
- Preserve exact-commit provenance, target allowlisting, SSRF/DNS protections, input idempotency, fail-safe input release, and untrusted-browser-content boundaries.
- Production sandboxes are named, persistent, per-session, and deleted on explicit end.
- Restored filesystem state does not imply restored Chromium state.
- Root UAL remains zero-runtime-dependency.

---

### Task 1: Production contract no longer requires Redis

**Files:**
- Modify: `apps/game-browser-mcp/tests/production-app.test.ts`
- Modify: `apps/game-browser-mcp/tests/auth.test.ts`
- Modify: `apps/game-browser-mcp/package.json`
- Modify later after GREEN: lockfile and obsolete Redis files.

**Produces:** failing tests requiring no `UPSTASH_*` production env names/dependency and no production `RedisRateLimiter`.

- [ ] Write tests asserting Redis env names are absent and Vercel/runtime signing inputs remain required.
- [ ] Commit RED and observe the PR CI failure.
- [ ] Do not change production code until RED is confirmed.

### Task 2: Signed target-registration capabilities

**Files:**
- Create: `apps/game-browser-mcp/src/provenance/registration-capability.ts`
- Create: `apps/game-browser-mcp/tests/registration-capability.test.ts`
- Modify: `apps/game-browser-mcp/src/provenance/registration-service.ts`
- Modify: `apps/game-browser-mcp/src/admin/register-deployment.ts`
- Modify: `apps/game-browser-mcp/src/tools/index.ts`
- Modify: existing registration tests.

**Interfaces:**
- `RegistrationCapabilityCodec.issue(registrationWithoutExternalId): string`
- `RegistrationCapabilityCodec.verify(capability: string, now?: Date): TargetRegistration`
- HMAC-SHA-256 over canonical base64url payload using a server secret distinct from target/browser content.

- [ ] Test valid issue/verify, payload/signature tamper rejection, expiry rejection, and strict schema validation.
- [ ] Observe RED.
- [ ] Implement codec and adapt registration/service/tool lookup.
- [ ] Require tests/typecheck/build GREEN.

### Task 3: Sandbox-local durable SessionStore

**Files:**
- Create: `apps/game-browser-mcp/src/sessions/vercel-sandbox-session-store.ts`
- Create: `apps/game-browser-mcp/tests/vercel-sandbox-session-store.test.ts`
- Modify: `apps/game-browser-mcp/sandbox/worker.mjs`
- Modify: `apps/game-browser-mcp/src/browser/vercel-sandbox-browser.ts`
- Modify: `apps/game-browser-mcp/tests/vercel-sandbox-browser.test.ts`

**Interfaces:**
- Production class implements existing `SessionStore`.
- Sandbox name is deterministically derived from logical session ID.
- Worker adds closed operations for create/get/begin/complete/touch/held/recovery/observation/end.
- Worker uses atomic lock-directory acquisition and temp-file rename for mutations.

- [ ] Test persistent sandbox creation (`persistent: true`) and bounded snapshot expiration.
- [ ] Test fresh store/coordinator instances reconnect to one running sandbox and see the same record.
- [ ] Test concurrent novel batches: only one accepted; duplicate completed batch returns prior result.
- [ ] Test stopped sandbox fails closed without treating restored filesystem as live browser continuity.
- [ ] Observe RED.
- [ ] Implement worker/store/browser changes.
- [ ] Require GREEN.

### Task 4: Production composition without Redis

**Files:**
- Modify: `apps/game-browser-mcp/src/server.ts`
- Modify: `apps/game-browser-mcp/src/auth/rate-limit.ts`
- Modify: `apps/game-browser-mcp/tests/production-app.test.ts`
- Modify: `apps/game-browser-mcp/tests/http-config-regression.test.ts`
- Modify: `apps/game-browser-mcp/tests/rate-limit-integration.test.ts`

**Produces:** production uses signed registration codec + Vercel Sandbox session store; memory limiter remains test-only; Redis production classes are gone.

- [ ] Add/adjust failing production-composition tests.
- [ ] Observe RED.
- [ ] Wire Vercel-only production composition and remove Redis startup requirements.
- [ ] Require tests/typecheck/build GREEN.

### Task 5: Remove obsolete Redis implementation and dependency

**Files:**
- Delete: `apps/game-browser-mcp/src/sessions/upstash-session-store.ts`
- Delete: `apps/game-browser-mcp/src/provenance/upstash-registration-store.ts`
- Modify/delete Redis-specific tests.
- Modify: `apps/game-browser-mcp/package.json`
- Modify: `apps/game-browser-mcp/package-lock.json`
- Modify: `apps/game-browser-mcp/README.md`
- Modify: provider preflight/live workflow secret expectations.

- [ ] Add a repository-boundary test asserting production source/package/env docs contain no Upstash requirement.
- [ ] Observe RED before deletion/manifest change.
- [ ] Remove obsolete implementation and regenerate lockfile deterministically in remote CI if needed.
- [ ] Require root + runtime tests/typecheck/build GREEN.

### Task 6: Fresh independent review and live Vercel gate

**Files:**
- Add/update review checkpoint under `docs/superpowers/reviews/` only after code is frozen.

- [ ] Compare final branch against approved design + amendment.
- [ ] Run fresh full CI on exact final commit.
- [ ] Independently review security, concurrency, provenance, recovery, prompt-injection boundary, and authority.
- [ ] Repair and repeat VERIFY/REVIEW for any material finding.
- [ ] Provision/deploy only preview/test resources under existing authorization.
- [ ] Create/use pinned browser snapshot.
- [ ] Run provider-backed Canvas/WebGL acceptance against exact deployment commit.
- [ ] Inspect evidence artifact and runtime logs.
- [ ] Claim `RUNTIME_COMPLETE` only after fresh provider-backed PASS and no material review findings.
- [ ] Then attempt real ChatGPT-originated confirmation-free loop; if the platform blocks ordinary actions, report `BLOCKED_PLATFORM_AUTONOMY` rather than `CHATGPT_LOOP_READY`.