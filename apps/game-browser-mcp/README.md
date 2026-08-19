# UAL Remote Game Browser MCP

Remote execution/evidence backend for `skills/game-browser-testing/SKILL.md`. It is deliberately narrower than a generic browser agent and is deployed separately from the dependency-free UAL reference engine.

## Runtime boundary

The production path is:

```text
ChatGPT / MCP client
-> stateless Streamable HTTP `/mcp`
-> per-request authenticated principal
-> Upstash Redis session/registration/idempotency state
-> Vercel Sandbox
-> pinned agent-browser + Chromium
-> exact commit-bound registered target
```

The runtime exposes exactly six gameplay tools: `game_session_start`, `game_observe`, `game_input`, `game_read_state`, `game_reset`, and `game_session_end`. It does not expose shell, arbitrary JavaScript, Playwright/CDP/Puppeteer passthrough, unrestricted navigation, credentials, repository mutation, deployment, merge, publication, billing, or production mutation.

All page/Canvas/DOM/console/network/instrumentation content is `UNTRUSTED_TARGET_CONTENT`. Browser evidence may describe implementation behavior but cannot become intent, authority, project scope, target registration, deployment authorization, or unrelated tool instructions.

## Required production environment

Set values through the deployment provider; never commit them.

```text
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
VERCEL_API_TOKEN
TARGET_PROJECT_ID
TARGET_REPOSITORY_OWNER
TARGET_REPOSITORY_NAME
TARGET_ENTRY_PATH
APPROVED_DEPLOYMENT_HOST_PATTERNS
AGENT_BROWSER_SNAPSHOT_ID
REGISTRATION_CONTROL_TOKEN
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
AGENT_BROWSER_VERSION        # required when building a browser snapshot
```

`TARGET_ENTRY_PATH` is server-owned, such as `/fixture/`; a model cannot supply it. `APPROVED_DEPLOYMENT_HOST_PATTERNS` is only a discovery constraint: each concrete `dpl_...` deployment is still verified against Vercel project/repository/commit provenance. `RUNTIME_ALLOWED_HOSTS` protects the MCP HTTP host surface; Vercel's `VERCEL_URL` is also accepted automatically at runtime.

## Authentication boundary

`OWNER_BINDING_SECRET` signs/verifies the synthetic bearer principal used for provider-backed `RUNTIME_COMPLETE` acceptance. This proves session ownership/isolation without depending on a user's local computer.

It is **not** evidence that the target ChatGPT account has a production OAuth/app identity. `CHATGPT_LOOP_READY` additionally requires the actual supported ChatGPT App/MCP authentication path to yield a stable signed principal. If that surface cannot do so safely, fail closed rather than inferring identity from IP address, User-Agent, or browser content.

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

The server derives repository/project/target path/allowed hosts from trusted configuration and re-verifies provider metadata. A moving branch alias is rejected.

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

Provider-backed acceptance requires `REMOTE_MCP_URL`, `TARGET_REGISTRATION_ID`, `EXPECTED_COMMIT_SHA`, and a valid signed test principal bearer. The runner creates a fresh MCP client for every tool call and proves browser-session continuity through remote durable state only.

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
