# Production Action Request Relay — Design

Date: 2026-08-21
Status: implementation companion to the approved GPT Action GitHub control-plane design

## Goal

Provide a credential-safe trigger that lets the connected ChatGPT implementation plane exercise the already-reviewed Production GPT Action even when the active ChatGPT harness cannot issue an authenticated arbitrary HTTP POST to that Action.

The relay is not a second repository mutation plane. It is a trusted GitHub Actions client of the existing Production Action and inherits the Action's repository-owner, `chatgpt/*` branch, path, file-size, and upstream-secrecy guards.

## Trigger and Caller Authentication

The workflow lives on the UAL default branch and listens only to GitHub `issues` events of type `opened`, `edited`, or `reopened`.

A run is eligible only when all of the following are true:

- the event sender is exactly `JOHNNYMACONNY`;
- the issue author is exactly `JOHNNYMACONNY`;
- the issue title is exactly `UAL Production Action Request`.

The public UAL issue body contains only bounded JSON metadata and an immutable pointer to a repair-plan file stored in the target repository. Exact source fragments are never copied into the public UAL issue. Running workflow code comes only from the trusted UAL default branch, so a feature branch cannot replace the secret-bearing workflow implementation.

## Credential Boundary

The workflow receives the existing UAL repository `VERCEL_TOKEN` secret and uses the Vercel API to resolve only the Production `UAL_ACTION_API_KEY` value for the known Action project.

Both values are masked immediately. The workflow does not read, export, accept, or print `GITHUB_CONTROL_TOKEN`, and request JSON contains no credential material.

The Production Action remains bearer-authenticated exactly as designed. The relay merely supplies that bearer server-side when invoking the existing bounded endpoints.

## Public Request Contract

Version 1 issue requests contain only:

- `requestVersion: 1`;
- `repository`: exact `JOHNNYMACONNY/<repo>` identifier;
- `pullRequest`: positive integer PR number;
- `branch`: existing `chatgpt/*` PR head branch;
- `expectedHead`: exact 40-hex current PR head SHA;
- `planRef`: exact 40-hex commit in that same target repository;
- `planPath`: a relative `.ual/action-requests/*.json` path;
- `planBlobSha`: exact 40-hex blob SHA for that immutable plan file.

The public request is capped at 4,096 bytes. It contains no old/new source fragments.

## Target-Repository Plan Contract

The plan file is stored in the target repository, so private-repository source fragments remain private. A typical caller prepares it on a separate `chatgpt/*` staging branch, then supplies the resulting exact commit and blob SHA in the public request pointer.

Version 1 plans contain:

- `planVersion: 1`;
- `operations`: one to four distinct file operations.

Each operation contains:

- a relative repository path with traversal rejected;
- a bounded commit message;
- one to eight exact text replacements.

Each replacement contains non-empty `old` text and `new` text different from `old`. The complete plan is capped at 60,000 bytes.

Preparing a plan file on an isolated staging branch is orchestration input, not certification evidence. The actual application branch still changes only through the Production Action.

## Execution Model

1. Validate the small public request pointer and bounds.
2. Resolve the Production Action bearer without exposing it.
3. Read the target PR through the Production Action and require it to be open, unmerged, on the requested `chatgpt/*` branch, and exactly at `expectedHead`.
4. Read the plan file from the same target repository through the Production Action at exact `planRef`; require its returned blob SHA to equal `planBlobSha`; then validate the complete plan schema and bounds.
5. Read every requested target file through the Production Action and preflight every exact replacement before any mutation. Every `old` fragment must occur exactly once.
6. Re-read the PR and require the head still to equal `expectedHead` after preflight.
7. Write the preflighted files through `PUT /github/file`, one at a time. Before each write, re-read the PR and require the current head to equal the prior accepted head. The returned Action commit becomes the only accepted head for the next operation.
8. Re-read the PR and require the final head to equal the final Action write commit.
9. Record a non-secret PASS comment containing only the target repository, PR number, and final exact head.

Relay runs are serialized with a single concurrency group and are never cancelled in progress. Duplicate operation paths are rejected so preflight blob SHAs cannot become internally stale during the same request.

## Security Properties

- No arbitrary workflow code comes from the issue request, repair plan, or target branch.
- Private source fragments remain inside the target repository rather than appearing in the public UAL issue.
- The repair-plan pointer is immutable: both the target-repository commit and plan blob SHA are exact.
- No shell `eval`, arbitrary GitHub REST proxy, direct `git push`, branch deletion, settings mutation, secret mutation, deployment mutation, release mutation, or billing operation is added.
- All target-repository plan reads, implementation reads, and implementation writes traverse the Production Action; the relay does not use a GitHub credential for target repository mutation.
- The Production Action's owner allowlist, exact repository identity check, default-branch write rejection, `chatgpt/*` enforcement, bounded content size, and upstream-body secrecy remain authoritative.
- Exact-head checks fail closed when the target PR moves before or during execution.
- A failed plan validation or replacement preflight performs no target implementation write.
- Any successful target write changes the exact PR head and therefore invalidates earlier verification/review evidence, as required by UAL.

## Non-goals

This workflow does not add a new Custom GPT Action endpoint, bypass Action authentication, dispatch arbitrary workflows, merge pull requests, create deployments, manage credentials, or make browser infrastructure less restrictive.

## Verification

Repository conformance tests assert the trusted trigger, actor/title gate, credential boundary, stable Production Action URL, public-request size cap, immutable plan pointer, private-fragment boundary, plan bounds, exact-head pinning, `chatgpt/*` guard, complete preflight-before-write ordering, duplicate-path rejection, serialized execution, and absence of direct `git push` or Git-ref mutation.

The normal UAL root suite, game-browser suite/typecheck/build, and provider preflight must remain green on the exact relay head before merge. The exact relay head also requires fresh independent Standards PASS and Spec PASS review.
