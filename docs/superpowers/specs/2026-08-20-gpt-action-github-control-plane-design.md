# GPT Action GitHub Control Plane — Design

Date: 2026-08-20
Status: approved continuation of the ChatGPT Autonomous Dev Loop workstream

## Goal

Extend the existing private `ual-gpt-action-api` from a canonical-skill loader into a narrowly scoped GitHub control plane that lets the saved Autonomous Dev Loop GPT inspect repositories, create isolated working branches, write files on those branches, observe CI/workflow runs, create/reuse pull requests, run the canonical review/repair loop, and merge the exact reviewed pull-request head after review PASS.

The service must remain remote-only and usable while the user's local computer is powered off.

## Relationship to the Existing Design

This is the next implementation slice after `docs/superpowers/specs/2026-08-19-chatgpt-autonomous-dev-loop-design.md` and the completed Step 3A live-skill loader. It does not replace canonical UAL verification semantics. It augments the ChatGPT loop with the repository capabilities required to carry implementation through reviewed merge.

The canonical review gate is based on Matt Pocock's `code-review` model: the exact current PR head is reviewed independently on **Standards** and **Spec**. A material finding on either axis routes to REPAIR, followed by fresh VERIFY and fresh REVIEW. Only a fresh Standards PASS + Spec PASS on the exact current PR head is merge-eligible.

## Security Model

The existing `UAL_ACTION_API_KEY` remains the sole caller authentication mechanism for the private GPT Action.

GitHub credentials are separated by responsibility:

- `GITHUB_TOKEN`: existing read-only credential used only to fetch canonical UAL skills from `JOHNNYMACONNY/universal-agent-loop`.
- `GITHUB_CONTROL_TOKEN`: fine-grained GitHub credential used only by the repository control-plane operations.
- `GITHUB_CONTROL_OWNERS`: comma-separated exact owner/org allowlist. Every target repository must belong to one listed owner.

GitHub remains the final repository-scope authority of `GITHUB_CONTROL_TOKEN`; the owner allowlist is an additional server-side boundary. Automatic GitHub redirects are refused, and repository metadata must resolve to the exact requested repository identity after allowlist validation.

The API must never return, log, or reflect either GitHub credential or the Action bearer.

## Deliberately Narrow Mutation Surface

The control plane exposes no delete, release, production-deploy, repository/organization-settings, secret-management, billing, destructive-data, workflow-dispatch, or arbitrary GitHub REST proxy operation.

Canonical autonomous mutations are limited to:

1. create a new working branch whose name begins with `chatgpt/`;
2. create/update one UTF-8 repository file on a `chatgpt/` branch;
3. create a normal pull request from a `chatgpt/` branch to the repository default branch;
4. merge that PR only when the caller supplies the exact head SHA that passed the current review gate.

A backward-compatible draft-PR endpoint remains available for older clients. It always forces `draft: true` and is not the canonical autonomous path.

The server rejects direct writes to the repository default branch. The merge endpoint does not accept arbitrary refs: it fetches the PR and refuses draft, closed, already-merged, non-`chatgpt/`-head, non-default-base, or stale-reviewed-head PRs. The GitHub merge request is pinned with the reviewed head SHA, so a head movement fails closed. GitHub branch protection, required checks, and merge queues remain authoritative.

## Read Surface

The Action exposes bounded read operations needed for ORIENT, RECONCILE, VERIFY, and REVIEW:

- repository metadata/default branch/current permissions;
- a single file at an optional ref;
- a bounded recursive Git tree at a ref;
- a pull request by number;
- recent GitHub Actions workflow runs filtered by branch and/or head SHA.

Responses are reduced to fields useful to an agent and bounded to prevent oversized GPT Action responses. File reads and writes are limited to 512 KiB. Tree responses return at most 1,000 entries plus GitHub's own `truncated` state and a local `limitReached` flag.

## HTTP / OpenAPI Surface

Existing operations remain:

- `GET /health` → `getActionHealth`
- `GET /skills/{name}` → `getCanonicalSkill`

Bearer-authenticated repository operations:

- `GET /github/repository?repository=owner/repo` → `getRepositoryState`
- `GET /github/file?repository=owner/repo&path=...&ref=...` → `getRepositoryFile`
- `GET /github/tree?repository=owner/repo&ref=...` → `getRepositoryTree`
- `GET /github/pull-request?repository=owner/repo&number=N` → `getPullRequestState`
- `GET /github/workflow-runs?repository=owner/repo&branch=...&headSha=...` → `getWorkflowRuns`
- `POST /github/branch` → `createWorkingBranch`
- `PUT /github/file` → `writeRepositoryFile`
- `POST /github/pull-request` → `createPullRequest`
- `POST /github/merge-pull-request` → `mergePullRequest`
- `POST /github/draft-pull-request` → `createDraftPullRequest` (legacy compatibility)

Routine autonomous loop operations are declared `x-openai-isConsequential: false` for branch creation, file writes, normal PR creation, and exact-reviewed-head merge. This allows an Always Allow choice so the implementation → review → repair → merge loop does not gain a per-call manual operator dependency. Server-side repository, branch, path, PR-state, and reviewed-head guards remain authoritative regardless of that UI permission.

The legacy draft-PR endpoint remains `x-openai-isConsequential: true` for backward compatibility. The canonical loop does not depend on it.

## Validation

Repository identifiers must match `owner/repo` using GitHub-compatible conservative characters and must pass `GITHUB_CONTROL_OWNERS`.

Refs are limited to conservative Git ref characters and reject traversal/ambiguous forms including `..`, `@{`, backslash, leading slash, trailing slash, repeated slash, and empty values.

Writable branch names must:

- begin with `chatgpt/`;
- pass safe-ref validation;
- not equal the default branch.

Repository paths must be relative, non-empty, use `/`, reject NUL/backslash, reject `.`/`..` path segments, and stay below 1,024 characters.

Commit messages, PR titles, and PR bodies are length-bounded. Reviewed commit SHAs are restricted to hexadecimal Git object identifiers.

## GitHub Data Flow

### Repository state

`GET /repos/{owner}/{repo}` using `GITHUB_CONTROL_TOKEN`, with redirects disabled. Require returned `full_name` to equal the validated requested repository identity. Return only bounded repository state.

### File read

`GET /repos/{owner}/{repo}/contents/{encoded path}?ref={ref}`. Require a file response with base64 content. Decode UTF-8, enforce the 512 KiB maximum, and return repository/ref/path/blob SHA/content/source URL.

### Tree read

Resolve a requested ref through `GET /repos/{owner}/{repo}/git/trees/{ref}?recursive=1`. Encode each slash-delimited ref segment while preserving `/` separators so nested branch names such as `chatgpt/feature` remain valid GitHub path refs. Reduce entries to `path`, `type`, `mode`, `sha`, and optional `size`, and cap to 1,000 entries.

### Pull request read

`GET /repos/{owner}/{repo}/pulls/{number}`. Return bounded state, refs/SHAs, draft/merged status, mergeability fields, title/body, and URLs.

### Workflow runs

`GET /repos/{owner}/{repo}/actions/runs?per_page=20` with optional branch/head-SHA filters. Return the latest 20 bounded run records with ID, workflow name, event, status, conclusion, head branch/SHA, URLs, timestamps, and run number.

### Create branch

Resolve repository state, then resolve `fromRef` (or default branch) through `GET /repos/{owner}/{repo}/git/ref/heads/{ref}` using slash-preserving segment encoding. Create `refs/heads/chatgpt/...` with `POST /repos/{owner}/{repo}/git/refs`.

### Write file

Resolve repository state first and reject non-`chatgpt/` or default-branch writes. Call `PUT /repos/{owner}/{repo}/contents/{encoded path}` with UTF-8 content base64 encoded, commit message, branch, and optional current blob SHA.

### Create pull request

Resolve repository state; require `head` to be a `chatgpt/` branch; require/default `base` to the repository default branch; reject same head/base. Call `POST /repos/{owner}/{repo}/pulls` with `draft: false`. Keep the PR open through any repair/re-review iterations.

### Legacy draft pull request

Same bounded head/base rules, but always call GitHub with `draft: true`. This endpoint exists only for backward compatibility.

### Merge reviewed pull request

Require PR number and `reviewedHeadSha`. Resolve repository state, fetch the current PR, and reject unless:

- state is open;
- draft is false;
- merged is false;
- head ref begins with `chatgpt/`;
- base ref equals repository default branch;
- current PR head SHA exactly equals `reviewedHeadSha`.

Choose an enabled repository merge method, preferring squash, then merge commit, then rebase. Call `PUT /repos/{owner}/{repo}/pulls/{number}/merge` with both `sha: reviewedHeadSha` and the selected merge method. Treat branch-protection/check conflicts as bounded merge blockers; never bypass them.

## Error Contract

No GitHub response body is reflected to the client.

- 400: invalid Action input
- 401: invalid Action bearer
- 403: target owner/repository outside configured boundary or GitHub permission denied
- 404: bounded repository/file/ref/PR not found
- 409: branch/file/merge conflict, stale reviewed head, or PR not merge-ready
- 413: request/file exceeds local size limits
- 422: bounded GitHub validation conflict
- 502: GitHub upstream/network/invalid response
- 503: required server configuration missing

Every error body contains a stable internal error code and, when useful, the upstream numeric status only.

## Autonomous Review / Merge Lifecycle

For repository-changing work:

1. IMPLEMENT on a `chatgpt/` branch.
2. VERIFY the exact branch/PR head with current CI/runtime evidence.
3. Create or reuse the PR to the default branch.
4. Run fresh canonical `code-review` against the PR base merge-base with two independent axes: Standards and Spec.
5. If either axis has a material finding: REPAIR on the same PR branch → fresh VERIFY → fresh REVIEW.
6. Any new commit/head movement makes prior verification/review stale.
7. When both Standards PASS and Spec PASS on the exact current head, merge autonomously using that reviewed head SHA.
8. Observe the PR as merged before declaring PASS.

## Testing Strategy

Use TDD in observable GitHub CI. Tests must cover success paths plus missing control token, owner rejection before GitHub access, traversal/path/ref rejection, default-branch write rejection, non-`chatgpt/` write rejection, oversize content, upstream-body secrecy, nested slash-separated refs, repository-redirect identity defense, autonomous Action permission flags, normal PR creation, legacy draft compatibility, exact-reviewed-head merge, stale-review rejection, and merge readiness guards.

## Acceptance Criteria

1. Step 3A skill loading remains backward compatible.
2. OpenAPI remains importable by Custom GPT Actions and exposes all named operations.
3. Every control-plane operation requires the existing Action bearer.
4. Repository owner allowlisting and exact repository identity are enforced before mutation.
5. Read operations provide bounded repository/file/tree/PR/workflow evidence.
6. Branch creation and file writes can target only `chatgpt/` branches and never the default branch.
7. Normal PR creation can target only the repository default branch from a guarded `chatgpt/` head.
8. Canonical merge requires the exact reviewed PR head SHA and refuses draft/closed/stale/non-`chatgpt/`/wrong-base PRs.
9. Normal PR creation and reviewed merge are non-consequential Action operations so the autonomous loop does not require per-call operator confirmation.
10. Legacy draft PR creation remains available, always forces `draft: true`, and remains consequential for compatibility.
11. No delete/workflow-dispatch/release/production-deploy/secret/settings/arbitrary-proxy endpoint exists.
12. GitHub credentials and upstream response bodies are never leaked.
13. Root `npm test` passes after implementation.
14. Existing game-browser tests/typecheck/build and provider preflight remain green.
15. A Vercel Preview generated from the exact branch head serves the updated importable schema.
16. The exact current PR head receives a fresh Standards PASS + Spec PASS before merge.
17. PR merge occurs autonomously after that review PASS, while Production deployment remains separately gated.

## Credential Activation Boundary

The code can be fully implemented and Preview-verified with mocked tests before `GITHUB_CONTROL_TOKEN` has expanded live permissions. Live normal-PR creation and merge require a one-time fine-grained GitHub credential with the minimum repository permissions required by these bounded operations. That credential must be stored only in Vercel, never pasted into chat or committed to GitHub. Credential creation or permission changes remain a separate high-impact action and are not implied by autonomous PR/merge authority.
