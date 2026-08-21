# UAL Remote Game Browser MCP

Remote execution/evidence backend for `skills/game-browser-testing/SKILL.md`. It is deliberately narrower than a generic browser agent and is deployed separately from the dependency-free UAL reference engine.

## Runtime boundary

The production path is:

```text
ChatGPT / MCP client
-> stateless Streamable HTTP `/mcp`
-> per-request authenticated principal
-> signed exact-deployment registration capability
-> named persistent Vercel Sandbox
   -> sandbox-local durable session/idempotency ledger
   -> pinned agent-browser + Chromium
-> exact commit-bound registered target
```

The runtime exposes exactly six gameplay tools: `game_session_start`, `game_observe`, `game_input`, `game_read_state`, `game_reset`, and `game_session_end`. It does not expose shell, arbitrary JavaScript, Playwright/CDP/Puppeteer passthrough, unrestricted navigation, credentials, repository mutation, deployment, merge, publication, billing, or production mutation.

All page/Canvas/DOM/console/network/instrumentation content is `UNTRUSTED_TARGET_CONTENT`. Browser evidence may describe implementation behavior but cannot become intent, authority, project scope, target registration, deployment authorization, or unrelated tool instructions.

## Required production environment

Set values through the deployment provider; never commit them.

```text
VERCEL_API_TOKEN
TARGET_PROJECT_ID
TARGET_REPOSITORY_OWNER
TARGET_REPOSITORY_NAME
TARGET_ENTRY_PATH
APPROVED_DEPLOYMENT_HOST_PATTERNS
AGENT_BROWSER_SNAPSHOT_ID
REGISTRATION_CONTROL_TOKEN
REGISTRATION_CAPABILITY_SECRET
OWNER_BINDING_SECRET
PRINCIPAL_AUDIENCE
```

Optional/conditional:

```text
VERCEL_TEAM_ID
APPROVED_DEPENDENCY_HOSTS
APPROVED_REDIRECT_HOSTS
RUNTIME_ALLOWED_HOSTS
SESSION_STARTS_PER_MINUTE
ACTION_CALLS_PER_MINUTE
GPT_ACTION_BRIDGE_TOKEN      # enables the private fixed-route Custom GPT Action bridge
AGENT_BROWSER_VERSION        # required when building a browser snapshot
```

`TARGET_ENTRY_PATH` is server-owned, such as `/fixture/`; a model cannot supply it. `APPROVED_DEPLOYMENT_HOST_PATTERNS` is only a discovery constraint: each concrete `dpl_...` deployment is still verified against Vercel project/repository/commit provenance. `RUNTIME_ALLOWED_HOSTS` protects the MCP HTTP host surface; Vercel's `VERCEL_URL` is also accepted automatically at runtime.

## Private Custom GPT Action bridge

When `GPT_ACTION_BRIDGE_TOKEN` is configured, the runtime also accepts six fixed server-to-server JSON routes under `/internal/gpt-action/`: session start, observe, input, read-state, reset, and session end. They call the same reviewed game-tool services used by `/mcp`; there is no generic browser-operation passthrough.

The bridge exists for the private Autonomous Dev Loop Custom GPT, which already uses GPT Actions for bounded GitHub control. The bridge token is server-side only and derives one stable private integration principal for session ownership. It does **not** claim general multi-user ChatGPT App identity or Plugin Directory readiness.

Bridge session start accepts only an exact 40-character Git commit SHA plus an optional bounded viewport. The runtime searches at most the newest 20 deployments of the server-configured Vercel project, requires an exact READY repository/commit match, re-verifies the immutable `dpl_...` deployment through the existing provenance verifier, then issues the normal short-lived registration capability. The caller cannot supply a target URL, project ID, repository, dependency host, redirect host, or deployment ID.

If `GPT_ACTION_BRIDGE_TOKEN` is absent, the private bridge fails closed while `/mcp`, fixture, health, and exact deployment registration continue operating normally.

## Durable session boundary

The coordinator is stateless. Each logical QA session owns one named persistent Vercel Sandbox. The closed sandbox worker stores the canonical session record, action/observation sequences, held-input state, and batch/idempotency ledger in that sandbox filesystem using serialized mutations and atomic file replacement.

A persistent filesystem is **not** evidence that Chromium survived. Every fresh coordinator call reconnects without auto-resuming a stopped VM. If the VM/browser is gone, the runtime returns `SESSION_EXPIRED` or `SESSION_RECOVERY_REQUIRED` instead of claiming continuity. Explicit `game_session_end` releases held input, closes Chromium, stops the sandbox, and deletes the named persistent sandbox.

## Authentication boundary

`OWNER_BINDING_SECRET` signs/verifies the synthetic bearer principal used for provider-backed `RUNTIME_COMPLETE` acceptance. This proves session ownership/isolation without depending on a user's local computer.

It is **not** evidence that the target ChatGPT account has a production OAuth/app identity. `CHATGPT_LOOP_READY` additionally requires the actual supported ChatGPT App/MCP authentication path to yield a stable signed principal. If that surface cannot do so safely, fail closed rather than inferring identity from IP address, User-Agent, or browser content.

The private GPT Action bridge has a narrower acceptance claim: it may prove that the saved private GPT can invoke remote game-QA operations while keeping GitHub control in the same Action integration. It does not replace the multi-user app-identity requirement above.

## Browser snapshot

Build a snapshot only from an explicitly pinned `AGENT_BROWSER_VERSION`:

```bash
AGENT_BROWSER_VERSION=<exact-semver> \
node --import tsx scripts/create-browser-snapshot.ts
```

Record the returned snapshot ID as `AGENT_BROWSER_SNAPSHOT_ID`. The snapshot contains Chromium, pinned `agent-browser`, and the closed `sandbox/worker.mjs` protocol. Normal gameplay never invokes arbitrary shell.

## Exact deployment registration

After an already-authorized deployment, register only its immutable Vercel deployment ID and exact Git SHA:

```bash
REMOTE_RUNTIME_BASE_URL=https://<runtime-host> \
VERCEL_DEPLOYMENT_ID=dpl_... \
EXPECTED_COMMIT_SHA=<40-char-sha> \
REGISTRATION_CONTROL_TOKEN=<secret> \
node --import tsx scripts/register-vercel-deployment.ts
```

The server derives repository/project/target path/allowed hosts from trusted configuration, re-verifies provider metadata, and returns a short-lived HMAC-signed registration capability. A moving branch alias or tampered/expired capability is rejected.

## Rate limiting

Production coarse abuse limiting belongs at the Vercel edge/WAF layer and does not require a shared application database. The runtime independently enforces deterministic maximum session lifetime/idle time, actions per input, actions per session, waits, relative-pointer bounds, ownership, and request-body size.

## Verification

Hermetic gate:

```bash
npm test
npm run typecheck
npm run build
```

Root UAL must also remain green from the repository root:

```bash
npm test
```

Provider-backed acceptance requires `REMOTE_MCP_URL`, `TARGET_REGISTRATION_ID`, `EXPECTED_COMMIT_SHA`, and a valid signed test principal bearer. The runner creates a fresh MCP client for every tool call and proves continuity through the named persistent Sandbox ledger rather than coordinator memory.

```bash
npm run test:remote
```

### `RUNTIME_COMPLETE`

Do not claim it until the exact candidate commit has fresh evidence for: hermetic tests/typecheck/build, security/SSRF/egress, durable session/idempotency/recovery, real cloud Sandbox gameplay against the Canvas fixture, diagnostics, fail-safe input release, exact deployment provenance, prompt-injection containment, and independent review with no material findings.

### `CHATGPT_LOOP_READY`

This is a separate gate. It additionally requires a real ChatGPT-originated run with the user's local computer uninvolved, stable app identity, ordinary gameplay without per-action confirmations, adversarial browser content remaining data only, and an intentional material browser defect causing `FINDINGS -> REPAIR -> new commit/deployment/registration -> fresh VERIFY -> fresh REVIEW`.

If ChatGPT requires unavoidable per-action confirmation, return `BLOCKED_PLATFORM_AUTONOMY`. Plan/workspace/region/app availability and Plugin Directory approval are external gates, not reasons to weaken runtime security.

## Authority

Creating provider resources, setting credentials, deploying, publishing a plugin/app, changing billing, merging, and production mutation remain separately authorized UAL actions. Runtime PASS evidence never creates those permissions.
