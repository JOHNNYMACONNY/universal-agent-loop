import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const reconcileWorkflowUrl = new URL('../.github/workflows/production-runtime-reconcile.yml', import.meta.url);
const statusWorkflowUrl = new URL('../.github/workflows/production-runtime-reconcile-status.yml', import.meta.url);
const reconcileWorkflow = await readFile(reconcileWorkflowUrl, 'utf8');
const statusWorkflow = await readFile(statusWorkflowUrl, 'utf8');

test('production reconcile status observer publishes a discoverable exact-run lifecycle', () => {
  assert.match(reconcileWorkflow, /^name:\s*production-runtime-reconcile\s*$/m, 'observer must bind to the canonical Production reconciler name');
  assert.match(statusWorkflow, /workflow_run:[\s\S]*workflows:\s*\['production-runtime-reconcile'\]/, 'observer must watch only the canonical reconciler');
  assert.match(statusWorkflow, /types:\s*\[in_progress,\s*completed\]/, 'observer must publish both pending and terminal lifecycle transitions');
  assert.match(statusWorkflow, /permissions:\s*\n\s+statuses:\s*write\b/, 'observer token must be limited to commit-status publication');
  assert.match(statusWorkflow, /workflow_run\.head_branch == 'main'/, 'observer must fail closed for a non-main workflow run');
  assert.match(statusWorkflow, /run\.head_branch !== 'main'/, 'runtime script must independently reject non-main runs before publication');
  assert.match(statusWorkflow, /context:\s*['"]production-runtime-reconcile['"]/, 'status context must be stable and machine-discoverable');
  for (const state of ['pending', 'success', 'failure']) {
    assert.match(statusWorkflow, new RegExp(`['"]${state}['"]`), `observer must map runs to ${state}`);
  }
  assert.match(statusWorkflow, /run\.head_sha/, 'status must bind to the exact reconcile run head SHA');
  assert.match(statusWorkflow, /actions\/runs\/\$\{run\.id\}/, 'status target URL must point to the exact reconcile Actions run');
});

test('reconcile status observer remains non-secret and non-mutating outside commit status', () => {
  assert.doesNotMatch(statusWorkflow, /secrets\./, 'observer must not receive repository or provider secrets');
  assert.doesNotMatch(statusWorkflow, /VERCEL|deploy|env run|checkout@/i, 'observer must not perform provider mutation or execute repository code');
  assert.doesNotMatch(statusWorkflow, /description[^\n]*(TOKEN|SECRET|KEY)/i, 'status descriptions must not contain credential material');
  assert.match(statusWorkflow, /github\.rest\.repos\.createCommitStatus/, 'observer authority must be limited to publishing the commit status');
});
