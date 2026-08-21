# GPT Action Game-Browser Bridge — Implementation Plan

Date: 2026-08-21
Design: `docs/superpowers/specs/2026-08-21-gpt-action-game-browser-bridge-design.md`

## Objective

Expose the existing bounded remote game-browser runtime through the saved Custom GPT's existing Action integration without broadening browser authority or weakening exact-deployment provenance.

## Work sequence

### 1. TDD: Action bridge contract

Add root tests that define:

- six fixed `/game-browser/*` OpenAPI operations and operation IDs;
- existing Action bearer requirement and non-consequential flags;
- fail-closed bridge configuration;
- fixed upstream origin/path behavior;
- dedicated bridge-token forwarding;
- bounded JSON proxying;
- screenshot base64 stripping plus explicit missing-image transport metadata;
- upstream body/secret non-disclosure;
- explicit untrusted-evidence/outer-authority descriptions on every browser Action operation.

These tests should fail before implementation.

### 2. Implement Action proxy

Add `apps/gpt-action-api/src/game-browser-control.mjs` with:

- strict HTTPS origin parsing for `GAME_BROWSER_RUNTIME_BASE_URL`;
- dedicated `GAME_BROWSER_BRIDGE_TOKEN` configuration;
- fixed method/path map for the six game operations;
- JSON object validation and bounded payload/response handling;
- runtime error mapping;
- recursive observation projection that removes screenshot base64 bytes.

Keep the already-reviewed core `apps/gpt-action-api/src/app.mjs` unchanged. Add `apps/gpt-action-api/src/action-router.mjs` as the Production composition layer that:

- reuses the core Action authentication boundary before any `/game-browser/*` call;
- augments the public OpenAPI document with the six browser paths/schemas and target-content trust boundary;
- delegates all existing skill/GitHub paths to the core unchanged.

Update `apps/gpt-action-api/api/index.mjs` to use that composed router. This makes the deployed server entrypoint exercise the bridge while retaining direct unit coverage of the existing core implementation.

### 3. TDD: runtime private bridge

Add game-browser package tests covering:

- optional bridge configuration;
- constant-time bearer rejection behavior;
- stable bridge principal ownership across separate requests;
- exact six-route surface;
- existing service-level validation still applies;
- no generic operation/URL passthrough.

### 4. TDD: exact deployment discovery

Add provider tests for bounded discovery:

- list only the configured Vercel project;
- inspect at most 20 deployments;
- exact repository owner/name and 40-char SHA match;
- ignore non-READY/mismatched candidates;
- re-run existing immutable deployment verification for the selected `dpl_...` ID;
- return `STALE_DEPLOYMENT` when no candidate qualifies;
- never create/redeploy a provider resource.

### 5. Implement runtime bridge

Refactor production service construction minimally so MCP and private bridge calls share the same existing game service implementation.

Add:

- optional `GPT_ACTION_BRIDGE_TOKEN` parsing;
- stable bridge principal binding derived from a domain-separated hash of the token;
- `/internal/gpt-action/session-start|observe|input|read-state|reset|session-end` JSON handlers;
- session-start exact deployment discovery + short-lived registration before invoking existing `sessionStart`;
- bounded RuntimeError-to-HTTP mapping.

Keep `/mcp`, `/internal/registrations`, `/fixture`, and `/healthz` behavior backward compatible.

### 6. Hermetic verification

Require current exact-head evidence for:

```text
npm test
npm test --prefix apps/game-browser-mcp
npm run typecheck --prefix apps/game-browser-mcp
npm run build --prefix apps/game-browser-mcp
```

Also require current `game-browser-provider-preflight` success.

### 7. Preview/runtime verification

If repository automation creates exact-head Vercel Preview deployments without a separate production mutation, verify:

- GPT Action Preview `/openapi.json` contains all six browser operations;
- unauthenticated browser Action calls return 401;
- missing bridge Production/Preview configuration returns bounded 503 rather than breaking the existing API.

Do not mutate Production credentials or deploy Production as part of this plan without separate authority.

### 8. Review

Freeze the exact PR head and run fresh two-axis review:

- **Standards**: security boundary, secret handling, input/output bounds, architecture isolation, regression risk, test quality.
- **Spec**: every accepted bridge/design requirement, especially fixed target policy, exact SHA provenance, no arbitrary browser proxy, and explicit image-capability limitation.

Any material finding routes to repair, then fresh verification and fresh review.

### 9. Merge / activation boundary

Merge is only eligible on the exact reviewed head with current verification.

After code merge, stop at the separately gated Production activation boundary if the bridge variables are not already configured. Required activation values are server-owned only and must never be pasted into chat.

The later live activation sequence is:

1. configure the same dedicated bridge secret in both Vercel projects;
2. configure the browser runtime origin in `ual-gpt-action-api`;
3. redeploy affected Production services under explicit authority;
4. refresh the saved GPT Action schema;
5. run a real ChatGPT-originated remote session against an exact commit;
6. record whether ordinary calls are confirmation-free;
7. keep visual-only coverage blocked until safe screenshot transport is implemented.
