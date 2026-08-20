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
