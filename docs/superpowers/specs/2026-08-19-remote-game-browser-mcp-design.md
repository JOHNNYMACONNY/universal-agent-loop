# Remote Game Browser MCP Runtime — Design

Date: 2026-08-19
Status: accepted design pending implementation plan

## Goal

Build a remotely hosted browser-control app that lets ChatGPT Web autonomously execute the `game-browser-testing` skill against public/deployed browser games without requiring any local computer, localhost service, tunnel, desktop daemon, Codex/OpenCode process, or user-operated browser.

This runtime is the execution backend for the already-implemented `game-browser-testing` skill. The skill remains the QA policy/orchestration contract; this runtime supplies bounded browser capabilities and evidence.

## Hard Acceptance Criterion: No Local Computer

V1 is only successful if the complete test loop can run with the user's local computer powered off.

The required path is:

```text
ChatGPT Web
  -> remote MCP/App endpoint
  -> remotely hosted browser coordinator
  -> isolated cloud browser sandbox
  -> public/deployed game URL
  -> observation/input/evidence
  -> ChatGPT Web
```

The runtime MUST NOT require:

- localhost or private-LAN access;
- a secure tunnel to the user's machine;
- a Chrome instance running on the user's machine;
- a desktop helper/daemon;
- Codex, OpenCode, Antigravity, or another coding agent running locally;
- local filesystem or local shell access;
- the user to manually perform ordinary gameplay inputs during a QA session.

One-time platform/account gates such as connecting an approved app, accepting provider billing, or submitting/approving a Plugin Directory listing are outside the autonomous execution loop and may require the account owner.

## Product Boundary

V1 targets public/deployed browser games only. It does not attempt to reach localhost, private previews that require credentials, VPN-only sites, personal browser profiles, or local game executables.

The service is a separate deployable component from UAL's canonical protocol/reference engine. Until a dedicated repository can be created through the connected GitHub surface, implementation may live as a self-contained deployable package under:

```text
apps/game-browser-mcp/
```

inside `JOHNNYMACONNY/universal-agent-loop`. It MUST have its own `package.json`, tests, and deployment configuration so the UAL root remains zero-runtime-dependency and the package can later move to a dedicated repository without semantic changes.

## Platform Architecture

Recommended v1 stack:

```text
ChatGPT Web
   |
   | MCP / Apps SDK-compatible remote app
   v
Vercel-hosted Node service
   |
   | validates URL + session + bounded action schema
   v
Vercel Sandbox
   |
   | agent-browser + Chromium
   v
public/deployed browser game
```

### Why Vercel Sandbox

Vercel Sandbox provides isolated cloud microVMs and supports headless Chromium plus `agent-browser`. It can use snapshots to avoid reinstalling browser dependencies on every session and can enforce sandbox network policy.

The coordinator should use Vercel's server-side identity/OIDC when deployed. Personal Vercel tokens are for local/administrative development only and MUST NOT be required by the end-user execution loop.

## Session Model

Each game-QA session gets a server-owned opaque `session_id` mapped to one isolated browser sandbox.

The browser session persists across MCP calls so ChatGPT can perform iterative sense -> act -> verify rather than relaunching the game for every action.

V1 session limits:

- one active target origin per session;
- bounded idle and absolute lifetime;
- bounded total action count;
- explicit end/cleanup;
- automatic cleanup after expiry/error;
- no browser state reuse across unrelated users/sessions.

Persistent sandbox identity is an optimization only. Cross-user cookies, local storage, credentials, or personal sessions MUST NOT be shared.

## MCP Tool Surface

The runtime exposes a deliberately narrow game-testing API rather than arbitrary Playwright, CDP, shell, or JavaScript execution.

### `game_session_start`

Input:

```ts
{
  url: string;
  viewport?: { width: number; height: number };
}
```

Behavior:

- validate and normalize the public HTTPS target;
- reject private/reserved/local network targets;
- create isolated browser sandbox/session;
- navigate to the target;
- return session metadata and an initial observation.

Output includes:

```ts
{
  session_id: string;
  target_origin: string;
  observation: GameObservation;
  limits: SessionLimits;
}
```

### `game_observe`

Input:

```ts
{ session_id: string }
```

Returns the strongest bounded evidence available:

```ts
{
  url: string;
  title?: string;
  screenshot?: image_reference;
  accessibility_snapshot?: string;
  console_errors?: ConsoleError[];
  failed_requests?: FailedRequest[];
  timestamp: string;
}
```

Screenshot/media payloads should be returned using the Apps/MCP-supported resource mechanism rather than oversized inline base64 when practical.

### `game_input`

Input:

```ts
{
  session_id: string;
  actions: GameAction[];
}
```

Allowed actions are bounded gameplay primitives only:

```ts
| { type: "key_down"; key: AllowedKey }
| { type: "key_up"; key: AllowedKey }
| { type: "press"; key: AllowedKey; duration_ms?: number }
| { type: "pointer_move"; x: number; y: number }
| { type: "pointer_down"; button?: "left" | "middle" | "right" }
| { type: "pointer_up"; button?: "left" | "middle" | "right" }
| { type: "click"; x: number; y: number; button?: "left" | "middle" | "right" }
| { type: "scroll"; delta_x?: number; delta_y: number }
| { type: "wait"; duration_ms: number }
```

The server validates action count, coordinates, key allowlist, and duration. It does not accept raw browser commands, arbitrary selectors with mutations, shell commands, or arbitrary JavaScript.

Output contains action execution metadata and a lightweight post-action observation summary so the caller can decide whether to run `game_observe` for stronger verification.

### `game_read_state`

Optional read-only instrumentation tool.

Input:

```ts
{
  session_id: string;
  path?: string;
}
```

Behavior:

- only reads from `window.__GAME_TEST__` (or a future explicitly approved equivalent);
- serializes JSON-compatible state;
- rejects function invocation;
- rejects assignment/mutation;
- applies output-size/depth limits.

This tool is optional evidence. It does not replace screenshots/runtime evidence for user-visible acceptance criteria.

### `game_reset`

Input:

```ts
{
  session_id: string;
  mode?: "reload" | "target";
}
```

Resets the game to a known state without allowing navigation to an arbitrary new origin. `target` returns to the originally validated URL.

### `game_session_end`

Input:

```ts
{ session_id: string }
```

Stops the sandbox/session and deletes server-side ephemeral session metadata.

## Deliberately Excluded From V1

The MCP surface MUST NOT expose:

- arbitrary shell/terminal execution;
- arbitrary CDP/Puppeteer/Playwright commands;
- unrestricted JavaScript evaluation;
- text/password form filling as a generic web bot;
- credential stores or personal Chrome profiles;
- file upload/download from a user's computer;
- payment/purchase actions;
- local/private network navigation;
- cross-origin browsing unrelated to the project under test;
- repository mutation, deployment, merge, or publication.

If a later game requires a missing primitive, extend the typed game-action contract through review rather than adding a generic escape hatch.

## URL and Network Security

The coordinator validates the initial URL before creating a session.

Minimum rules:

- HTTPS only for v1, except explicitly synthetic test fixtures in automated tests;
- reject `localhost`, loopback, link-local, RFC1918/private ranges, multicast, unspecified, and metadata-service targets;
- resolve DNS and reject resolved private/reserved IPs to mitigate SSRF/DNS rebinding;
- revalidate redirects and navigation-origin changes;
- prevent navigation to `file:`, `data:`, `javascript:`, browser-internal schemes, and non-HTTP(S) protocols;
- apply Vercel Sandbox network policy where practical as a second control layer;
- log policy rejections without leaking sensitive headers/content.

Normal project assets/CDNs/API calls may load as required by the game, but navigation away from the approved project-associated origin requires explicit project-owned redirect handling. Unrelated third-party pages are not interaction targets.

## Evidence and Error Contract

Every tool returns structured machine-readable status plus concise human-readable detail.

Canonical result classes:

```text
OK
INVALID_ARGUMENT
SESSION_NOT_FOUND
SESSION_EXPIRED
TARGET_BLOCKED
CAPABILITY_UNAVAILABLE
ACTION_REJECTED
BROWSER_ERROR
LIMIT_EXCEEDED
```

Browser failures must not be converted into successful observations. Evidence must identify the session and observation sequence so the `game-browser-testing` skill can correlate sense -> act -> verify steps.

## Resource and Cost Bounds

V1 requires explicit bounds to keep autonomous loops safe and affordable.

Initial defaults should be centralized configuration constants and covered by tests, for example:

- max session lifetime: 15 minutes;
- max idle time: 3 minutes;
- max actions per `game_input`: 20;
- max actions per session: 500;
- max single wait: 10 seconds;
- max screenshot dimensions/payload;
- max instrumentation JSON bytes/depth;
- max console/network events retained per observation.

Exact values may be tuned from real usage without changing the MCP semantic contract.

## Authentication and User Identity

V1 does not need the end user to authenticate into the game target.

The ChatGPT app/MCP server still needs an app-level abuse boundary. The initial implementation may use deployment/app authentication appropriate to the Apps SDK/MCP publication path, but MUST NOT require the user to manage Vercel credentials.

No game-site credentials are accepted in v1.

## OpenAI / Plugin Distribution Boundary

The implementation targets a remote MCP/Apps SDK-compatible service suitable for eventual Plugin Directory submission.

The runtime architecture MUST remain valid even before directory approval: it can be protocol-tested directly and later connected to ChatGPT through whatever developer/testing surface OpenAI currently permits.

Directory approval, plan eligibility, and Connect availability are external platform gates. They must not be represented as runtime implementation completion.

The app should use narrow tool descriptions, accurate annotations/permissions, a privacy policy, and clear safety behavior suitable for review. Browser action tools should be classified conservatively as action-capable even when their target is an isolated test browser.

## Privacy

V1 should minimize retention:

- ephemeral browser/session state;
- no personal browser cookies;
- no credentials;
- no long-term screenshot retention by default;
- logs contain operational metadata, policy errors, timings, and bounded failure diagnostics, not full page contents;
- privacy policy states what target URLs/evidence may transiently pass through the service.

## Integration With `game-browser-testing`

The skill remains responsible for autonomous QA reasoning:

```text
baseline
-> infer controls
-> choose high-value goals
-> SENSE
-> ACT
-> VERIFY
-> reproduce findings
-> PASS | FINDINGS | BLOCKED_CAPABILITY
```

The MCP runtime does not independently decide whether a game passed. It executes bounded actions and returns evidence.

The `autonomous-dev-loop` remains responsible for:

```text
IMPLEMENT
-> VERIFY via game-browser-testing
-> REVIEW
-> REPAIR when material FINDINGS
-> fresh VERIFY
-> fresh REVIEW
```

A repository change invalidates previous game-browser evidence.

## Testing Strategy

Use TDD. The service needs deterministic unit/contract tests before real sandbox integration tests.

Required test groups:

1. URL/SSRF policy: private IPs, DNS resolution, redirects, forbidden schemes.
2. Session lifecycle: start, lookup, expiry, end, cleanup, per-session isolation.
3. Action validation: key allowlist, coordinates, waits, action/session limits.
4. Instrumentation reader: JSON-only read semantics, function/mutation rejection, size/depth bounds.
5. MCP schemas: stable tool names, required/optional inputs, machine-readable error results.
6. Browser adapter: command generation/parsing isolated behind one interface with fake adapter tests.
7. Sandbox integration: launch browser, open a synthetic public fixture, screenshot/observe, input, reload, cleanup.
8. Security regression: redirects/DNS policy and no arbitrary command/JS escape hatch.

Live Vercel Sandbox tests that consume provider resources should be separately gated from hermetic unit tests.

## Deployment Strategy

`apps/game-browser-mcp/` is independently deployable to Vercel.

Production setup should use:

- Node runtime;
- Vercel Sandbox via server-side identity/OIDC;
- prebuilt Sandbox snapshot containing browser dependencies and `agent-browser` for fast startup;
- rate limiting/abuse controls before directory submission;
- production privacy/terms metadata required by the app submission flow.

Creating the browser snapshot is an administrative deployment step, not a requirement for each test session.

## Implementation Files

Planned package boundary:

```text
apps/game-browser-mcp/
  package.json
  tsconfig.json
  README.md
  src/
    server.ts
    mcp.ts
    config.ts
    errors.ts
    security/url-policy.ts
    sessions/session-store.ts
    browser/browser-adapter.ts
    browser/vercel-sandbox-browser.ts
    tools/session-start.ts
    tools/observe.ts
    tools/input.ts
    tools/read-state.ts
    tools/reset.ts
    tools/session-end.ts
  tests/
    *.test.ts
  scripts/
    create-browser-snapshot.ts
```

Exact file decomposition may be adjusted during the implementation plan as long as responsibilities remain isolated.

## Completion Contract

Runtime v1 is implementation-complete only when:

- its hermetic unit/contract suite passes;
- security/SSRF tests pass;
- MCP tool schemas match this design;
- at least one remote cloud browser integration run demonstrates start -> observe -> input -> observe -> end against a safe public/synthetic target;
- the run occurs with no local browser or local game runtime dependency;
- no known material review findings remain;
- deployment/provider limitations are reported honestly;
- Plugin Directory submission/approval is reported separately from runtime completion.
