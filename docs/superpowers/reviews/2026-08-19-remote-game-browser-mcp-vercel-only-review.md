# Remote Game Browser MCP — Vercel-Only Review

Date: 2026-08-19
Reviewed implementation: `2bace28362eb269e470d03db6ee50d672ae5e399`
Scope: Vercel-only refactor and recovery repairs before provider-backed `RUNTIME_COMPLETE` acceptance.

## Review basis

- Approved remote browser design and Vercel-only normative amendment.
- `skills/autonomous-dev-loop/SKILL.md` and `skills/game-browser-testing/SKILL.md`.
- UAL truth/authority requirements.
- Full runtime tests, strict TypeScript check, build, and root UAL test lane on the reviewed implementation.
- Current Vercel persistent Sandbox contracts for named `Sandbox.create`, `Sandbox.get({ name, resume: false })`, filesystem persistence, and `sandbox.delete()`.
- Diff from the previous hermetic-green Vercel-only candidate `6460d26e2e56b809cdccf8fb7e2e852a23b36c77`.

## Review findings and repairs

1. **Orphaned persistent lock could wedge a session indefinitely.** A worker killed while owning the lock left the directory in the persistent filesystem. Repaired with explicit lock ownership (token, PID, boot ID, process start identity), safe orphan detection/reclamation, owner-only release, and a regression test that proves a stale lock is reclaimed rather than hanging.
2. **Retry of an already-`ENDING` session could skip remote cleanup.** A coordinator crash after the durable lifecycle write but before browser teardown could make a retry falsely return success. Repaired so authenticated retries re-attempt held-input release and browser teardown; already-missing/expired sessions remain idempotently ended while ownership mismatches still fail closed.
3. **Worker cleanup failure could skip sandbox stop/delete.** `browser.end()` previously wrapped worker cleanup, stop, and delete in one `try`. Repaired so worker cleanup is best-effort and cannot prevent subsequent stop/delete attempts. Regression coverage injects a worker cleanup failure and proves stop/delete still execute.
4. **New lock helper was not initially part of the pinned browser snapshot.** Repaired by copying both `worker.mjs` and `persistent-lock.mjs` into every generated snapshot.

## Fresh verification on reviewed implementation

GitHub Actions run `32322501442` for implementation `2bace28362eb269e470d03db6ee50d672ae5e399`:

- root UAL test job: PASS;
- runtime tests: 92 total, 91 PASS, 0 FAIL, 1 provider-backed test intentionally skipped because live provider configuration is not part of the hermetic lane;
- strict TypeScript typecheck: PASS;
- runtime build: PASS.

The new recovery regressions all pass, including orphaned-lock reclamation, `ENDING` retry cleanup, and stop/delete after worker failure.

## Invariants after review

- Production is Vercel-only; no Redis/Upstash dependency or runtime credential remains.
- Coordinator correctness does not depend on warm process memory.
- Named persistent Sandbox filesystem is authoritative only for durable ledger state; it is never treated as proof that Chromium survived.
- Browser loss/stopped VM fails closed rather than auto-resuming browser continuity.
- Concurrent session mutations serialize through one sandbox-local mutation boundary.
- Completed duplicate batches do not replay gameplay input.
- Registration capabilities are short-lived, signed, exact-deployment-bound, and tamper/expiry checked.
- Target/redirect/SSRF/DNS controls remain fail-closed and sandbox egress remains deny-by-default.
- Browser evidence remains `UNTRUSTED_TARGET_CONTENT`, never intent or authority.
- Exactly six bounded gameplay MCP tools remain exposed; no arbitrary shell/JavaScript/CDP/Playwright/Puppeteer escape surface is exposed.
- Runtime evidence cannot grant GitHub, PR, merge, deployment, publication, credential, billing, or production authority.

## Review result

**APPROVED for provider-backed acceptance.**

No known material hermetic code/design finding remains. This is deliberately **not** a `RUNTIME_COMPLETE` claim. `RUNTIME_COMPLETE` still requires fresh exact-commit provider-backed Vercel deployment + real cloud Sandbox/Canvas gameplay evidence for the final candidate commit after this review document is committed and the final CI lane is green.
