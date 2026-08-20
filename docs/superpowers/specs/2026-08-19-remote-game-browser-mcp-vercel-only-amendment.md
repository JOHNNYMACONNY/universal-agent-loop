# Remote Game Browser MCP — Vercel-Only Architecture Amendment

Date: 2026-08-19
Status: normative amendment to `2026-08-19-remote-game-browser-mcp-design.md`

## Decision

Remove Redis/Upstash as a required runtime dependency. Preserve every accepted security, provenance, idempotency, recovery, authority, and autonomy invariant by making each named **persistent Vercel Sandbox** the authoritative per-session durable state container.

The resulting v1 runtime is:

```text
ChatGPT Web
-> stateless Vercel MCP coordinator
-> signed registration capability + authenticated principal
-> named persistent Vercel Sandbox
   -> closed worker protocol
   -> Chromium / agent-browser
   -> sandbox-local durable session + batch ledger
-> exact commit-bound deployed game
```

No local computer, localhost, tunnel, local browser, desktop daemon, local coding agent, or external Redis service is required.

## Normative overrides

### Session durability

The original requirement for remotely durable session metadata remains, but the implementation provider is now the persistent Sandbox filesystem. `session_id` remains opaque and unguessable. The sandbox name is derived server-side from the logical session ID and is never accepted from target content.

Every MCP call may land on a new coordinator instance. It reconnects with `Sandbox.get({ name, resume: false })` or the equivalent non-resuming lookup, validates the current VM/browser state, and uses the sandbox worker for all ledger reads/mutations.

A stopped/recreated VM may restore filesystem state, but that does **not** prove Chromium survived. If the browser process is gone, return `SESSION_EXPIRED` or `SESSION_RECOVERY_REQUIRED`; never represent restored files as continuous browser state.

### Serialization and idempotency

The sandbox worker is the single authoritative mutation boundary. All ledger mutations use a sandbox-local cross-process lock plus atomic temp-file/rename persistence. The ledger owns:

- `SessionRecord` fields;
- pending batch ID;
- completed `action_batch_id` results;
- action and observation sequences;
- total action count;
- held keys/buttons;
- lifecycle/recovery reason;
- browser-side batch state.

Concurrent coordinator requests cannot both advance a sequence. Duplicate completed batches return the recorded result and never replay input. Ambiguous accepted-but-unproven execution forces recovery-required.

### Registration durability

Replace the Redis `RegistrationStore` in production with a short-lived HMAC-signed registration capability. The capability contains the provider-verified `TargetRegistration` payload and expiry. The registration/control endpoint still accepts only immutable deployment ID + exact commit SHA under its control token, performs live provider verification, derives all trusted hosts server-side, and returns the signed capability as `target_registration_id`.

`game_session_start` verifies the capability signature/expiry and re-verifies the immutable deployment with Vercel before browser work. Model/page content cannot mint or widen registration capabilities.

### Rate limiting

Remove Redis-backed global counters. Production coarse abuse-rate limiting is a Vercel project/WAF concern. Runtime code continues to enforce all deterministic per-session limits: maximum session lifetime/idle time, actions per input, actions per session, wait duration, relative-pointer bounds, request body size, and ownership binding. Memory rate limiting remains test-only where useful.

`RUNTIME_COMPLETE` must record the deployed Vercel rate-limit configuration or explicitly record a platform limitation; lack of Redis is not a reason to weaken session/action bounds.

### Sandbox lifecycle

Production browser sandboxes are created with persistence enabled and bounded snapshot expiration. Normal `game_session_end` releases held input, closes Chromium, stops the sandbox, and deletes the named persistent sandbox so state is not reused across sessions.

### Dependencies / secrets

Production no longer requires:

```text
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
```

`@upstash/redis`, `UpstashSessionStore`, `UpstashRegistrationStore`, and `RedisRateLimiter` are removed from production composition.

The remaining secret/config categories include Vercel provider access/identity, project/repository trust configuration, browser snapshot identity, registration-capability signing/control secrets, principal binding, and runtime host configuration.

## Acceptance additions

Before `RUNTIME_COMPLETE`:

1. hermetic tests prove a fresh coordinator instance can reconnect to the same running named sandbox and read/update the same durable ledger;
2. concurrent batch attempts serialize and at most one novel batch is accepted;
3. a duplicate completed batch is never replayed;
4. a stopped/lost browser is never silently resumed as continuous state even when the persistent filesystem is recoverable;
5. registration capability tampering/expiry fails closed;
6. production composition contains no Redis/Upstash requirement;
7. provider-backed Canvas/WebGL acceptance runs against the exact candidate commit with the user's local computer uninvolved.

All other requirements from the approved design, including browser-evidence prompt-injection containment, exact-commit provenance, deny-by-default egress, confirmation-free gameplay gate, and separation of `RUNTIME_COMPLETE` from `CHATGPT_LOOP_READY`, remain unchanged.