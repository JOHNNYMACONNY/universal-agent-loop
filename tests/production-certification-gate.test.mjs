import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflowUrl = new URL('../.github/workflows/production-certification-gate.yml', import.meta.url);

test('successful exact-main Production reconciliation autonomously promotes only that SHA', async () => {
  const workflow = await readFile(workflowUrl, 'utf8');

  assert.match(workflow, /workflow_run:\s*\n\s+workflows:\s*\['production-runtime-reconcile'\]/, 'certification must be driven by the canonical Production reconciliation workflow');
  assert.match(workflow, /types:\s*\[completed\]/, 'certification must wait for a terminal reconciliation result');
  assert.match(workflow, /head_branch\s*==\s*'main'/, 'only canonical main reconciliation may certify');
  assert.match(workflow, /conclusion\s*==\s*'success'/, 'failed reconciliation must never promote');
  assert.match(workflow, /production-runtime-reconcile/, 'the exact reconciliation commit status must be inspected');
  assert.match(workflow, /target_url/, 'the status must be tied back to the triggering workflow run');
  assert.match(workflow, /workflow_run\.head_sha/, 'promotion must bind to the immutable reconciled SHA');
  assert.match(workflow, /refs\/tags\/production-certified-/, 'promotion must create an immutable certification tag');
  assert.doesNotMatch(workflow, /refs\/tags\/production-certified['"]/, 'the workflow must not maintain a moving certification tag');
  assert.match(workflow, /git\.getRef|git\.createRef/, 'tag creation must be idempotent and API-backed');
});

test('certification gate has bounded status-race handling and least privilege', async () => {
  const workflow = await readFile(workflowUrl, 'utf8');

  assert.match(workflow, /contents:\s*write/, 'tag promotion needs contents write and no broader repository mutation permission');
  assert.match(workflow, /statuses:\s*read/, 'exact reconciliation status must be readable');
  assert.doesNotMatch(workflow, /pull-requests:\s*write|issues:\s*write|actions:\s*write|deployments:\s*write/, 'certification must not gain unrelated write authority');
  assert.match(workflow, /for \(let attempt = 1; attempt <= 12; attempt\+\+\)/, 'status publication races must be retried with a fixed bound');
  assert.match(workflow, /await new Promise\(resolve => setTimeout\(resolve, 5000\)\)/, 'status retries must use a bounded delay');
  assert.match(workflow, /core\.setFailed\(/, 'missing or mismatched exact-SHA evidence must fail closed');
});
