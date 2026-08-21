# Production Runtime Reconciliation — Design

Date: 2026-08-21
Status: approved implementation design

## Goal

Keep the private Autonomous Dev Loop GPT's GitHub control plane and remote game-browser runtime continuously deployable from canonical `main` without manual Vercel environment repair.

## Source of truth

- Repository: `JOHNNYMACONNY/universal-agent-loop`
- Canonical branch: `main`
- Vercel team: `team_3LfEMNVsAEbXKLoCrnzXQzrF`
- Browser project: `prj_bU062HqgwiUYUtMuX4nRN0GpXRd9` (`ual-game-browser-mcp`)
- Action project: `prj_80jo2dodxOmSSvX6muUc7Tc7wIo1` (`ual-gpt-action-api`)
- Existing repository secret `VERCEL_TOKEN` is the only bootstrap credential required by the reconciler.

The reconciler must never print credential values or commit them to Git.

## Durable reconciliation model

Add one GitHub Actions workflow that runs on relevant pushes to `main`, on a daily schedule, and by manual dispatch.

Each run:

1. checks out exact `main` and records the candidate SHA;
2. validates the existing Vercel bootstrap token;
3. reads current Production environment variables using Vercel's documented project environment API with `decrypt=true`;
4. reuses readable Production secrets instead of rotating them;
5. replaces missing or unreadable legacy secret values once with encrypted project variables, then reuses them on future runs;
6. upserts all required browser runtime configuration;
7. ensures both projects share one stable bridge token;
8. reuses a browser Sandbox snapshot while its input fingerprint remains current, otherwise creates a new pinned snapshot;
9. deploys exact canonical `main` to Production only when configuration changed, the current Production SHA differs, or health is not green;
10. verifies exact deployment project/SHA/target/state metadata;
11. verifies stable health/OpenAPI surfaces;
12. performs provider-backed Canvas acceptance against the exact browser deployment;
13. performs a bounded Action-to-browser bridge smoke session and closes it;
14. uploads non-secret evidence.

## Secret stability

The workflow reads the latest non-branch-specific Production value for each managed key. A readable existing value is preserved. A missing or unreadable value is replaced with a newly generated 32-byte random value and stored as Vercel `encrypted`, not printed.

Managed browser secrets:

- `REGISTRATION_CONTROL_TOKEN`
- `REGISTRATION_CAPABILITY_SECRET`
- `OWNER_BINDING_SECRET`
- `GPT_ACTION_BRIDGE_TOKEN`

The same bridge value is written to the Action project as `GAME_BROWSER_BRIDGE_TOKEN`.

`VERCEL_API_TOKEN` is reconciled from the existing repository `VERCEL_TOKEN`; no second provider token is created.

Existing protected Action credentials (`UAL_ACTION_API_KEY`, `GITHUB_TOKEN`, `GITHUB_CONTROL_TOKEN`, `GITHUB_CONTROL_OWNERS`) are read-only to this workflow and must never be overwritten.

## Browser snapshot lifecycle

The snapshot is keyed by a deterministic fingerprint over:

- pinned `AGENT_BROWSER_VERSION`;
- `apps/game-browser-mcp/sandbox/worker.mjs` contents;
- `apps/game-browser-mcp/scripts/create-browser-snapshot.ts` contents.

Production stores:

- `AGENT_BROWSER_SNAPSHOT_ID`
- `AGENT_BROWSER_SNAPSHOT_FINGERPRINT`

If both are present and the fingerprint matches, the existing snapshot is reused. Otherwise the workflow mints a project-scoped Vercel OIDC token, builds a fresh pinned snapshot, and persists the new ID/fingerprint.

## Managed browser Production configuration

Plain values are reconciled to:

```text
VERCEL_TEAM_ID=team_3LfEMNVsAEbXKLoCrnzXQzrF
TARGET_PROJECT_ID=prj_bU062HqgwiUYUtMuX4nRN0GpXRd9
TARGET_REPOSITORY_OWNER=JOHNNYMACONNY
TARGET_REPOSITORY_NAME=universal-agent-loop
TARGET_ENTRY_PATH=/fixture/
APPROVED_DEPLOYMENT_HOST_PATTERNS=*.vercel.app
APPROVED_DEPENDENCY_HOSTS=
APPROVED_REDIRECT_HOSTS=
PRINCIPAL_AUDIENCE=game-browser-mcp
```

`RUNTIME_ALLOWED_HOSTS` remains optional because the runtime accepts Vercel's injected `VERCEL_URL`.

## Managed Action Production configuration

Only bridge-specific keys are managed:

```text
GAME_BROWSER_RUNTIME_BASE_URL=https://ual-game-browser-mcp.vercel.app
GAME_BROWSER_BRIDGE_TOKEN=<shared browser bridge secret>
```

The workflow must not mutate unrelated Action credentials.

## Deployment policy

The workflow uses authenticated Vercel CLI Production deploys from the exact checked-out `main` tree and verifies returned provider metadata. It does not use an old deployment's Redeploy action, moving aliases as evidence, or an undocumented production-branch API.

A Production deployment is required when:

- managed environment configuration changed;
- the latest Production deployment is not READY;
- the latest Production Git SHA is not the candidate SHA;
- the stable health endpoint is not green.

Otherwise scheduled reconciliation may reuse the already-correct Production deployment.

## Acceptance gates

Browser Production must pass:

- exact project/repository/SHA/Production/READY provider metadata;
- stable `/healthz` HTTP 200 with `{ "ok": true }`;
- exact-deployment registration capability;
- provider-backed `npm run test:remote` Canvas gameplay acceptance using a short-lived signed principal.

Action Production must pass:

- stable `/health` HTTP 200;
- `/openapi.json` HTTP 200;
- all six game-browser operation IDs present;
- existing canonical skill and GitHub control operations remain present.

Bridge smoke must:

- authenticate with the existing Production Action key read from Vercel;
- start a session for the exact candidate SHA;
- observe the created session;
- end the session even if the observation assertion fails;
- reject any claim of visual QA PASS from Action JSON screenshot transport alone.

## Failure behavior

The workflow fails closed on missing `VERCEL_TOKEN`, invalid provider responses, missing protected Action credentials, snapshot creation failure, deployment provenance mismatch, unhealthy stable endpoints, gameplay acceptance failure, or bridge failure.

No billing change, repository settings mutation, release publication, secret disclosure, arbitrary browser proxy, or target-scope broadening is authorized by this reconciler.

## Long-term operation

The daily schedule detects environment drift even without a source change. Relevant `main` pushes reconcile immediately. Secret and snapshot reuse avoids unnecessary rotation and provider resource churn. A failed reconciliation leaves explicit workflow evidence and never silently downgrades verification requirements.
