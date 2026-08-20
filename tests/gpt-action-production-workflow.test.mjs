import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflowUrl = new URL('../.github/workflows/gpt-action-api-production.yml', import.meta.url);

test('GPT Action production workflow verifies the persistent Production credentials and stable API without exposing values', async () => {
  const workflow = await readFile(workflowUrl, 'utf8');

  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /decrypt=true/);
  assert.match(workflow, /::add-mask::/);
  assert.match(workflow, /vercel@59\.1\.4 deploy --prod/);
  assert.match(workflow, /https:\/\/ual-gpt-action-api\.vercel\.app/);
  assert.match(workflow, /\/skills\/autonomous-dev-loop/);
  assert.doesNotMatch(workflow, /echo\s+["']?\$(github_token|action_key)["']?/);
  assert.doesNotMatch(workflow, /printf\s+[^\n]*\$(github_token|action_key)/);
});

test('production uses persistent Production values for both runtime credentials and validates private GitHub access before deploy', async () => {
  const workflow = await readFile(workflowUrl, 'utf8');

  assert.match(workflow, /production_value UAL_ACTION_API_KEY/);
  assert.match(workflow, /production_value GITHUB_TOKEN/);
  assert.doesNotMatch(workflow, /global_preview_value/);
  assert.doesNotMatch(workflow, /promote_value/);
  assert.match(workflow, /api\.github\.com\/repos\/JOHNNYMACONNY\/universal-agent-loop\/contents\/skills\/autonomous-dev-loop\/SKILL\.md\?ref=main/);
  assert.match(workflow, /Persistent Production GITHUB_TOKEN/);
  assert.match(workflow, /Persistent Production UAL_ACTION_API_KEY/);
});

test('production workflow is dispatch-only after the authorized one-shot promotion', async () => {
  const workflow = await readFile(workflowUrl, 'utf8');

  assert.match(workflow, /on:\s*\n\s+workflow_dispatch:/);
  assert.doesNotMatch(workflow, /\n\s+push:\s*\n/);
  assert.doesNotMatch(workflow, /\n\s+pull_request:\s*\n/);
  assert.doesNotMatch(workflow, /run-gpt-action-production/);
  assert.doesNotMatch(workflow, /trigger one-shot GPT Action production/);
});
