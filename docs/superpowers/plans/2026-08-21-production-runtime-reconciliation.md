# Production Runtime Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Vercel Production runtime for the private Autonomous Dev Loop GPT self-reconciling from canonical `main` using the existing repository `VERCEL_TOKEN` secret.

**Architecture:** Add one idempotent GitHub Actions Production reconciler that reads current Vercel Production env, preserves readable secrets, rebuilds the pinned browser snapshot only when its input fingerprint changes, reconciles the two Vercel projects, deploys exact `main` when needed, and runs provider-backed/browser-bridge acceptance. Existing preview bootstrap and runtime code remain the implementation source of truth.

**Tech Stack:** GitHub Actions, bash, jq, Vercel REST API/CLI 59.1.4, Node 24, existing TypeScript browser bootstrap/acceptance scripts.

**Spec:** `docs/superpowers/specs/2026-08-21-production-runtime-reconciliation-design.md`

## Global Constraints

- Existing `VERCEL_TOKEN` is the only required GitHub bootstrap secret.
- Never print, upload, or commit secret values.
- Never overwrite `UAL_ACTION_API_KEY`, `GITHUB_TOKEN`, `GITHUB_CONTROL_TOKEN`, or `GITHUB_CONTROL_OWNERS`.
- Production deployments must verify exact canonical `main` SHA and project identity.
- Secret/snapshot reuse is required to avoid rotation on each run.
- No billing mutation, undocumented production-branch API, release, or arbitrary browser authority.

---

### Task 1: Define the workflow contract with root tests

**Files:**
- Create: `tests/production-runtime-reconcile.test.mjs`
- Create later: `.github/workflows/production-runtime-reconcile.yml`

**Interfaces:**
- Consumes: repository workflow text.
- Produces: static safety assertions that guard triggers, managed keys, exact-SHA checks, secret non-logging, snapshot fingerprinting, and acceptance gates.

- [ ] **Step 1:** Write a failing Node test that reads `.github/workflows/production-runtime-reconcile.yml` and requires `push` on `main`, `schedule`, `workflow_dispatch`, shared concurrency, `decrypt=true`, `upsert=true`, the required browser/action key names, snapshot fingerprinting, `vercel@59.1.4 deploy --prod`, exact SHA/project/target checks, `test:remote`, the six browser operation IDs, and explicit protection of existing Action credentials.
- [ ] **Step 2:** Run `npm test`; expected result is failure because the workflow does not exist.
- [ ] **Step 3:** Commit the contract test.

### Task 2: Implement idempotent Production reconciliation

**Files:**
- Create: `.github/workflows/production-runtime-reconcile.yml`
- Modify: `.github/workflows/game-browser-mcp-bootstrap.yml` only to remove the stale unused `TARGET_BRANCH: chatgpt/autonomous-dev-loop` value.

**Interfaces:**
- Consumes: `secrets.VERCEL_TOKEN`, exact checked-out `main`, existing Vercel projects and runtime scripts.
- Produces: reconciled Production env, snapshot ID/fingerprint, exact Production deployments, non-secret evidence artifact.

- [ ] **Step 1:** Add workflow triggers for relevant `main` pushes, a daily cron, and manual dispatch; serialize all Production mutation with one concurrency group.
- [ ] **Step 2:** Fetch both projects' Production env with `decrypt=true`; implement helpers to retrieve the latest non-branch Production value and upsert only when values differ.
- [ ] **Step 3:** Preserve or generate the three browser runtime secrets and one shared bridge token; mask every readable/generated secret immediately.
- [ ] **Step 4:** Reconcile all fixed browser Production values and bridge-specific Action values without touching protected Action credentials.
- [ ] **Step 5:** Compute the snapshot fingerprint from pinned browser version plus worker/snapshot-builder contents. Reuse the current snapshot on a match; otherwise mint project OIDC, build the pinned snapshot, and persist ID/fingerprint.
- [ ] **Step 6:** Determine whether each project needs a Production deployment from config-change state, current Production SHA/state, and stable health. Deploy exact checkout with Vercel CLI only when needed and verify returned project/SHA/target/READY metadata.
- [ ] **Step 7:** Verify stable browser `/healthz` and Action `/health` + `/openapi.json`, including all six browser operation IDs.
- [ ] **Step 8:** Reuse existing registration/principal scripts to run `npm run test:remote` against the exact browser Production deployment.
- [ ] **Step 9:** Use the existing Production Action key read from Vercel to start, observe, and end a bridge session for the candidate SHA. Ensure cleanup runs on bridge assertion failure.
- [ ] **Step 10:** Write/upload a non-secret evidence JSON containing candidate SHA, deployment IDs, whether deploys were reused/created, snapshot fingerprint, health/OpenAPI status, provider acceptance status, and bridge smoke status.
- [ ] **Step 11:** Remove the stale preview-bootstrap `TARGET_BRANCH` constant so future operators cannot mistake it for the Production source.
- [ ] **Step 12:** Run `npm test`; expected result PASS.

### Task 3: Publish, verify, review, and merge

**Files:**
- No new implementation files beyond Tasks 1-2.

**Interfaces:**
- Consumes: exact PR head.
- Produces: merged reconciler on `main`, followed automatically by its first Production reconciliation.

- [ ] **Step 1:** Open a normal PR to `main` summarizing the self-healing Production behavior and explicit secret/authority boundaries.
- [ ] **Step 2:** Require fresh exact-head root CI and game-browser provider preflight to pass.
- [ ] **Step 3:** Freeze the PR head and perform separate Standards and Spec reviews. Any material finding creates a new commit and invalidates prior evidence.
- [ ] **Step 4:** Merge only the exact reviewed SHA after both reviews PASS.
- [ ] **Step 5:** Observe the automatic `main` reconciliation run; inspect jobs/logs without exposing secrets.
- [ ] **Step 6:** Verify Vercel browser Production `/healthz` is 200, Action `/health` and OpenAPI are 200, provider-backed gameplay acceptance passed, and bridge smoke succeeded.
- [ ] **Step 7:** If the first Production run discovers a real provider/platform failure, repair the narrow cause through a fresh PR and repeat the exact-head loop rather than weakening the gate.
