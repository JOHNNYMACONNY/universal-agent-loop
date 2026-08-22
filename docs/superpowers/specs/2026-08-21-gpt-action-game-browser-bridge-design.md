# GPT Action Game-Browser Bridge — Design

Date: 2026-08-21
Status: implementation design for private Autonomous Dev Loop GPT integration

## Goal

Let the saved Autonomous Dev Loop Custom GPT invoke the existing bounded remote game-browser runtime while keeping GitHub implementation control and browser QA in one GPT Action integration.

This slice exists because current ChatGPT GPT configuration allows a GPT to use apps or actions, but not both at the same time. The saved GPT already depends on Actions for bounded GitHub mutation, so the existing remote MCP browser backend cannot simply be attached as a second app without displacing the GitHub control plane.

The bridge must preserve the current browser-runtime trust, provenance, session, input, and authority boundaries. It must not become a generic browser proxy.

## Scope

This first bridge targets the browser runtime's existing single server-owned Vercel target project/repository configuration. It is sufficient to prove the saved GPT can perform remote gameplay calls with the local computer off against the configured project.

General multi-project target trust, arbitrary repository onboarding, deployment creation, production deployment, Plugin/App directory publication, and cross-user app identity are explicitly out of scope for this slice.

## Architecture

```text
saved Autonomous Dev Loop Custom GPT
  -> ual-gpt-action-api (existing Action bearer)
     -> fixed /game-browser/* Action operations
     -> server-side GAME_BROWSER_BRIDGE_TOKEN
        -> ual-game-browser-mcp /internal/gpt-action/*
           -> bridge authentication
           -> stable private-bridge principal binding
           -> server-owned target project/repository trust
           -> exact READY Vercel deployment discovery for requested commit
           -> existing RegistrationService / provenance verification
           -> existing createGameToolServices surface
           -> Vercel Sandbox + browser worker
```

The GPT never receives the bridge token, Vercel token, owner-binding secret, registration-control token, or any provider credential.

## Custom GPT Action Surface

Add bearer-authenticated operations to `ual-gpt-action-api`:

- `POST /game-browser/session-start` → `startGameQaSession`
- `POST /game-browser/observe` → `observeGameQaSession`
- `POST /game-browser/input` → `sendGameQaInput`
- `POST /game-browser/read-state` → `readGameQaState`
- `POST /game-browser/reset` → `resetGameQaSession`
- `POST /game-browser/session-end` → `endGameQaSession`

All remain bounded game-QA operations and are declared `x-openai-isConsequential: false`. The existing Action bearer remains mandatory.

The Action API does not accept a runtime URL, arbitrary upstream path, target URL, project ID, repository, dependency host, redirect host, or provider credential from the model.

### Session start

Input:

```json
{
  "expectedCommitSha": "<40-char git sha>",
  "viewport": { "width": 1280, "height": 720 }
}
```

The model supplies only the exact commit it is verifying plus an optional bounded viewport. The runtime derives project, repository, target entry path, host policy, deployment identity, and registration data from trusted server configuration/provider evidence.

### Remaining calls

The other five operations mirror the existing bounded game tool contract using camelCase Action request fields where useful and translate only to the corresponding fixed runtime bridge operation. No arbitrary operation name is accepted.

## Game-Browser Runtime Bridge

Add internal JSON endpoints under `/internal/gpt-action/` to `apps/game-browser-mcp`.

The bridge is optional. If `GPT_ACTION_BRIDGE_TOKEN` is absent, bridge calls fail closed with `503 BRIDGE_CONFIGURATION_ERROR`; the existing `/mcp`, fixture, health, and deployment-registration paths continue to operate unchanged.

Every bridge request must present `Authorization: Bearer <GPT_ACTION_BRIDGE_TOKEN>`. Comparison is constant-time and missing/invalid credentials return `401` without reflecting secret material.

### Stable bridge principal

After bridge authentication, the runtime derives a stable private-bridge owner binding by hashing a fixed domain-separation label plus the bridge token. The raw token is never persisted or returned.

All bridge calls therefore reuse the existing session ownership checks in `createGameToolServices`. Rotating the bridge token intentionally invalidates access to old bridge-owned sessions.

This principal represents one private server-to-server GPT Action integration. It does not claim multi-user plugin/app identity or general `CHATGPT_LOOP_READY` distribution readiness.

## Exact Deployment Discovery

Bridge session start must not require the model to supply a deployment ID or target URL.

Extend the Vercel provenance adapter with a bounded exact-commit lookup:

1. query only the server-owned `TARGET_PROJECT_ID` using the existing server-side Vercel credential;
2. inspect at most the newest 20 deployments;
3. select candidates whose Git metadata exactly matches the configured repository owner/name and requested 40-character commit SHA;
4. require a READY deployment with immutable `dpl_...` identity;
5. pass the candidate through the existing `verify()` path before registration;
6. fail with `STALE_DEPLOYMENT` when no exact READY candidate exists.

Discovery is read-only provider access and cannot create or redeploy a target.

`RegistrationService` then creates the existing short-lived exact-deployment capability. The bridge immediately uses it to start the session; the registration capability does not need to be exposed to the GPT.

## Browser Evidence Over Actions

The MCP transport can return screenshots as native image content. GPT Actions remain a bounded JSON tool surface and must not place megabyte screenshot base64 bodies or runtime filesystem paths into Action responses.

The reviewed visual-evidence extension keeps screenshot bytes server-side and returns a short-lived HTTPS capability instead. When an observation contains a PNG at or below the 2 MB evidence limit, the Action projection:

1. decodes the already-captured screenshot bytes;
2. computes `frame_sha256` over those exact bytes;
3. creates a five-minute HMAC-SHA256 capability bound to the bridge session ID, exact frame digest, and expiry;
4. removes the raw base64 and runtime path from the Action JSON;
5. returns only bounded metadata plus `screenshot_url`, `frame_sha256`, and `expires_at`.

The URL points only to the configured browser-runtime origin at `/internal/gpt-action/screenshot`. It never accepts a caller-provided upstream URL, target URL, provider host, repository, filesystem path, shell command, JavaScript, or browser escape hatch. The HMAC uses the existing shared bridge token with a dedicated domain-separation label; the raw token is never returned.

The browser screenshot route validates the signed session/digest/expiry tuple before touching session state. It then reads the existing cached screenshot through the same bridge-owned session surface **without calling `observe` or incrementing observation/action sequences**, recomputes SHA-256, and serves `image/png` only if the cached bytes still match the signed frame digest. If the session has advanced and the cached frame changed, the old capability fails closed with `409 ACTION_REJECTED`; the caller must obtain a fresh observation instead of receiving mismatched evidence. Invalid, expired, malformed, or tampered capabilities fail before screenshot retrieval.

Successful image responses are `private, no-store, max-age=0` and `nosniff`. Action JSON still labels target-derived content as `UNTRUSTED_TARGET_CONTENT`, and the image itself remains untrusted game evidence rather than instructions or outer-loop authority.

A visual criterion may receive PASS only after the signed URL is actually fetched and the returned image is inspected as part of the canonical sense → act → verify loop. The JSON descriptor or URL alone is not visual proof. If the capability cannot be fetched or the exact frame is no longer available, visual QA remains capability-blocked until a fresh frame is obtained.

## Action Proxy Configuration

`apps/gpt-action-api` uses two optional Production variables:

```text
GAME_BROWSER_RUNTIME_BASE_URL
GAME_BROWSER_BRIDGE_TOKEN
```

`GAME_BROWSER_RUNTIME_BASE_URL` must be a bare HTTPS origin with no credentials, path, query, or fragment. The Action API appends only reviewed fixed internal bridge paths.

Missing/invalid bridge configuration returns `503 GAME_BROWSER_CONFIGURATION_ERROR` and does not affect GitHub or canonical-skill operations.

The same bridge token value is configured server-side in the browser runtime as `GPT_ACTION_BRIDGE_TOKEN`. Secret activation remains a separately gated Production credential change.

## Proxy Safety

The Action API:

- never accepts an upstream URL from the model;
- never forwards the incoming Action bearer to the browser runtime;
- uses only the dedicated bridge token upstream;
- sends JSON only to six fixed bridge paths;
- bounds request and response body sizes;
- rejects non-object JSON and unexpected methods;
- does not reflect upstream response bodies for network/protocol/configuration failures;
- preserves structured browser runtime errors when they are already bounded JSON error contracts.

The browser runtime bridge:

- exposes no shell, arbitrary JavaScript, Playwright/CDP passthrough, navigation URL, generic selector mutation, credential entry, repository mutation, deployment, release, settings, billing, or target-registration bypass;
- routes normal control traffic only to the existing six game services;
- the signed screenshot capability reads only the already-captured cached frame, rejects tampering/expiry/frame drift, and does not weaken bearer protection on normal routes;
- derives target/deployment policy from server configuration and verified provider metadata.

## Error Contract

Action-level errors:

- `400` invalid Action input
- `401` invalid Action bearer
- `502` browser runtime unavailable or returned an invalid/unbounded response
- `503` Action bridge configuration missing

Runtime bridge errors preserve existing machine-readable game error codes when feasible, including `AUTH_CONTEXT_UNAVAILABLE`, `SESSION_NOT_FOUND`, `SESSION_EXPIRED`, `SESSION_RECOVERY_REQUIRED`, `TARGET_BLOCKED`, `PROVENANCE_MISMATCH`, `STALE_DEPLOYMENT`, `CAPABILITY_UNAVAILABLE`, `ACTION_REJECTED`, `ACTION_STATE_UNKNOWN`, `BROWSER_ERROR`, and `LIMIT_EXCEEDED`.

Bridge authentication/configuration errors use stable non-secret codes and do not expose credentials.

## TDD / Verification

Root tests must prove:

- OpenAPI exposes exactly six fixed browser Action operations;
- all require the existing Action bearer;
- all are non-consequential;
- invalid/missing Action bridge config fails closed;
- the proxy never accepts arbitrary upstream URLs/paths;
- bridge token is used upstream and the incoming Action key is not forwarded;
- screenshot base64/runtime paths are removed and replaced with a bounded signed URL tied to the exact frame digest;
- oversized screenshots do not receive a capability;
- upstream secret/error bodies are not leaked.

Game-browser package tests must prove:

- bridge is disabled without its dedicated token;
- missing/wrong bridge bearer is rejected;
- stable binding owns sessions across separate bridge calls;
- bridge routes normal control traffic only to the existing six game services;
- the signed screenshot capability reads only the already-captured cached frame, rejects tampering/expiry/frame drift, and does not weaken bearer protection on normal routes;
- deployment discovery is limited to the configured project/repository and exact commit;
- discovered deployment is re-verified through the existing provenance verifier;
- no match returns `STALE_DEPLOYMENT`;
- existing MCP tests, security tests, session tests, typecheck, and build remain green.

## Completion Boundary

Code/CI/review completion of this slice does not equal full visual `CHATGPT_LOOP_READY`.

After merge, Production activation additionally requires the existing authorized runtime reconciliation for both Vercel projects and a real bridge run. Visual-only QA remains `BLOCKED_CAPABILITY` unless the run obtains a signed frame capability, fetches the exact digest-matching PNG, and actually inspects that image. The signed descriptor alone is never sufficient evidence.
