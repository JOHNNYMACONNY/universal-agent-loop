# Remote Game Browser MCP — Hermetic Review Checkpoint

Date: 2026-08-19
Scope: current `chatgpt/autonomous-dev-loop` branch before provider-backed `RUNTIME_COMPLETE` execution.

## Review basis

- Approved spec: `docs/superpowers/specs/2026-08-19-remote-game-browser-mcp-design.md`
- Implementation plan + normative amendment
- `skills/autonomous-dev-loop/SKILL.md`
- `skills/game-browser-testing/SKILL.md`
- `protocol/truth-model.md`
- `protocol/authority.md`
- Full branch diff against `main`
- Current official Vercel Sandbox / MCP API contracts
- Current `agent-browser` command surface

## Material findings found and repaired

1. Child runtime dependency graph lacked a committed lockfile. Repaired with `apps/game-browser-mcp/package-lock.json`; normal and live CI use `npm ci`.
2. Browser egress allowed trusted domains but lacked explicit private/reserved CIDR denial. Repaired with exact registered-domain allowlisting plus private/reserved IPv4/IPv6 deny ranges; browser-reported navigation is URL/DNS revalidated after start, observe, and reset.
3. Live acceptance expected a precomputed expiring bearer token. Repaired with a short-lived signed test principal minted inside the live CI run.
4. Runtime lifecycle gaps: idle touch/expiry, total-action budget, recovery reset, idempotent repeated end, and expiry cleanup. Repaired with durable/atomic session transitions and regression tests.
5. MCP screenshots were embedded as base64 inside JSON text. Repaired so bounded screenshots are returned as MCP `image` content and structured evidence contains only an explicit `UNTRUSTED_TARGET_CONTENT` image reference; oversized screenshots fail closed.
6. Production request size and numeric rate-limit configuration were not fully fail-closed. Repaired with a 64 KiB HTTP body gate and startup validation.

## Invariants after repair

- Root UAL remains zero-runtime-dependency.
- Runtime dependencies remain isolated to `apps/game-browser-mcp/`.
- Exactly six bounded gameplay MCP tools are exposed.
- No arbitrary shell, JS, Playwright/CDP/Puppeteer passthrough, unrestricted navigation, credential, GitHub mutation, deployment, merge, publication, billing, or production-mutation tool exists.
- Target registration remains server-owned, exact-commit/provider-verified, and short-lived.
- Browser evidence is untrusted implementation data, never intent or authority.
- Session/action state is remotely durable and ambiguous execution fails to recovery-required rather than replaying input.
- Runtime evidence becomes stale after implementation mutation.
- `RUNTIME_COMPLETE` still requires a fresh provider-backed cloud Sandbox acceptance artifact for the final candidate commit.
- `CHATGPT_LOOP_READY` remains a separate real-ChatGPT gate and is not implied by hermetic success.

## Current review result

No known material hermetic design/code finding remains at this checkpoint. This document is intentionally not a `RUNTIME_COMPLETE` claim. The commit containing this checkpoint must pass the full root/runtime test, strict typecheck, and build gates before provider provisioning/deployment begins.
