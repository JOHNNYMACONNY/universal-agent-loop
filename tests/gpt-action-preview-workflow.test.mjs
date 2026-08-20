import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflowUrl = new URL('../.github/workflows/gpt-action-api-preview.yml', import.meta.url);

test('GPT Action preview deploys from repository root when Vercel project rootDirectory is configured', async () => {
  const workflow = await readFile(workflowUrl, 'utf8');

  assert.match(workflow, /rootDirectory:\"apps\/gpt-action-api\"/);
  assert.match(workflow, /--cwd \"\$GITHUB_WORKSPACE\"/);
  assert.doesNotMatch(workflow, /--cwd \"\$GITHUB_WORKSPACE\/apps\/gpt-action-api\"/);
});
