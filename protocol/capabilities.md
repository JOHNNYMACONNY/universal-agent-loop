# UAL Harness Capability Negotiation

Version: 1.

## 1. Principle

Adapters report actual capabilities; they never assume them. The protocol
chooses behavior according to available capabilities. Absence of an
optional capability degrades gracefully where possible.

## 2. Capability names

```text
shell             can execute shell commands
filesystem        can read/write the working tree
git               git binary available
worktrees         git worktree operations available
github_read       GitHub read access (gh/api available and authenticated)
github_write      GitHub write access (issues/PR creation possible)
browser           browser automation available
screenshots       screenshot capture available
subagents         can spawn subagents
skills            harness skill system available
mcp               MCP servers configured
network           outbound network available
ci_visibility     can observe CI results
deployment_access can trigger deployments
secret_access     secret stores reachable (reported, never exercised)
```

## 3. Rules

- C1. `agent-loop capabilities` emits a JSON object mapping each
  capability to `true | false | "unknown"`. Detection is hermetic by
  default; network-dependent probes run only with `--probe`.
- C2. Adapters MUST call capabilities detection at DISCOVER time and
  choose behavior accordingly (e.g. no `github_read` -> reconcile from
  repo-local artifacts only).
- C3. A missing optional capability never blocks states that do not
  require it. A missing required capability produces
  BLOCKED_ENVIRONMENT with the specific capability named.
