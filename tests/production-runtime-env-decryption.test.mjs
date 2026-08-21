import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflowUrl = new URL('../.github/workflows/production-runtime-reconcile.yml', import.meta.url);
const workflow = await readFile(workflowUrl, 'utf8');

test('Production reconciliation resolves actual environment values by variable ID', () => {
  assert.match(
    workflow,
    /\/v1\/projects\/\$project_id\/env\/\$env_id\?teamId=\$VERCEL_TEAM_ID/,
    'Production values must be read through Vercel’s per-variable decrypted-value endpoint',
  );
  assert.match(
    workflow,
    /decrypted=\$\(jq -r '\.decrypted \/\/ false'/,
    'decrypted-value reads must fail closed unless Vercel confirms decryption',
  );
  assert.doesNotMatch(
    workflow,
    /jq -r 'if \. == null then "" elif \(\.value \| type\) == "string" then \.value else "" end' <<<"\$record"/,
    'list metadata must not be reused as plaintext secret material',
  );
});

test('all reusable Production values are resolved in the owning project context', () => {
  for (const call of [
    'production_value "$BROWSER_PROJECT_ID" "$browser_env" GPT_ACTION_BRIDGE_TOKEN',
    'production_value "$ACTION_PROJECT_ID" "$action_env" GAME_BROWSER_BRIDGE_TOKEN',
    'production_value "$BROWSER_PROJECT_ID" "$browser_env" AGENT_BROWSER_SNAPSHOT_ID',
    'production_value "$BROWSER_PROJECT_ID" "$browser_env" AGENT_BROWSER_SNAPSHOT_FINGERPRINT',
  ]) {
    assert.ok(workflow.includes(call), `workflow must use project-scoped decrypted read: ${call}`);
  }

  assert.match(
    workflow,
    /stable_secret "\$BROWSER_PROJECT_ID" "\$browser_env" REGISTRATION_CONTROL_TOKEN/,
    'stable generated secrets must reuse the actual browser Production value rather than list ciphertext',
  );
});
