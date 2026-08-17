#!/bin/sh
# Install the UAL OpenCode adapter as a global skill.
#
# - Copies SKILL.md into ~/.agents/skills/universal-agent-loop/
#   (the agent-compatible global location OpenCode discovers; see
#   https://opencode.ai/docs/skills/).
# - Writes PROTOCOL_HOME pointing at this canonical checkout.
# - Never touches opencode.json or any other skill.
# - Refuses to overwrite an existing directory that was not installed by
#   this script, unless --force is passed.
set -eu

SKILL_DIR="${UAL_SKILL_DIR:-$HOME/.agents/skills/universal-agent-loop}"
SCRIPT_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
UAL_HOME=$(CDPATH='' cd -- "$SCRIPT_DIR/../.." && pwd)
FORCE=0
[ "${1:-}" = "--force" ] && FORCE=1

if [ -d "$SKILL_DIR" ] && [ ! -f "$SKILL_DIR/PROTOCOL_HOME" ] && [ "$FORCE" -ne 1 ]; then
  echo "refusing to overwrite existing $SKILL_DIR (no PROTOCOL_HOME marker); pass --force" >&2
  exit 1
fi

mkdir -p "$SKILL_DIR"
cp "$SCRIPT_DIR/SKILL.md" "$SKILL_DIR/SKILL.md"
printf '%s\n' "$UAL_HOME" > "$SKILL_DIR/PROTOCOL_HOME"

# Sanity: engine must run.
node "$UAL_HOME/bin/agent-loop.js" capabilities >/dev/null

echo "installed: $SKILL_DIR/SKILL.md"
echo "protocol home: $UAL_HOME"
