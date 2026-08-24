import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflow = await readFile(new URL('../.github/workflows/production-runtime-reconcile.yml', import.meta.url), 'utf8');

test('Production reconciliation covers every exact main push so every release candidate can be certified', () => {
  assert.match(workflow, /push:\s*\n\s+branches:\s*\[main\]/, 'reconciliation must run on canonical main pushes');
  const pushBlock = workflow.match(/push:\s*\n([\s\S]*?)(?=\n\s{2}(?:schedule|workflow_dispatch):)/)?.[0] ?? '';
  assert.doesNotMatch(pushBlock, /\n\s+paths:/, 'main reconciliation must not skip exact SHAs through a paths filter');
});
