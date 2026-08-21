# GPT Action GitHub Control Plane — Design

Date: 2026-08-20
Status: approved continuation of the ChatGPT Autonomous Dev Loop workstream

## Goal

Extend the existing private `ual-gpt-action-api` from a canonical-skill loader into a narrowly scoped GitHub control plane that lets the saved Autonomous Dev Loop GPT inspect repositories, create isolated working branches, write files on those branches, observe CI/workflow runs, inspect pull requests, and create draft pull requests when publication authority exists.

The service must remain remote-only and usable while the user's local computer is powered off.

## Relationship to the Existing Design

This is the next implementation slice after `docs/superpowers/specs/2026-08-19-chatgpt-autonomous-dev-loop-design.md` and the completed Step 3A live-skill loader. It does not change canonical UAL lifecycle semantics. It supplies remote capabilities that the canonical `autonomous-dev-loop` skill can discover and use honestly.

## Security Model

The existing `UAL_ACTION_API_KEY` remains the sole caller authentication mechanism for the private GPT Action.

GitHub credentials are separated by responsibility:

- `GITHUB_TOKEN`: existing read-only credential used only to fetch canonical UAL skills from `JOHNNYMACONNY/universal-agent-loop`.
- `GITHUB_CONTROL_TOKEN`: new fine-grained GitHub credential used only by the repository control-plane operations.
- `GITHUB_CONTROL_OWNERS`: comma-separated exact owner/org allowlist. Every target repository must belong to one listed owner. Production will initially use `JOHNNYMACONNY`.

GitHub itself remains the final repository-scope authority of `GITHUB_CONTROL_TOKEN`; the owner allowlist is an additional server-side boundary.

The API must never return, log, or reflect either GitHub credential or the Action bearer.

## Deliberately Narrow Mutation Surface

The first writable control-plane slice exposes no merge, delete, release, production-deploy, repository-settings, secret-management, billing, destructive-data, or arbitrary GitHub REST proxy operation.

Writable operations are limited to:

1. create a new working branch whose name begins with `chatgpt/`;
2. create/update one UTF-8 repository file on a `chatgpt/` branch;
3. create a **draft** pull request from a `chatgpt/` branch.

The server rejects writes to the repository default branch even if the GitHub token itself could perform them. Draft PR creation remains a publication action and the canonical skill must call it only when the user has explicitly authorized PR creation. The server always forces `draft: true`; it exposes no ready-for-review or merge operation in this slice.

## Read Surface

The Action exposes bounded read operations needed for ORIENT, RECONCILE, VERIFY, and REVIEW:

- repository metadata/default branch/current permissions;
- a single file at an optional ref;
- a bounded recursive Git tree at a ref;
- a pull request by number;
- recent GitHub Actions workflow runs filtered by branch and/or head SHA.

Responses are reduced to fields useful to an agent and bounded to prevent oversized GPT Action responses. File reads and writes are limited to 512 KiB. Tree responses return at most 1,000 entries plus GitHub's own `truncated` state and a local `limitReached` flag.

## HTTP / OpenAPI Surface

Existing operations remain unchanged:

- `GET /health` → `getActionHealth`
- `GET /skills/{name}` → `getCanonicalSkill`

New bearer-authenticated operations:

- `GET /github/repository?repository=owner/repo` → `getRepositoryState`
- `GET /github/file?repository=owner/repo&path=...&ref=...` → `getRepositoryFile`
- `GET /github/tree?repository=owner/repo&ref=...` → `getRepositoryTree`
- `GET /github/pull-request?repository=owner/repo&number=N` → `getPullRequestState`
- `GET /github/workflow-runs?repository=owner/repo&branch=...&headSha=...` → `getWorkflowRuns`
- `POST /github/branch` → `createWorkingBranch`
- `PUT /github/file` → `writeRepositoryFile`
- `POST /github/draft-pull-request` → `createDraftPullRequest`

Routine implementation mutations are explicitly declared `x-openai-isConsequential: false` for `createWorkingBranch` and `writeRepositoryFile`. This lets the user grant an Always Allow choice once so an authorized implementation/repair loop does not acquire a per-write manual operator dependency. Server-side branch, repository, and path guards remain authoritative regardless of that UI permission.

Draft pull-request creation is explicitly `x-openai-isConsequential: true` because it crosses the publication boundary and must retain user confirmation/authority. No other publication mutation is exposed.

## Validation

Repository identifiers must match `owner/repo` using GitHub-compatible conservative characters and must pass `GITHUB_CONTROL_OWNERS`.

Refs are limited to conservative Git ref characters and reject traversal/ambiguous forms including `..`, `@{`, backslash, leading slash, trailing slash, and empty values.

Writable branch names must:

- begin with `chatgpt/`;
- pass the safe-ref validation;
- not equal the default branch.

Repository paths must be relative, non-empty, use `/`, reject NUL/backslash, reject `.`/`..` path segments, and stay below 1,024 characters.

Commit messages, PR titles, and PR bodies are length-bounded.

## GitHub Data Flow

### Repository state

`GET /repos/{owner}/{repo}` using `GITHUB_CONTROL_TOKEN`, then return only `full_name`, `private`, `default_branch`, `archived`, `disabled`, `visibility`, `permissions`, and `html_url`.

### File read

`GET /repos/{owner}/{repo}/contents/{encoded path}?ref={ref}`. Require a file response with base64 content. Decode UTF-8, enforce the 512 KiB maximum, and return repository/ref/path/blob SHA/content/source URL.

### Tree read

Resolve a requested ref through `GET /repos/{owner}/{repo}/git/trees/{ref}?recursive=1`. Encode each slash-delimited ref segment while preserving `/` separators so nested branch names such as `chatgpt/feature` remain valid GitHub path refs. Reduce entries to `path`, `type`, `mode`, `sha`, and optional `size`, and cap to 1,000 entries.

### Pull request read

`GET /repos/{owner}/{repo}/pulls/{number}`. Return bounded state, refs/SHAs, draft/merged status, mergeability fields, title/body, and URLs.

### Workflow runs

`GET /repos/{owner}/{repo}/actions/runs?per_page=20` with optional branch/head SHA filters. Return the latest 20 bounded run records with ID, workflow name, event, status, conclusion, head branch/SHA, URLs, timestamps, and run number.

### Create branch

Resolve repository state, then resolve `fromRef` (or the default branch) through `GET /repos/{owner}/{repo}/git/ref/heads/{ref}` using slash-preserving segment encoding for nested branch names. Create `refs/heads/chatgpt/...` with `POST /repos/{owner}/{repo}/git/refs`. Existing branch conflicts remain bounded 409/422 responses.

### Write file

Resolve repository state first and reject non-`chatgpt/` or default-branch writes. Call `PUT /repos/{owner}/{repo}/contents/{encoded path}` with UTF-8 content base64 encoded, commit message, branch, and optional current blob SHA. Return the commit SHA/URL and content SHA/path.

### Draft pull request

Resolve repository state; require `head` to be a `chatgpt/` branch; default `base` to repository default branch; reject same head/base. Call `POST /repos/{owner}/{repo}/pulls` with `draft: true`. Return PR number, state, draft status, head/base refs and SHAs, and URLs.

## Error Contract

No GitHub response body is reflected to the client.

- 400: invalid Action input
- 401: invalid Action bearer
- 403: target owner/repository is outside the configured control boundary or GitHub denies the operation
- 404: bounded repository/file/ref/PR not found
- 409: branch/file conflict where GitHub reports conflict
- 413: request/file exceeds local size limits
- 422: bounded GitHub validation conflict
- 502: GitHub upstream/network/invalid response
- 503: required server configuration is missing

Every error body contains a stable internal error code and, when useful, the upstream numeric status only.

## Request Handling

`apps/gpt-action-api/api/index.mjs` must pass URL search parameters and parsed JSON request bodies into `handleActionRequest`. The core module remains dependency-free and testable with injected `fetchImpl` and environment objects.

## Testing Strategy

Use TDD in observable GitHub CI:

1. Add a new `tests/gpt-action-github-control-plane.test.mjs` suite before implementation.
2. Push the test-only commit and observe root CI fail on the missing operations while unrelated game-browser checks remain unchanged.
3. Implement the minimal control plane and request-body/search-param plumbing.
4. Require fresh root CI PASS.
5. Review the full branch patch for authority bypasses, default-branch writes, credential leakage, unbounded responses, arbitrary proxy behavior, OpenAPI importability, nested-ref handling, and any Action confirmation semantics that would reintroduce a manual dependency into routine implementation.

Unit tests use mocked GitHub responses and must cover success paths plus: missing control token, owner rejection before GitHub access, traversal/path/ref rejection, default-branch write rejection, non-`chatgpt/` write rejection, oversize content, upstream-body secrecy, nested slash-separated refs, autonomous implementation permission flags, and draft PR forced/consequential true.

## Acceptance Criteria

1. Step 3A skill loading remains backward compatible.
2. OpenAPI remains importable by Custom GPT Actions and exposes all named operations.
3. Every control-plane operation requires the existing Action bearer.
4. Repository owner allowlisting is enforced before GitHub access.
5. Read operations provide enough bounded evidence to inspect repository state, files/tree, PR state, and workflow runs.
6. Branch creation and file writes can only target `chatgpt/` branches and never the default branch.
7. Routine branch creation and file writes are non-consequential Action operations so the user can Always Allow them for an autonomous implementation session; draft PR creation remains consequential and always uses `draft: true`.
8. Draft PR creation is the only PR mutation.
9. No merge/delete/workflow-dispatch/secret/settings/arbitrary-proxy endpoint exists.
10. GitHub credentials and upstream response bodies are never leaked.
11. Root `npm test` passes after implementation.
12. Existing game-browser tests/typecheck/build remain green.
13. A Vercel Preview generated from the branch serves the updated importable schema.
14. Production is not changed without separate explicit merge/deploy authority.

## Credential Activation Boundary

The code can be fully implemented and Preview-verified with mocked tests before `GITHUB_CONTROL_TOKEN` exists in Production. Live write verification requires a one-time fine-grained GitHub credential with the minimum permissions required by the enabled operations and repository access selected by the user. That credential must be stored only in Vercel, never pasted into chat or committed to GitHub.
