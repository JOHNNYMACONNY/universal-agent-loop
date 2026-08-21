# GPT Action GitHub Control Plane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the private GPT Action with a bounded GitHub repository control plane for autonomous branch-based implementation, CI observation, and draft PR creation.

**Architecture:** Keep `apps/gpt-action-api/src/app.mjs` dependency-free and split canonical-skill auth from a new `GITHUB_CONTROL_TOKEN` capability. Add exact-owner allowlisting, safe ref/path validation, bounded GitHub adapters, and a small OpenAPI surface; mutation endpoints are limited to `chatgpt/` branches and draft PRs.

**Tech Stack:** Node.js >=18, Node test runner, Vercel Node function, GitHub REST API 2022-11-28, OpenAPI 3.1.

**Spec:** `docs/superpowers/specs/2026-08-20-gpt-action-github-control-plane-design.md`

## Global Constraints

- `UAL_ACTION_API_KEY` remains the sole GPT Action caller credential.
- `GITHUB_TOKEN` remains dedicated to canonical UAL skill reads.
- New repository operations use `GITHUB_CONTROL_TOKEN` plus `GITHUB_CONTROL_OWNERS`.
- No merge, delete, release, production-deploy, secret/settings, billing, workflow-dispatch, or arbitrary REST proxy endpoint.
- Writes are restricted to safe `chatgpt/` branches and never the repository default branch.
- Draft pull requests are the only PR mutation and the server always sends `draft: true`.
- File read/write payloads are limited to 512 KiB; recursive tree responses are limited to 1,000 entries.
- GitHub credentials and upstream response bodies must never be returned to callers.
- Production remains unchanged without separate merge/deploy authority.

---

### Task 1: Lock the control-plane contract with failing tests

**Files:**
- Create: `tests/gpt-action-github-control-plane.test.mjs`
- Modify: `tests/gpt-action-api.test.mjs`

**Interfaces:**
- Consumes: existing `handleActionRequest(request, { env, fetchImpl })`.
- Produces: executable behavioral contract for query/body routing, read operations, mutation guards, and OpenAPI operation IDs.

- [ ] **Step 1: Write failing OpenAPI/read tests**

Add tests asserting the schema exposes `getRepositoryState`, `getRepositoryFile`, `getRepositoryTree`, `getPullRequestState`, and `getWorkflowRuns`, all with bearer auth. Add mocked GitHub tests for repository state, base64 file reads, bounded tree output, PR projection, and workflow-run projection.

Example assertion:

```js
assert.equal(response.body.paths['/github/repository'].get.operationId, 'getRepositoryState');
assert.deepEqual(response.body.paths['/github/repository'].get.security, [{ bearerAuth: [] }]);
```

- [ ] **Step 2: Write failing validation/security tests**

Cover missing `GITHUB_CONTROL_TOKEN`, missing/invalid `GITHUB_CONTROL_OWNERS`, owner rejection before any GitHub fetch, invalid repository/ref/path forms, 512 KiB read limit, and upstream-body secrecy.

- [ ] **Step 3: Write failing mutation tests**

Cover `POST /github/branch`, `PUT /github/file`, and `POST /github/draft-pull-request`; assert default-branch and non-`chatgpt/` writes fail before mutation, file content is base64 encoded, and PR payload always contains `draft: true`.

Example:

```js
assert.equal(captured.options.method, 'POST');
assert.equal(JSON.parse(captured.options.body).draft, true);
```

- [ ] **Step 4: Update the legacy method test**

Replace the global “non-GET methods are rejected” assumption with route-specific method checks so newly authorized POST/PUT endpoints can exist while unsupported methods still return 405.

- [ ] **Step 5: Push the test-only commit and verify RED in GitHub Actions**

Expected: root `npm test` fails because the new routes/body/search-param behavior does not exist; existing game-browser test/typecheck/build remains green.

- [ ] **Step 6: Commit**

Commit message: `test: define GPT Action GitHub control plane`

---

### Task 2: Add request plumbing and bounded GitHub read operations

**Files:**
- Modify: `apps/gpt-action-api/api/index.mjs`
- Modify: `apps/gpt-action-api/src/app.mjs`
- Test: `tests/gpt-action-github-control-plane.test.mjs`

**Interfaces:**
- `handleActionRequest` additionally consumes `request.searchParams` and `request.body`.
- Internal helpers: `controlConfig(env)`, `validateRepository(value, owners)`, `validateRef(value)`, `validatePath(value)`, `githubControlFetch(...)`.

- [ ] **Step 1: Pass search params and JSON body from Vercel handler**

Use `Object.fromEntries(url.searchParams.entries())` for query input and pass `req.body` unchanged into the core handler.

- [ ] **Step 2: Add control-plane configuration and validators**

`GITHUB_CONTROL_TOKEN` is required only for `/github/*`. Parse `GITHUB_CONTROL_OWNERS` as trimmed comma-separated exact names. Reject invalid owner/repo, refs containing `..`, `@{`, backslash, leading/trailing slash, and paths with NUL/backslash/dot segments or length >1024.

- [ ] **Step 3: Add bounded GitHub request helper**

Send only `accept`, bearer authorization, `user-agent`, and `x-github-api-version`; never reflect upstream bodies. Map network failures to 502 and upstream status to bounded local responses.

- [ ] **Step 4: Implement repository/file/tree reads**

Repository returns only approved metadata. File reads require `type=file`, `encoding=base64`, enforce 512 KiB after decode, and return UTF-8 content/blob SHA/source URL. Tree reads call `git/trees/{ref}?recursive=1`, reduce fields, slice to 1,000 entries, and return `limitReached`.

- [ ] **Step 5: Implement PR/workflow-run reads**

PR responses contain bounded state/ref/SHA/title/body/URL fields. Workflow runs request `per_page=20` with optional branch/head SHA filters and return at most 20 bounded records.

- [ ] **Step 6: Run root tests and verify the read/validation tests turn GREEN while mutation tests remain RED**

- [ ] **Step 7: Commit**

Commit message: `feat: add GPT Action GitHub read control plane`

---

### Task 3: Add branch/file/draft-PR mutation operations

**Files:**
- Modify: `apps/gpt-action-api/src/app.mjs`
- Test: `tests/gpt-action-github-control-plane.test.mjs`

**Interfaces:**
- `createWorkingBranch({ repository, branch, fromRef })`
- `writeRepositoryFile({ repository, path, branch, message, content, sha })`
- `createDraftPullRequest({ repository, head, base, title, body })`

- [ ] **Step 1: Implement JSON body normalization and size checks**

Accept an already-parsed object or JSON string/Buffer, reject arrays/non-object JSON, and bound text fields. Return 400 for malformed input and 413 for oversized file content.

- [ ] **Step 2: Implement branch creation**

Resolve repository metadata, require a valid `chatgpt/` branch not equal to default, resolve `fromRef || default_branch` through `git/ref/heads/{ref}`, then `POST git/refs` with `refs/heads/<branch>` and the source SHA.

- [ ] **Step 3: Implement file create/update**

Resolve repository metadata first, reject default/non-`chatgpt/` branch, validate path/message/content, then `PUT contents/{path}` with base64 content, commit message, branch, and optional existing blob SHA. Return only commit/content identifiers and URLs.

- [ ] **Step 4: Implement forced-draft PR creation**

Resolve repository metadata; require safe `chatgpt/` head; use explicit safe base or default branch; reject same head/base; `POST pulls` with `{title, body, head, base, draft:true}` regardless of caller input.

- [ ] **Step 5: Verify all mutation/security tests GREEN**

- [ ] **Step 6: Run full `npm test` through GitHub Actions**

Expected: root job PASS; game-browser-mcp tests/typecheck/build unchanged PASS.

- [ ] **Step 7: Commit**

Commit message: `feat: add guarded GPT Action GitHub writes`

---

### Task 4: Finalize OpenAPI, Preview evidence, and independent review

**Files:**
- Modify: `apps/gpt-action-api/src/app.mjs`
- Modify: `README.md` only if necessary to document the new credential boundary.
- Test: `tests/gpt-action-api.test.mjs`
- Test: `tests/gpt-action-github-control-plane.test.mjs`

**Interfaces:**
- OpenAPI operation IDs exactly match the spec.
- POST/PUT mutation operations include `x-openai-isConsequential: true`.

- [ ] **Step 1: Complete OpenAPI schemas**

Use named object schemas under `components.schemas`; avoid unsupported free-form proxy request shapes. Keep existing `SkillResponse` intact.

- [ ] **Step 2: Assert no prohibited endpoint exists**

Tests must verify the schema has no merge/delete/release/deploy/secret/settings/workflow-dispatch/arbitrary-proxy operation.

- [ ] **Step 3: Push final branch head and require fresh GitHub CI PASS**

Capture exact branch SHA and workflow run IDs.

- [ ] **Step 4: Inspect Vercel Preview for the exact branch head**

Require READY Preview and `/openapi.json` HTTP 200. Verify the server URL is the exact Preview host and all expected operation IDs import structurally.

- [ ] **Step 5: Run a fresh security/architecture review**

Review the complete diff for default-branch mutation bypass, owner allowlist bypass, branch/ref/path parser edge cases, credential leakage, unbounded response size, arbitrary GitHub proxy escape, and accidental publication/merge capability.

- [ ] **Step 6: Repair any material finding, then repeat fresh CI + Preview verification + review**

- [ ] **Step 7: Stop at the publication boundary**

Do not merge or Production-deploy Step 3B without separate explicit authority. Report the exact remaining one-time credential setup needed for `GITHUB_CONTROL_TOKEN` and the Custom GPT schema refresh.
