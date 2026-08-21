import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflowUrl = new URL('../.github/workflows/production-runtime-reconcile.yml', import.meta.url);
const workflow = await readFile(workflowUrl, 'utf8');

test('production reconciliation is durable, serialized, and main-scoped', () => {
  assert.match(workflow, /push:\s*\n\s+branches:\s*\[main\]/, 'reconciler must run from canonical main pushes');
  assert.match(workflow, /schedule:\s*\n\s+- cron:/, 'reconciler must detect drift on a schedule');
  assert.match(workflow, /workflow_dispatch:/, 'reconciler must remain manually recoverable');
  assert.match(workflow, /group:\s*gpt-action-api-production\b/, 'reconciler must share the existing Action Production mutation lock');
  assert.match(workflow, /cancel-in-progress:\s*false\b/, 'Production reconciliation must not cancel an in-flight mutation');
});

test('production env reconciliation reuses values and manages only bounded credentials', () => {
  assert.match(workflow, /env\?decrypt=true&teamId=/, 'existing Production values must be read through the documented decrypted env API');
  assert.match(workflow, /env\?upsert=true&teamId=/, 'managed values must use idempotent upsert');

  for (const key of [
    'VERCEL_API_TOKEN',
    'VERCEL_TEAM_ID',
    'TARGET_PROJECT_ID',
    'TARGET_REPOSITORY_OWNER',
    'TARGET_REPOSITORY_NAME',
    'TARGET_ENTRY_PATH',
    'APPROVED_DEPLOYMENT_HOST_PATTERNS',
    'APPROVED_DEPENDENCY_HOSTS',
    'APPROVED_REDIRECT_HOSTS',
    'REGISTRATION_CONTROL_TOKEN',
    'REGISTRATION_CAPABILITY_SECRET',
    'OWNER_BINDING_SECRET',
    'PRINCIPAL_AUDIENCE',
    'GPT_ACTION_BRIDGE_TOKEN',
    'AGENT_BROWSER_SNAPSHOT_ID',
    'AGENT_BROWSER_SNAPSHOT_FINGERPRINT',
    'GAME_BROWSER_RUNTIME_BASE_URL',
    'GAME_BROWSER_BRIDGE_TOKEN',
  ]) {
    assert.match(workflow, new RegExp(`\\b${key}\\b`), `workflow must manage ${key}`);
  }

  assert.match(workflow, /::add-mask::/, 'read/generated credentials must be masked before later steps');
  assert.match(workflow, /Protected Action credentials are read-only/, 'workflow must state the protected Action boundary');
  assert.doesNotMatch(workflow, /upsert_env[^\n]*(UAL_ACTION_API_KEY|GITHUB_TOKEN|GITHUB_CONTROL_TOKEN|GITHUB_CONTROL_OWNERS)/, 'protected Action credentials must never be upserted');
  assert.doesNotMatch(workflow, /PRODUCTION_ACTION_KEY/, 'protected Action bearer must not be copied into GitHub workflow state');
  assert.doesNotMatch(workflow, /action_key=\$\(production_value[^\n]*UAL_ACTION_API_KEY/, 'reconciler must not recover the protected Action bearer through the project-env listing');
});

test('browser runtime auth material is consumed from the effective Production environment', () => {
  assert.doesNotMatch(workflow, /echo "REGISTRATION_CONTROL_TOKEN=\$registration_control" >> "\$GITHUB_ENV"/, 'registration control token must not be copied into GitHub workflow state');
  assert.doesNotMatch(workflow, /echo "REGISTRATION_CAPABILITY_SECRET=\$registration_capability" >> "\$GITHUB_ENV"/, 'registration capability secret must not be copied into GitHub workflow state');
  assert.doesNotMatch(workflow, /echo "OWNER_BINDING_SECRET=\$owner_binding" >> "\$GITHUB_ENV"/, 'owner binding secret must not be copied into GitHub workflow state');
  assert.match(
    workflow,
    /name:\s*Register exact browser Production deployment[\s\S]*VERCEL_PROJECT_ID="\$BROWSER_PROJECT_ID"[\s\S]*vercel@59\.1\.4 env run --environment production[\s\S]*register-vercel-deployment\.ts/,
    'registration must use the browser project effective Production environment',
  );
  assert.match(
    workflow,
    /name:\s*Issue short-lived Production acceptance principal[\s\S]*VERCEL_PROJECT_ID="\$BROWSER_PROJECT_ID"[\s\S]*vercel@59\.1\.4 env run --environment production[\s\S]*issue-test-principal\.ts/,
    'acceptance principal issuance must use the browser project effective Production environment',
  );
});

test('browser snapshot is reused only while implementation and provider lifetime remain valid', () => {
  assert.match(workflow, /AGENT_BROWSER_VERSION:\s*0\.34\.0/, 'browser version must remain pinned');
  assert.match(workflow, /sandbox\/worker\.mjs/, 'worker implementation must participate in snapshot fingerprint');
  assert.match(workflow, /sandbox\/persistent-lock\.mjs/, 'persistent lock implementation must participate in snapshot fingerprint');
  assert.match(workflow, /create-browser-snapshot\.ts/, 'snapshot builder must participate in snapshot fingerprint');
  assert.match(workflow, /sha256sum/, 'snapshot inputs must be hashed deterministically');
  assert.match(workflow, /AGENT_BROWSER_SNAPSHOT_FINGERPRINT/, 'snapshot fingerprint must be persisted');
  assert.match(workflow, /snapshot_id=.*AGENT_BROWSER_SNAPSHOT_ID/, 'existing snapshot ID must be considered for reuse');
  assert.match(workflow, /\/v2\/sandboxes\/snapshots\/\$snapshot_id/, 'stored snapshot existence must be checked through the provider API');
  assert.match(workflow, /3 \* 24 \* 60 \* 60 \* 1000/, 'snapshot must refresh before the final three days of its lifetime');
  assert.match(workflow, /scripts\/create-browser-snapshot\.ts/, 'a stale/missing snapshot must be rebuilt through the canonical builder');
});

test('production deployments are exact-main and verified rather than blind redeploys', () => {
  assert.match(workflow, /actions\/checkout@v4[\s\S]*ref:\s*main/, 'Production checkout must explicitly use main');
  assert.match(workflow, /vercel@59\.1\.4 deploy --prod/, 'Production deploy must use the pinned Vercel CLI');
  assert.match(workflow, /githubCommitSha/, 'provider Git SHA must be inspected');
  assert.match(workflow, /projectId/, 'provider project identity must be inspected');
  assert.match(workflow, /target[^\n]*production/, 'provider Production target must be checked');
  assert.match(workflow, /READY/, 'provider readiness must be checked');
  assert.doesNotMatch(workflow, /\bredeploy\b/i, 'workflow must not recreate a stale deployment source through Redeploy');
});

test('production acceptance proves runtime, OpenAPI, gameplay, and bounded bridge continuity', () => {
  assert.match(workflow, /id:\s*browser_health\b/, 'browser stable health must have an evidence-bearing step id');
  assert.match(workflow, /id:\s*action_health\b/, 'Action stable health must have an evidence-bearing step id');
  assert.match(workflow, /id:\s*action_openapi\b/, 'Action OpenAPI must have an evidence-bearing step id');
  assert.match(workflow, /id:\s*gameplay\b/, 'provider-backed gameplay must have an evidence-bearing step id');
  assert.match(workflow, /\/healthz/, 'browser stable health must be verified');
  assert.match(workflow, /\/openapi\.json/, 'Action OpenAPI must be verified');
  assert.match(workflow, /jq -r '\.ok \/\/ false'/, 'health gates must validate the response body, not HTTP status alone');
  for (const operation of [
    'startGameQaSession',
    'observeGameQaSession',
    'sendGameQaInput',
    'readGameQaState',
    'resetGameQaSession',
    'endGameQaSession',
  ]) assert.match(workflow, new RegExp(operation), `OpenAPI must expose ${operation}`);
  assert.match(workflow, /npm run test:remote/, 'provider-backed Canvas gameplay acceptance is required');
  assert.match(workflow, /vercel@59\.1\.4 env run[\s\S]*--environment production/, 'bridge smoke must inject the actual Action Production environment only into its subprocess');
  assert.match(workflow, /UAL_ACTION_API_KEY/, 'bridge smoke must authenticate with the existing protected Action bearer');
  assert.match(workflow, /\/game-browser\/session-start/, 'bridge smoke must start a real bounded session');
  assert.match(workflow, /\/game-browser\/observe/, 'bridge smoke must observe the session');
  assert.match(workflow, /\/game-browser\/session-end/, 'bridge smoke must release the session');
  assert.match(workflow, /if:\s*always\(\)/, 'evidence/cleanup must survive acceptance failure');
});

test('reconciler records acceptance outcomes without expanding authority', () => {
  assert.match(workflow, /production-runtime-reconcile-evidence\.json/, 'non-secret evidence must be persisted');
  for (const outcome of [
    'BROWSER_HEALTH_OUTCOME',
    'ACTION_HEALTH_OUTCOME',
    'ACTION_OPENAPI_OUTCOME',
    'GAMEPLAY_OUTCOME',
    'BRIDGE_OUTCOME',
  ]) assert.match(workflow, new RegExp(`\\b${outcome}\\b`), `evidence must record ${outcome}`);
  assert.match(workflow, /browserHealthOutcome:/, 'artifact must expose browser health outcome');
  assert.match(workflow, /actionHealthOutcome:/, 'artifact must expose Action health outcome');
  assert.match(workflow, /actionOpenApiOutcome:/, 'artifact must expose Action OpenAPI outcome');
  assert.match(workflow, /gameplayOutcome:/, 'artifact must expose provider-backed gameplay outcome');
  assert.match(workflow, /bridgeOutcome:/, 'artifact must expose bridge-smoke outcome');
  assert.doesNotMatch(workflow, /\bvercel(?:@[^ ]+)?\s+buy\b/i, 'reconciler must never alter billing');
  assert.doesNotMatch(workflow, /firewall rules add/, 'Production reconciliation must not silently broaden provider security policy');
  assert.doesNotMatch(workflow, /\/v9\/projects\/[^\s]+\/branch/, 'workflow must not depend on undocumented Production-branch mutation APIs');
});
