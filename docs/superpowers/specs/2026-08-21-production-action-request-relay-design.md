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

The issue body is raw JSON request data. It is never evaluated as shell or executable code. Running workflow code comes only from the trusted UAL default branch, so a feature branch cannot replace the secret-bearing workflow implementation.

## Credential Boundary

The workflow receives the existing UAL repository `VERCEL_TOKEN` secret and uses the Vercel API to resolve only the Production `UAL_ACTION_API_KEY` value for the known Action project.

Both values are masked immediately. The workflow does not read, export, accept, or print `GITHUB_CONTROL_TOKEN`, and request JSON contains no credential material.

The Production Action remains bearer-authenticated exactly as designed. The relay merely supplies that bearer server-side when invoking the existing bounded endpoints.

## Request Contract

Version 1 requests contain:

- `requestVersion: 1`;
- `repository`: exact `JOHNNYMACONNY/<repo>` identifier;
- `pullRequest`: positive integer PR number;
- `branch`: existing `chatgpt/*` PR head branch;
- `expectedHead`: exact 40-hex current PR head SHA;
- `operations`: one to four distinct file operations.

Each operation contains:

- a relative repository path with traversal rejected;
- a bounded commit message;
- one to eight exact text replacements.

Each replacement contains non-empty `old` text and `new` text different from `old`. The total issue body is capped at 60,000 bytes.

## Execution Model

1. Validate the complete request schema and bounds.
2. Resolve the Production Action bearer without exposing it.
3. Read the target PR through the Production Action and require it to be open, unmerged, on the requested `chatgpt/*` branch, and exactly at `expectedHead`.
4. Read every requested file through the Production Action and preflight every exact replacement before any mutation. Every `old` fragment must occur exactly once.
5. Re-read the PR and require the head still to equal `expectedHead` after preflight.
6. Write the preflighted files through `PUT /github/file`, one at a time. Before each write, re-read the PR and require the current head to equal the prior accepted head. The returned Action commit becomes the only accepted head for the next operation.
7. Re-read the PR and require the final head to equal the final Action write commit.
8. Record a non-secret PASS comment containing only the target repository, PR number, and final exact head.

Relay runs are serialized with a single concurrency group and are never cancelled in progress. Duplicate operation paths are rejected so preflight blob SHAs cannot become internally stale during the same request.

## Security Properties

- No arbitrary workflow code comes from the request or target branch.
- No shell `eval`, arbitrary GitHub REST proxy, direct `git push`, branch deletion, settings mutation, secret mutation, deployment mutation, release mutation, or billing operation is added.
- All repository reads/writes still traverse the Production Action; the relay does not use a GitHub credential for target repository mutation.
- The Production Action's owner allowlist, exact repository identity check, default-branch write rejection, `chatgpt/*` enforcement, bounded content size, and upstream-body secrecy remain authoritative.
- Exact-head checks fail closed when the target PR moves before or during execution.
- A failed preflight performs no target write.
- Any successful target write changes the exact PR head and therefore invalidates earlier verification/review evidence, as required by UAL.

## Non-goals

This workflow does not add a new Custom GPT Action endpoint, bypass Action authentication, dispatch arbitrary workflows, merge pull requests, create deployments, manage credentials, or make browser infrastructure less restrictive.

## Verification

Repository conformance tests assert the trusted trigger, actor/title gate, credential boundary, stable Production Action URL, request bounds, exact-head pinning, `chatgpt/*` guard, complete preflight-before-write ordering, duplicate-path rejection, serialized execution, and absence of direct `git push` or Git-ref mutation.

The normal UAL root suite, game-browser suite/typecheck/build, and provider preflight must remain green on the exact relay head before merge. The exact relay head also requires fresh independent Standards PASS and Spec PASS review.
