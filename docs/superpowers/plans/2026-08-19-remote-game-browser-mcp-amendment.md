# Remote Game Browser MCP Runtime — Implementation Plan Amendment

**Applies to:** `docs/superpowers/plans/2026-08-19-remote-game-browser-mcp.md` at commit `b1a29787aa11862d4f95ec296f4e957085d6459c`.

**Status:** Normative. Executors MUST read this amendment with the base plan. Where this amendment differs, this amendment controls. It contains only self-review corrections; it does not change the approved architecture/spec.

## 1. Exact repository path convention

In Tasks 3–14 of the base plan, any unprefixed package path beginning with `src/`, `tests/`, `scripts/`, `sandbox/`, or `fixtures/` means the exact repository path under `apps/game-browser-mcp/`.

Examples:

```text
src/provenance/types.ts
=> apps/game-browser-mcp/src/provenance/types.ts

tests/provenance.test.ts
=> apps/game-browser-mcp/tests/provenance.test.ts

scripts/run-remote-acceptance.ts
=> apps/game-browser-mcp/scripts/run-remote-acceptance.ts

sandbox/worker.mjs
=> apps/game-browser-mcp/sandbox/worker.mjs

fixtures/game/index.html
=> apps/game-browser-mcp/fixtures/game/index.html
```

Root paths such as `.github/workflows/*`, `README.md`, `AGENTS.md`, `protocol/*`, and `skills/*` remain root-relative exactly as written.

## 2. Concrete durable registration store

Task 3 defines the `RegistrationStore` contract and uses a test-only `MemoryRegistrationStore` for TDD. Production registration persistence MUST NOT remain in memory.

Task 5 additionally creates:

```text
apps/game-browser-mcp/src/provenance/upstash-registration-store.ts
```

with:

```ts
export class UpstashRegistrationStore implements RegistrationStore {
  constructor(private readonly redis: Redis) {}
  put(registration: TargetRegistration): Promise<void>;
  get(id: string): Promise<TargetRegistration | null>;
}
```

Required behavior:

- key: `gbr:registration:<target_registration_id>`;
- value: validated serialized `TargetRegistration`;
- expiry: registration `expires_at` plus only the bounded diagnostic/retry grace allowed by configuration;
- `put` rejects overwrite of an existing ID with different content;
- `get` revalidates the stored object through `TargetRegistrationSchema` before returning it;
- malformed stored data fails closed as a runtime/storage error, never as a valid target;
- the production dependency graph wires `UpstashRegistrationStore`, never `MemoryRegistrationStore`.

Add these assertions to `apps/game-browser-mcp/tests/provenance.test.ts` and `apps/game-browser-mcp/tests/session-store.test.ts` before implementing the production store.

## 3. Reconciled file map additions

The base file map also includes these exact files required by later tasks:

```text
apps/game-browser-mcp/src/mcp.ts
apps/game-browser-mcp/src/provenance/upstash-registration-store.ts
apps/game-browser-mcp/tests/auth.test.ts
apps/game-browser-mcp/tests/skill-package.test.ts
```

No runtime file is added under `protocol/`, root `src/`, or root `bin/`.

## 4. Server-owned project trust configuration

V1 uses one explicit server-owned project trust configuration assembled from environment variables; model/page content cannot change it.

Task 2 `env.ts` and Task 15 documentation must include these names in addition to the base plan's environment list:

```text
TARGET_PROJECT_ID
TARGET_REPOSITORY_OWNER
TARGET_REPOSITORY_NAME
APPROVED_DEPLOYMENT_HOST_PATTERNS
APPROVED_DEPENDENCY_HOSTS
APPROVED_REDIRECT_HOSTS
```

Rules:

- comma-separated host lists are parsed once at startup, normalized to lowercase ASCII hostnames, deduplicated, and validated;
- empty dependency/redirect lists are allowed;
- broad provider-wide deployment wildcards are rejected as authorization by themselves; they are only discovery constraints and concrete deployments still require provider provenance;
- project/repository identity used by registration comes from this server-owned config, not the registration request body;
- the registration request sends only deployment ID and expected commit SHA plus any non-authoritative correlation ID needed for logging.

`VERCEL_TARGET_PROJECT_ID` from the base plan is replaced by `TARGET_PROJECT_ID` to avoid duplicate sources of project identity. The Vercel provider verifier compares provider-returned project ID to `TARGET_PROJECT_ID`.

## 5. Task ordering clarification

The dependency order is:

```text
Task 1 package/CI
-> Task 2 contracts/env
-> Task 3 provenance contracts + memory registration store
-> Task 4 network policy
-> Task 5 Upstash session + production registration stores
-> Task 6 browser abstraction
-> Task 7 Vercel Sandbox adapter
-> Task 8 tool services
-> Task 9 MCP transport
-> Tasks 10-15 acceptance/security/deployment/package/docs
-> Task 16 RUNTIME_COMPLETE
-> Task 17 CHATGPT_LOOP_READY
```

Task 3 is therefore testable without Redis, while Task 5 closes the production failover requirement before any live MCP runtime is considered complete.

## 6. Self-review result

After applying this amendment:

- exact path ambiguity: CLOSED;
- missing production `RegistrationStore`: CLOSED;
- missing file-map entries: CLOSED;
- project trust configuration source: CLOSED;
- root UAL zero-runtime-dependency boundary: unchanged;
- approved spec semantics: unchanged;
- implementation plan is ready to execute task-by-task with TDD.
