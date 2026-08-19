# Remote Game Browser MCP Runtime — Design

Date: 2026-08-19
Status: revised design for final review

## Goal

Build a remotely hosted browser-control app that lets ChatGPT Web autonomously execute the canonical `game-browser-testing` QA policy against public/deployed browser games without requiring any local computer, localhost service, tunnel, desktop daemon, Codex/OpenCode process, user-operated browser, or manual gameplay input during ordinary QA.

The runtime is an execution/evidence backend. It supplies bounded browser capabilities, cloud session continuity, deployment provenance, and structured evidence. It does **not** decide whether development is complete. `game-browser-testing` remains the QA reasoning/policy layer and `autonomous-dev-loop` remains the outer implementation/VERIFY/REVIEW/REPAIR orchestrator.

## Hard Acceptance Criterion: No Local Computer

V1 is only successful as an autonomous runtime if the complete implementation and QA loop can operate with the user's local computer powered off.

The intended end state is:

```text
ChatGPT Web
  -> autonomous-dev-loop
  -> GitHub implementation
  -> remote CI/tests
  -> deployed preview tied to exact commit
  -> game-browser-testing
  -> remote MCP/App
  -> cloud browser sandbox
  -> real gameplay interaction/evidence
  -> PASS | FINDINGS | verification blocker
  -> REPAIR when material findings exist
  -> new commit/deployment
  -> fresh VERIFY
  -> fresh REVIEW
  -> repeat autonomously
```

The runtime and ordinary QA loop MUST NOT require:

- localhost or private-LAN access;
- a secure tunnel to the user's machine;
- a Chrome instance running on the user's machine;
- a desktop helper/daemon;
- Codex, OpenCode, Antigravity, or another coding agent running locally;
- local filesystem or local shell access;
- the user to manually perform ordinary gameplay inputs during a QA session.

One-time platform/account gates such as connecting an approved plugin/app, selecting an app permission, accepting provider billing, or submitting/approving a Plugin Directory listing are outside the autonomous execution loop and may require the account owner.

## Product Boundary

V1 targets public/deployed browser games and game-shaped interactive web builds. It does not attempt to reach localhost, private previews that require game credentials, VPN-only sites, personal browser profiles, or local game executables.

The bounded primitives should remain reusable for non-game interactive web projects later, but game testing is the v1 design center. The runtime MUST NOT be broadened into a generic browser agent to achieve that future reuse.

The service is a separate deployable component from UAL's canonical protocol/reference engine. Until a dedicated repository can be created through the connected GitHub surface, implementation may live as a self-contained deployable package under:

```text
apps/game-browser-mcp/
```

inside `JOHNNYMACONNY/universal-agent-loop`. It MUST have its own package manifest, tests, deployment configuration, and runtime dependencies so the UAL root remains zero-runtime-dependency and the package can later move to a dedicated repository without semantic changes.

## Platform Architecture

The approved v1 architecture remains:

```text
ChatGPT Web
   |
   | MCP / Apps SDK-compatible remote app
   v
Stateless Vercel-hosted Node coordinator
   |
   | validates caller + target + provenance + bounded action schema
   | reads/writes minimal durable session metadata
   v
Vercel Sandbox
   |
   | agent-browser + Chromium + sandbox-side session/input ledger
   v
registered public/deployed browser game
```

### Why Vercel Sandbox

Vercel Sandbox provides isolated cloud microVMs and supports headless Chromium plus `agent-browser`. It can use snapshots to avoid reinstalling browser dependencies on every session and supports sandbox network policy.

The coordinator should use Vercel's server-side identity/OIDC when deployed. Personal Vercel tokens are administrative/development credentials only and MUST NOT be required by the end-user execution loop.

## Authority Boundary

This runtime design does not weaken or replace canonical UAL authority rules.

The browser runtime itself has no authority to:

- modify GitHub;
- create or update PRs;
- merge;
- deploy;
- mutate production state;
- publish externally;
- read/use/create unrelated credentials;
- change billing.

The end-to-end autonomous acceptance path may include preview/test deployment only when the outer `autonomous-dev-loop` is operating under an already explicit `DEPLOY` grant scoped to that preview/test environment. Implementation/QA authority does **not** imply deployment authority.

The `CHATGPT_LOOP_READY` acceptance demonstration MUST record the granted authority set used for the demonstration. Autonomy means the loop can continue without repeated manual intervention **within already granted authority**; it does not mean the loop may infer new authority.

Provider service credentials, signed deployment-registration credentials, and Vercel OIDC are server-side infrastructure concerns. Their use must be pre-authorized/configured as part of the environment and must not be exposed to the model or end user during ordinary QA.

## Deployment Provenance and Commit-Bound Evidence

A browser PASS against an unknown, mutable, stale, or unproven deployment MUST NOT count as VERIFY evidence.

Every browser-QA session is bound to a trusted `TargetRegistration` that records at least:

```ts
interface TargetRegistration {
  target_registration_id: string;
  project_id: string;
  repository: { owner: string; name: string };
  expected_commit_sha: string;
  deployment_id: string;          // immutable provider deployment identifier
  deployment_url: string;         // exact deployed preview URL
  deployment_origin: string;
  allowed_hosts: string[];        // concrete target + explicitly approved dependencies
  created_at: string;
  expires_at: string;
  provenance_source: "provider_api" | "signed_provider_event" | "trusted_ci";
}
```

### Trusted registration path

`TargetRegistration` MUST NOT be creatable from untrusted page content or by a generic MCP browsing tool.

V1 uses a server-side registration/control path separate from the gameplay MCP tools. A registration is accepted only when the service can cryptographically or server-to-server verify project/repository identity and deployment provenance, for example through:

- a deployment-provider API response authenticated by the service;
- a signed deployment-provider webhook/event; or
- trusted CI using a narrowly scoped server credential to register the exact deployment it just produced.

The registration workflow must be automatable after every authorized deployment so a normal REPAIR -> redeploy -> VERIFY loop does not require a human to re-allowlist each commit.

A project may have a longer-lived trust configuration containing repository identity and approved host/dependency patterns. Each concrete deployment still receives a short-lived commit-bound `TargetRegistration` containing the exact deployment host and immutable provider deployment identity.

An approved deployment host **pattern alone** is never sufficient provenance. The concrete host must also be verified as a deployment of the configured provider project/repository and exact commit. Broad wildcard patterns such as a provider-wide `*.example-host.com` cannot independently authorize an arbitrary deployment.

### Provenance verification at session start

`game_session_start` receives `target_registration_id` and `expected_commit_sha`. The coordinator MUST verify:

1. the registration exists and is unexpired;
2. the caller is authorized for the registered project;
3. repository/project identity matches the trusted registration;
4. `expected_commit_sha` exactly equals the registration's verified commit SHA;
5. the exact deployment URL/immutable deployment identifier still maps to that commit according to the trusted provenance source;
6. the concrete target URL/origin and required dependency hosts are within the approved target policy.

Any mismatch returns a non-PASS error such as `PROVENANCE_MISMATCH` or `STALE_DEPLOYMENT` before gameplay begins.

Every observation/evidence packet MUST carry deployment provenance:

```ts
interface DeploymentProvenance {
  target_registration_id: string;
  repository: { owner: string; name: string };
  expected_commit_sha: string;
  deployed_commit_sha: string;
  deployment_id: string;
  deployment_url: string;
}
```

`expected_commit_sha` and `deployed_commit_sha` MUST match for browser evidence to count toward VERIFY.

Any repository implementation mutation after verification invalidates prior runtime/browser evidence under the existing UAL freshness rule. The next VERIFY requires a new matching deployment registration and fresh browser evidence for the new implementation state.

## Confirmation-Free Gameplay as a Hard Autonomy Gate

After any unavoidable one-time plugin/app connection, authorization, or app-permission setup, ordinary gameplay actions MUST be executable from ChatGPT without a separate user confirmation for every keypress, pointer movement, click, observation, reset, or session-control call.

A representative ordinary session is:

```text
start
-> observe
-> input
-> observe
-> input
-> observe
-> end
```

The real ChatGPT acceptance test MUST demonstrate that sequence without manual per-action approvals.

The app should use the narrowest possible action surface and permission/approval configuration supported by ChatGPT. However, the design does not assume that confirmation-free permissions are available on every plan, workspace, or future platform version.

If ChatGPT or the Plugin/App permission system forces per-action confirmation for these ordinary isolated-browser operations and that behavior cannot be configured away safely for the target account/surface, the system MUST report:

```text
BLOCKED_PLATFORM_AUTONOMY
```

`BLOCKED_PLATFORM_AUTONOMY` is a `CHATGPT_LOOP_READY` blocker, not a browser-game defect and not a successful runtime result. The system MUST NOT represent a confirmation-dependent path as an autonomous completed loop.

This blocker is intentionally separate from the current `game-browser-testing` session statuses (`PASS | FINDINGS | BLOCKED_CAPABILITY`): it describes the ChatGPT/App execution surface, not the game-browser session itself.

## Server-Side Target Registration and Deny-by-Default Egress

The service MUST NOT function as a generic remote public-web browser proxy.

### Project trust configuration

Before a deployment can be registered, a project trust configuration defines:

```ts
interface ProjectTrustConfig {
  project_id: string;
  repository: { owner: string; name: string };
  approved_deployment_host_patterns: string[];
  approved_dependency_hosts: string[];
  approved_redirect_hosts: string[];
}
```

The target and dependency allowlist is server-side configuration or trusted signed registration data. A model-supplied URL alone cannot expand it.

Deployment host patterns are discovery constraints only. A concrete deployment host must still pass provider-project/repository provenance verification before it becomes an allowed target.

### Required network policy

Each sandbox session MUST receive a deny-by-default network policy where the provider supports it. Allowed egress is limited to:

- the exact registered target/deployment host;
- explicitly approved game asset/API/CDN hosts from trusted project configuration;
- explicitly approved project-owned redirect hosts;
- infrastructure endpoints strictly required for the browser runtime itself.

All other outbound hosts/CIDRs are denied.

URL-layer validation remains required even when sandbox network policy exists. The two controls are defense in depth, not alternatives.

Minimum URL/SSRF rules:

- HTTPS only for real v1 targets, except synthetic test fixtures inside controlled automated test infrastructure;
- reject `localhost`, loopback, link-local, RFC1918/private ranges, multicast, unspecified, metadata-service, and reserved/internal targets;
- resolve DNS and reject private/reserved resolutions before access;
- revalidate redirects and any observed navigation-origin changes;
- block DNS rebinding/private resolution on subsequent resolution checks;
- prevent navigation to `file:`, `data:`, `javascript:`, browser-internal schemes, and non-HTTP(S) protocols;
- reject any target/redirect/dependency host not present in trusted project configuration;
- log policy rejections without leaking sensitive headers/content.

Page requests to unrelated third-party origins are blocked even when the page attempts to initiate them. If a real game requires another legitimate host, it must be added to trusted project configuration rather than dynamically accepted from page content.

## Stateless Coordinator and Recoverable Session Model

The Vercel/server coordinator MUST be stateless across requests. Correctness MUST NOT depend on one warm process, one function instance, or an in-memory `Map` of active sessions.

Subsequent MCP calls may land on different coordinator instances and MUST reconnect to the same cloud sandbox/browser session using durable remote metadata.

### Opaque session identity

The caller receives an unguessable opaque `session_id`. Server-side durable session state stores only the minimum required to reconnect and enforce safety:

```ts
interface SessionRecord {
  session_id: string;
  sandbox_id: string;
  target_registration_id: string;
  target_origin: string;
  owner_binding: string;       // privacy-preserving binding to authenticated app principal
  created_at: string;
  last_seen_at: string;
  idle_expires_at: string;
  absolute_expires_at: string;
  action_seq: number;
  observation_seq: number;
  held_keys: string[];
  held_pointer_buttons: string[];
  lifecycle: "ACTIVE" | "RECOVERY_REQUIRED" | "ENDING";
}
```

The durable session store MUST support TTL/expiry and concurrency control/compare-and-set or an equivalent serialization mechanism. Exact storage provider is an implementation-plan decision; it must be remotely hosted and require no local computer.

The `owner_binding` is derived from the authenticated app principal or another stable signed connection identity. Raw personal identifiers need not be stored. If the app surface cannot provide a safe ownership binding, the runtime must fail closed rather than permit cross-user session reuse.

### Browser process recovery

A durable session record proves which sandbox should exist; it does not prove that Chromium/browser state still exists.

On every resumed call, the coordinator validates the sandbox and browser driver are still alive and correspond to the expected session. If the actual browser process/session is gone, the runtime MUST NOT silently claim state persistence.

It returns:

```text
SESSION_EXPIRED
```

or, for an ambiguous partially executed input batch:

```text
SESSION_RECOVERY_REQUIRED
```

A fresh session/reset may then be deliberately created by the caller. It must never be presented as continuation of the lost browser state.

### Sandbox-side execution/input ledger

The browser worker/sandbox MUST maintain its own minimal session execution ledger in addition to coordinator metadata so coordinator-process loss cannot erase the last known held-input/batch state before recovery.

At minimum, the sandbox-side ledger tracks:

- logical session identifier binding;
- last accepted/completed `action_batch_id` state;
- current held keys;
- current held pointer buttons;
- last locally observed action sequence.

The coordinator compares its durable record with the sandbox-side ledger when reconnecting. Any irreconcilable or ambiguous state forces `SESSION_RECOVERY_REQUIRED`; it must not be guessed or silently advanced.

## Session Limits

Each game-QA session is limited to one registered target deployment.

V1 requires:

- one registered target/deployment per session;
- bounded idle and absolute lifetime;
- bounded total action count;
- explicit end/cleanup;
- automatic cleanup after expiry/error;
- no browser state reuse across unrelated users/sessions;
- no cross-deployment continuation after a new implementation commit.

Persistent sandbox identity is a continuity mechanism, not permission to reuse cookies/local storage across unrelated sessions.

## MCP Tool Surface

The runtime exposes a deliberately narrow game-testing API rather than arbitrary Playwright, CDP, shell, or JavaScript execution.

### `game_session_start`

Input:

```ts
{
  target_registration_id: string;
  expected_commit_sha: string;
  viewport?: { width: number; height: number };
}
```

Behavior:

- authenticate/bind the caller;
- load the trusted target registration;
- validate exact commit/deployment provenance;
- enforce target and deny-by-default network policy;
- create an isolated browser sandbox/session;
- navigate only to the registered deployment URL;
- return session metadata and an initial observation.

Output includes:

```ts
{
  session_id: string;
  target_origin: string;
  deployment_provenance: DeploymentProvenance;
  observation: GameObservation;
  limits: SessionLimits;
}
```

### `game_observe`

Input:

```ts
{
  session_id: string;
  expected_observation_seq?: number;
}
```

Returns the strongest bounded evidence available:

```ts
{
  session_id: string;
  observation_seq: number;
  action_seq: number;
  deployment_provenance: DeploymentProvenance;
  url: string;
  title?: string;
  screenshot?: image_reference;
  accessibility_snapshot?: string;
  console_errors?: ConsoleError[];
  failed_requests?: FailedRequest[];
  captured_at: string;
}
```

Screenshot/media payloads should use the Apps/MCP-supported resource mechanism rather than oversized inline base64 when practical.

An observation is evidence only for its own deployment provenance and sequence position.

### `game_input`

Input:

```ts
{
  session_id: string;
  action_batch_id: string;
  expected_action_seq: number;
  actions: GameAction[];
}
```

`action_batch_id` is required and unique per logical batch. It provides retry-safe idempotency.

Allowed actions are bounded gameplay primitives only:

```ts
| { type: "key_down"; key: AllowedKey }
| { type: "key_up"; key: AllowedKey }
| { type: "press"; key: AllowedKey; duration_ms?: number }
| { type: "pointer_move"; x: number; y: number }
| { type: "pointer_move_relative"; delta_x: number; delta_y: number }
| { type: "pointer_down"; button?: "left" | "middle" | "right" }
| { type: "pointer_up"; button?: "left" | "middle" | "right" }
| { type: "click"; x: number; y: number; button?: "left" | "middle" | "right" }
| { type: "scroll"; delta_x?: number; delta_y: number }
| { type: "wait"; duration_ms: number }
```

`pointer_move_relative` exists for bounded mouse-look/pointer-lock style gameplay. Relative deltas are capped per action and per batch; it is not a generic raw-CDP escape hatch.

The server validates batch/action count, coordinates/deltas, key allowlist, wait/press durations, sequence, and session limits. It does not accept raw browser commands, arbitrary selectors with mutations, shell commands, unrestricted navigation, or arbitrary JavaScript.

Output includes:

```ts
{
  session_id: string;
  action_batch_id: string;
  action_seq_before: number;
  action_seq_after: number;
  observation_seq: number;
  duplicate: boolean;
  execution_status: "COMPLETE" | "REJECTED" | "RECOVERY_REQUIRED";
  post_action_summary?: object;
}
```

### Input idempotency and sequencing

Before executing a batch, the runtime durably records the `action_batch_id`, expected sequence, and acceptance state. A retry of an already completed `action_batch_id` returns the recorded result and MUST NOT execute the actions again.

The sandbox-side worker receives the same `action_batch_id` and refuses to re-execute a batch it has already recorded as complete. Coordinator-level and sandbox-level idempotency are defense in depth.

A new batch is accepted only when `expected_action_seq` equals the current server sequence. This prevents stale/out-of-order actions from silently running.

If the coordinator/browser worker fails in a window where it cannot prove whether a partially executed batch completed, the system MUST NOT retry the batch blindly. It marks the session `RECOVERY_REQUIRED`, releases held input state if the browser is reachable, and returns `ACTION_STATE_UNKNOWN` / `SESSION_RECOVERY_REQUIRED`. The caller must reset or start fresh before further gameplay actions.

The runtime maintains monotonic `action_seq` and `observation_seq` values. Evidence and findings can therefore cite an ordered action/observation history.

### Fail-safe input release

The runtime tracks held keys and pointer buttons in both coordinator/session metadata and the sandbox-side execution ledger.

It MUST attempt to release all held input before further cleanup/recovery on:

- timeout;
- browser/driver error;
- reset;
- session expiration;
- session end;
- partial action failure;
- ambiguous action-batch recovery.

Fail-safe release is idempotent. Cleanup attempts are best-effort when the browser process is already gone; the session must still be marked expired/recovery-required rather than pretending the release was observed.

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
- serializes JSON-compatible data;
- rejects function invocation;
- rejects assignment/mutation;
- applies output-size/depth limits;
- returns session and deployment provenance with the state sample.

This tool is optional evidence. It does not replace screenshots/runtime evidence for user-visible acceptance criteria.

### `game_reset`

Input:

```ts
{
  session_id: string;
  mode?: "reload" | "target";
}
```

Behavior:

1. fail-safe release all held keys/buttons;
2. reload the current registered deployment or return to its registered target URL;
3. never navigate to an arbitrary new origin;
4. advance observation sequencing and return fresh post-reset evidence.

### `game_session_end`

Input:

```ts
{ session_id: string }
```

Behavior:

1. mark the session `ENDING` to reject new inputs;
2. fail-safe release held input;
3. stop the browser/sandbox;
4. expire/delete durable ephemeral session metadata and batch ledger according to retention policy.

Repeated end calls are idempotent and do not resurrect the session.

## Deliberately Excluded From V1

The MCP surface MUST NOT expose:

- arbitrary shell/terminal execution;
- arbitrary CDP/Puppeteer/Playwright commands;
- unrestricted JavaScript evaluation;
- unrestricted URL navigation;
- a model-accessible target-registration bypass;
- generic text/password form filling as a web bot;
- credential stores or personal Chrome profiles;
- file upload/download from a user's computer;
- payment/purchase actions;
- local/private network navigation;
- cross-origin browsing unrelated to trusted project configuration;
- repository mutation, deployment, merge, or publication.

If a later game requires a missing primitive, extend the typed game-action contract through review rather than adding a generic escape hatch.

## Evidence and Error Contract

Every tool returns structured machine-readable status plus concise human-readable detail.

Canonical result/error classes include:

```text
OK
INVALID_ARGUMENT
AUTH_CONTEXT_UNAVAILABLE
SESSION_NOT_FOUND
SESSION_EXPIRED
SESSION_RECOVERY_REQUIRED
TARGET_BLOCKED
PROVENANCE_MISMATCH
STALE_DEPLOYMENT
CAPABILITY_UNAVAILABLE
ACTION_REJECTED
ACTION_STATE_UNKNOWN
BROWSER_ERROR
LIMIT_EXCEEDED
```

Browser failures, stale deployments, provenance mismatches, lost sessions, and other runtime blockers MUST NOT be converted into successful observations.

`BLOCKED_PLATFORM_AUTONOMY` is an end-to-end ChatGPT/App readiness blocker rather than a normal MCP browser-session error because a server call cannot reliably know that ChatGPT requested a UI confirmation before invoking it.

Evidence MUST identify:

- `session_id`;
- deployment provenance;
- `action_seq`;
- `observation_seq`;
- capture time;
- any coverage limitation affecting interpretation.

## Resource and Cost Bounds

V1 requires explicit bounds to keep autonomous loops safe and affordable.

Initial defaults are centralized configuration constants and covered by tests, for example:

- max session lifetime: 15 minutes;
- max idle time: 3 minutes;
- max actions per `game_input`: 20;
- max actions per session: 500;
- max single wait: 10 seconds;
- max relative pointer delta per action/batch;
- max screenshot dimensions/payload;
- max instrumentation JSON bytes/depth;
- max console/network events retained per observation;
- max action-batch ledger retention bounded to session lifetime plus short retry window.

Exact numeric values may be tuned from real usage without changing the semantic contract.

## Authentication and Ownership

V1 does not authenticate the user into the game target and accepts no game-site credentials.

The ChatGPT app/MCP service requires an app-level abuse and session-ownership boundary. Each request must expose or derive a stable authenticated app principal/signed connection identity sufficient to compute `owner_binding` and prevent one caller from resuming another caller's session.

The user MUST NOT need to manage Vercel credentials. Provider service credentials/OIDC and deployment-registration credentials are server-side only.

If a supported ChatGPT/plugin surface cannot provide the identity/permission behavior required for safe session ownership, that is an external platform blocker for `CHATGPT_LOOP_READY`, not permission to weaken isolation.

## OpenAI Plugin/App and Canonical Skill Packaging

The distribution target is a Plugin Directory listing that packages the browser MCP/App together with the canonical `game-browser-testing` skill so a fresh ChatGPT conversation receives the intended QA policy and browser capability as one workflow package.

Canonical source of truth remains:

```text
JOHNNYMACONNY/universal-agent-loop/skills/game-browser-testing/SKILL.md
```

The runtime package MUST NOT maintain an independently edited copy of that skill.

Current OpenAI product documentation supports plugins containing both skills and apps. It does not establish a documented mechanism for an MCP server to dynamically import an Agent Skill from an arbitrary canonical Git URL at invocation time. Therefore the release/submission process should:

1. package the canonical UAL skill as the plugin's skill component using the supported Plugin/Skill mechanism;
2. record the exact UAL commit SHA and skill content hash used for the package;
3. fail packaging/release if the packaged skill does not match that canonical source;
4. treat any necessary copied bytes as a generated release artifact, not a second source of truth;
5. prefer a future official direct-reference/import mechanism if OpenAI documents one before implementation/submission.

This removes reliance on GitHub fallback for fresh installed-plugin conversations while preserving canonical UAL ownership of the policy. The existing GitHub fallback in `autonomous-dev-loop` remains useful when the plugin/skill bundle is not installed.

Plugin Directory availability, plan eligibility, connection availability, confirmation policy, and approval remain external platform gates.

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

The runtime does not independently declare game PASS/FINDINGS. It executes bounded actions and returns evidence/errors.

`BLOCKED_PLATFORM_AUTONOMY` is intentionally evaluated outside the current skill session-status contract because it is a ChatGPT/App invocation-policy failure, not a browser capability failure.

The runtime supplies deployment provenance so a skill/outer verifier can reject stale or mismatched deployments. A runtime observation without matching commit-bound provenance is insufficient verification evidence.

## Integration With `autonomous-dev-loop` and UAL

The outer loop remains responsible for:

```text
IMPLEMENT
-> remote deterministic tests/CI
-> resolve exact commit deployment
-> VERIFY via game-browser-testing + runtime evidence
-> REVIEW
-> REPAIR when material FINDINGS
-> new commit/deployment
-> fresh VERIFY
-> fresh REVIEW
```

This preserves current UAL principles:

- runtime/deployed behavior is strong implementation-truth evidence only when tied to the implementation being evaluated;
- self-reported completion is weak evidence;
- repository mutations stale prior runtime/browser evidence;
- verification/review evidence never expands publication/deployment/credential authority;
- browser/runtime tools remain bounded subtasks and cannot terminate the outer lifecycle.

Any deployment in this loop is performed by the outer orchestrator only when explicit `DEPLOY` authority for the relevant preview/test environment has already been granted. A browser PASS or review PASS cannot create that authority.

The runtime itself has no authority to mutate GitHub, deploy, merge, publish, alter billing, or change production data.

## Real Game-Shaped Remote Acceptance Fixture

A plain HTML page is not sufficient as the only live browser acceptance target.

Before `RUNTIME_COMPLETE`, the project MUST have a remotely hosted safe Canvas/WebGL game-shaped fixture or an explicitly approved deployed game that exercises the real interaction shape.

The fixture/acceptance run MUST demonstrate, across multiple MCP calls:

- canvas/WebGL surface focus;
- keyboard input;
- explicit `key_down` + `key_up`;
- held movement across an observation boundary;
- simultaneous/combined movement where relevant (for example forward + strafe);
- pointer/click input;
- bounded relative pointer movement and pointer-lock/mouse-look behavior when the representative game requires it;
- screenshots after meaningful state changes;
- console/runtime error capture;
- failed network request capture where supported by the backend;
- reset/reload;
- persistence of the same browser session across separate stateless coordinator calls;
- ordered action/observation sequencing;
- idempotent retry of an `action_batch_id` without duplicate gameplay input;
- fail-safe release behavior for held input;
- deployment provenance in returned evidence.

The fixture should intentionally expose at least one safe expected console diagnostic and one expected failed request so capture paths can be proven rather than merely present in schemas.

### Performance evidence limitation

Cloud-sandbox FPS/timing is useful for detecting severe stalls, hangs, crashes, runaway resource use, or gross regressions. It MUST NOT be treated as authoritative proof of production frame-rate/performance targets unless the sandbox environment has been explicitly calibrated for that purpose.

`window.__GAME_TEST__` FPS/performance values and browser timing may support diagnostics, but optimization/performance acceptance criteria require an appropriately calibrated environment.

## Testing Strategy

Use TDD during implementation. The service needs deterministic unit/contract tests before provider-backed integration tests.

Required test groups:

1. **Deployment provenance** — trusted registration, exact SHA match, stale/mismatched deployment rejection, immutable deployment ID handling.
2. **Target registration/SSRF** — project allowlist, provider-project identity, private IPs, DNS resolution/rebinding, redirects, forbidden schemes, unregistered hosts.
3. **Deny-by-default egress** — only registered concrete target/dependency/runtime hosts permitted; unrelated third-party requests blocked.
4. **Stateless session lifecycle** — start on one coordinator instance, resume on another, expiry, browser-loss detection, end, cleanup, ownership isolation.
5. **Coordinator/sandbox reconciliation** — sandbox-side ledger survives coordinator-instance loss; ambiguous state produces recovery-required rather than guessed continuation.
6. **Input idempotency/sequencing** — duplicate `action_batch_id` at coordinator and sandbox layers, stale `expected_action_seq`, concurrent requests, action ledger, monotonic sequences.
7. **Fail-safe input release** — timeout, browser error, reset, expiration, end, partial failure, recovery-required cases.
8. **Action validation** — key allowlist, coordinates/deltas, waits, relative pointer bounds, action/session limits.
9. **Instrumentation reader** — JSON-only read semantics, function/mutation rejection, size/depth bounds.
10. **MCP schemas** — stable narrow tool names, required/optional inputs, machine-readable error results, no generic escape hatch.
11. **Browser adapter** — command generation/parsing isolated behind one interface with fake adapter tests.
12. **Remote game-shaped browser integration** — the acceptance fixture requirements above, across multiple calls and stateless coordinator instances.
13. **Security regression** — no arbitrary shell, JS, CDP/Playwright passthrough, target registration bypass, credential path, or generic browsing.
14. **Authority regression** — runtime cannot deploy/mutate GitHub; end-to-end deploy path fails closed without explicit outer-loop `DEPLOY` authority.
15. **Autonomy acceptance** — real ChatGPT/plugin invocation confirms ordinary gameplay calls do not require per-action human approval; otherwise `BLOCKED_PLATFORM_AUTONOMY`.

Provider-backed browser tests that consume cloud resources are separately gated from hermetic unit tests but are mandatory for the relevant completion gate.

## Deployment Strategy

`apps/game-browser-mcp/` is independently deployable to Vercel.

Production setup should use:

- Node runtime;
- a remote durable session/idempotency store with TTL and concurrency control;
- Vercel Sandbox via server-side identity/OIDC;
- prebuilt Sandbox snapshot containing browser dependencies and `agent-browser` for fast startup;
- mandatory sandbox network policy generated from trusted target registration;
- trusted server-side deployment-provenance registration/verification;
- rate limiting/abuse controls before directory submission;
- production privacy/terms metadata required by the app submission flow.

Creating the browser snapshot and initial project trust configuration are administrative deployment steps, not requirements for each QA session. Per-deployment commit registration must be automatable through provider/CI integration after an already authorized deployment.

## Privacy and Retention

V1 minimizes retention:

- ephemeral browser/session state;
- no personal browser cookies/profiles;
- no game credentials;
- no long-term screenshot retention by default;
- durable session metadata is limited to reconnect/safety/idempotency fields and expires promptly;
- idempotency/action ledger is bounded to the session plus a short retry window;
- logs contain operational metadata, provenance IDs, policy errors, timings, and bounded failure diagnostics, not full page contents;
- ownership bindings are privacy-preserving derived identifiers where practical;
- privacy policy states what target URLs/evidence may transiently pass through the service.

## Completion Gates

Runtime implementation and end-to-end ChatGPT autonomy are separate gates and MUST NOT be conflated.

### `RUNTIME_COMPLETE`

The runtime may claim `RUNTIME_COMPLETE` only when:

- service implementation is complete;
- hermetic unit/contract tests pass;
- security/SSRF/egress tests pass;
- deployment-provenance tests pass;
- stateless session recovery/idempotency/fail-safe-release tests pass;
- the narrow MCP schemas match this design;
- the service is remotely deployed and functioning;
- the real game-shaped remote acceptance fixture passes against an actual cloud browser sandbox;
- the remote acceptance run demonstrates browser-session continuity across multiple coordinator calls;
- the run occurs with no local browser/game/runtime dependency;
- no known material runtime review findings remain.

`RUNTIME_COMPLETE` does **not** claim that ChatGPT can yet execute the entire development loop confirmation-free.

### `CHATGPT_LOOP_READY`

The system may claim `CHATGPT_LOOP_READY` only after the real end-to-end path has been demonstrated from ChatGPT itself with the local computer uninvolved and with the required UAL authority grants recorded in advance:

```text
ChatGPT
-> GitHub implementation change
-> remote CI/verification
-> authorized exact commit-bound preview deployment
-> game-browser-testing policy
-> remote MCP browser session
-> confirmation-free autonomous gameplay interaction
-> commit-bound evidence returned
-> intentional/material fixture defect produces FINDINGS
-> outer loop routes to REPAIR
-> new implementation commit
-> authorized new deployment
-> new exact deployment registration
-> fresh browser verification
-> fresh review
-> final clean evidence
```

The acceptance demonstration MUST prove:

- no localhost/tunnel/local Chrome/desktop daemon/local coding-agent process participates;
- ordinary gameplay tool calls do not require manual per-action confirmations;
- browser evidence corresponds to the exact implementation commit under verification;
- a material browser finding actually causes REPAIR rather than being merely reported;
- the repaired implementation produces a new authorized deployment and stale prior browser evidence is not reused;
- fresh VERIFY and fresh REVIEW occur after repair;
- `DEPLOY` authority was explicitly granted for the preview/test environment before autonomous deploy/redeploy actions occurred.

If the ChatGPT/app surface forces per-action confirmation and it cannot be safely configured away, report `BLOCKED_PLATFORM_AUTONOMY` and do not claim `CHATGPT_LOOP_READY`.

If plan/workspace/region/plugin availability prevents the app from being invoked on the target ChatGPT account, report the exact external platform gate separately. That does not invalidate `RUNTIME_COMPLETE`, but it prevents `CHATGPT_LOOP_READY` until the gate is resolved.

### External distribution gates

The following are tracked separately from both completion claims:

- Plugin Directory submission status;
- Plugin Directory approval;
- target-plan eligibility/Connect availability;
- app permission/confirmation options available to the target account;
- provider billing/account-owner administrative setup.

None may be silently treated as complete or inferred from runtime test results.

## Implementation Boundary

This document defines architecture and acceptance contracts only. It does not authorize implementation planning, code changes, deployment, Plugin Directory submission, billing changes, or provider credential actions.

Expected implementation package boundary remains:

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
    provenance/
    security/
    sessions/
    browser/
    tools/
  tests/
  fixtures/
  scripts/
```

Exact file decomposition, storage provider, and provider-specific provenance adapter details are implementation-plan decisions so long as they satisfy this design.
