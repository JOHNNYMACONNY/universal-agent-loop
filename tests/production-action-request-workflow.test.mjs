import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const workflowPath = '.github/workflows/production-action-request.yml';

function workflow() {
  return fs.readFileSync(workflowPath, 'utf8');
}

test('Production Action request relay is default-branch-owned and issue-triggered', () => {
  const text = workflow();
  assert.match(text, /^name: production-action-request$/m);
  assert.match(text, /issues:\s*\n\s+types: \[opened, edited, reopened\]/);
  assert.doesNotMatch(text, /pull_request_target:/);
  assert.match(text, /github\.event\.sender\.login == 'JOHNNYMACONNY'/);
  assert.match(text, /github\.event\.issue\.user\.login == 'JOHNNYMACONNY'/);
  assert.match(text, /github\.event\.issue\.title == 'UAL Production Action Request'/);
});

test('relay keeps credentials server-side and uses the stable Production Action', () => {
  const text = workflow();
  assert.match(text, /VERCEL_TOKEN: \$\{\{ secrets\.VERCEL_TOKEN \}\}/);
  assert.match(text, /ACTION_URL: https:\/\/ual-gpt-action-api\.vercel\.app/);
  assert.match(text, /UAL_ACTION_API_KEY/);
  assert.doesNotMatch(text, /production_value\s+GITHUB_CONTROL_TOKEN/);
  assert.doesNotMatch(text, /GITHUB_CONTROL_TOKEN=.*GITHUB_ENV/);
  assert.match(text, /::add-mask::\$action_key/);
});

test('relay pins exact PR head and only writes guarded chatgpt branches through the Action', () => {
  const text = workflow();
  assert.match(text, /\/github\/pull-request/);
  assert.match(text, /\/github\/file/);
  assert.match(text, /\^chatgpt\\\//);
  assert.match(text, /\^\[0-9a-fA-F\]\{40\}\$/);
  assert.match(text, /expectedHead/);
  assert.match(text, /blobSha/);
  assert.match(text, /old_count != 1/);
  assert.doesNotMatch(text, /git push/);
  assert.doesNotMatch(text, /repos\/\$.*\/git\/refs/);
});

test('relay bounds request size and replacement cardinality', () => {
  const text = workflow();
  assert.match(text, /REQUEST_MAX_BYTES: '60000'/);
  assert.match(text, /operations \| length >= 1 and length <= 4/);
  assert.match(text, /replacements \| length >= 1 and length <= 8/);
  assert.match(text, /\.old \| type == \"string\" and length >= 1/);
});
