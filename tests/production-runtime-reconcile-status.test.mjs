import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflowUrl = new URL('../.github/workflows/production-runtime-reconcile.yml', import.meta.url);
const workflow = await readFile(workflowUrl, 'utf8');

test('production reconciler publishes a discoverable exact-run commit status lifecycle', () => {
  assert.match(workflow, /permissions:[\s\S]*statuses:\s*write\b/, 'reconciler must have bounded permission to publish commit statuses');
  assert.match(workflow, /context[^\n]*production-runtime-reconcile/, 'status context must be stable and machine-discoverable');
  assert.match(workflow, /state[^\n]*pending/, 'reconciler must publish pending before Production work begins');
  assert.match(workflow, /state[^\n]*(success|failure)/, 'reconciler must publish a terminal status');
  assert.match(workflow, /github\.run_id/, 'status target must identify the exact workflow run');
  assert.match(workflow, /actions\/runs\/\$\{\{\s*github\.run_id\s*\}\}/, 'status target URL must point to the exact GitHub Actions run');
  assert.match(workflow, /steps\.candidate\.outputs\.candidate_sha/, 'status must bind to the exact canonical candidate SHA');
  assert.match(workflow, /if:\s*always\(\)/, 'terminal status must still publish after an acceptance failure');
});

test('reconcile status publication does not expose secrets or expand deployment authority', () => {
  assert.doesNotMatch(workflow, /description[^\n]*(TOKEN|SECRET|KEY)/i, 'status descriptions must not contain credential material');
  assert.doesNotMatch(workflow, /target_url[^\n]*vercel/i, 'status discovery target must remain the GitHub Actions run, not an arbitrary provider URL');
});
