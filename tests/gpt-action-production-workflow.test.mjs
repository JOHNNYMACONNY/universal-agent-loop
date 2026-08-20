import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflowUrl = new URL('../.github/workflows/gpt-action-api-production.yml', import.meta.url);

test('GPT Action production workflow promotes existing Preview secrets without exposing them and verifies production', async () => {
  const workflow = await readFile(workflowUrl, 'utf8');

  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /decrypt=true/);
  assert.match(workflow, /gitBranch=/);
  assert.match(workflow, /::add-mask::/);
  assert.match(workflow, /target:\["production"\]/);
  assert.match(workflow, /vercel@59\.1\.4 deploy --prod/);
  assert.match(workflow, /https:\/\/ual-gpt-action-api\.vercel\.app/);
  assert.match(workflow, /\/skills\/autonomous-dev-loop/);
  assert.doesNotMatch(workflow, /echo\s+[^\n]*(GITHUB_TOKEN|UAL_ACTION_API_KEY)/);
});

test('one-shot production trigger only runs on the exact authorized merge message', async () => {
  const workflow = await readFile(workflowUrl, 'utf8');

  assert.match(workflow, /push:\s*\n\s+branches:\s*\[main\]/);
  assert.match(workflow, /github\.event_name == 'workflow_dispatch'/);
  assert.match(workflow, /github\.event\.head_commit\.message == 'chore: trigger one-shot GPT Action production'/);
});

test('authorized same-repo PR edit can trigger the production run without exposing secrets', async () => {
  const workflow = await readFile(workflowUrl, 'utf8');

  assert.match(workflow, /pull_request:\s*\n\s+types:\s*\[edited\]/);
  assert.match(workflow, /github\.actor == 'JOHNNYMACONNY'/);
  assert.match(workflow, /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/);
  assert.match(workflow, /contains\(github\.event\.pull_request\.body \|\| '', '\[run-gpt-action-production\]'\)/);
});
