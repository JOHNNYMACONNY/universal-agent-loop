import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflowUrl = new URL('../.github/workflows/production-runtime-reconcile.yml', import.meta.url);
const workflow = await readFile(workflowUrl, 'utf8');

test('bridge screenshot failure emits only bounded sanitized runtime diagnostics', () => {
  assert.match(
    workflow,
    /Signed screenshot fetch failed \(HTTP \$image_status\)[\s\S]{0,500}jq -r '[^']*\.error[^']*\.message[^']*' \/tmp\/bridge-screenshot\.png/,
    'bridge smoke must surface the screenshot route sanitized error code/message instead of discarding the failure body',
  );
  assert.doesNotMatch(
    workflow,
    /cat \/tmp\/bridge-screenshot\.png/,
    'bridge diagnostics must not dump arbitrary response bytes',
  );
});
