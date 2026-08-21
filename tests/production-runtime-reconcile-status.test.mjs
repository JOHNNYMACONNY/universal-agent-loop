import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const reconcileWorkflowUrl = new URL('../.github/workflows/production-runtime-reconcile.yml', import.meta.url);
const statusWorkflowUrl = new URL('../.github/workflows/production-runtime-reconcile-status.yml', import.meta.url);
const reconcileWorkflow = await readFile(reconcileWorkflowUrl, 'utf8');
const statusWorkflow = await readFile(statusWorkflowUrl, 'utf8');

function statusPayloadBlock() {
  const match = statusWorkflow.match(/await github\.rest\.repos\.createCommitStatus\(\{([\s\S]*?)\}\);/);
  assert.ok(match, 'observer must invoke GitHub commit-status publication');
  return match[1];
}

test('production reconcile status observer publishes a discoverable exact-run lifecycle', () => {
  assert.match(reconcileWorkflow, /^name:\s*production-runtime-reconcile\s*$/m, 'observer must bind to the canonical Production reconciler name');
  assert.match(statusWorkflow, /workflow_run:[\s\S]*workflows:\s*\['production-runtime-reconcile'\]/, 'observer must watch only the canonical reconciler');
  assert.match(statusWorkflow, /types:\s*\[in_progress,\s*completed\]/, 'observer must publish both pending and terminal lifecycle transitions');
  assert.match(statusWorkflow, /permissions:\n  statuses: write\n\njobs:/, 'observer permission block must contain only statuses: write');
  assert.match(statusWorkflow, /workflow_run\.head_branch == 'main'/, 'observer must fail closed for a non-main workflow run');
  assert.match(statusWorkflow, /run\.head_branch !== 'main'/, 'runtime script must independently reject non-main runs before publication');
  assert.match(
    statusWorkflow,
    /const state = run\.status === 'completed'[\s\S]*run\.conclusion === 'success' \? 'success' : 'failure'[\s\S]*: 'pending';/,
    'observer must deterministically map in-progress and completed run outcomes',
  );

  const payload = statusPayloadBlock();
  assert.match(payload, /sha:\s*run\.head_sha/, 'published status must bind to the triggering run head SHA');
  assert.match(payload, /state,/, 'published status must use the computed lifecycle state');
  assert.match(payload, /context:\s*'production-runtime-reconcile'/, 'published status must use the stable discovery context');
  assert.match(
    payload,
    /target_url:\s*`https:\/\/github\.com\/\$\{context\.repo\.owner\}\/\$\{context\.repo\.repo\}\/actions\/runs\/\$\{run\.id\}`/,
    'published status target must be the exact triggering GitHub Actions run',
  );
  assert.match(payload, /description,/, 'published status must use the bounded non-secret description');
});

test('reconcile status observer remains non-secret and non-mutating outside commit status', () => {
  assert.doesNotMatch(statusWorkflow, /secrets\./, 'observer must not receive repository or provider secrets');
  assert.doesNotMatch(statusWorkflow, /VERCEL|deploy|env run|checkout@/i, 'observer must not perform provider mutation or execute repository code');
  assert.doesNotMatch(statusWorkflow, /description[^\n]*(TOKEN|SECRET|KEY)/i, 'status descriptions must not contain credential material');
  assert.equal((statusWorkflow.match(/github\.rest\.repos\.createCommitStatus/g) ?? []).length, 1, 'observer must expose exactly one write operation');
});
