import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const browserConfigUrl = new URL('../apps/game-browser-mcp/vercel.json', import.meta.url);
const actionConfigUrl = new URL('../apps/gpt-action-api/vercel.json', import.meta.url);
const reconcileUrl = new URL('../.github/workflows/production-runtime-reconcile.yml', import.meta.url);

async function readJson(url) {
  return JSON.parse(await readFile(url, 'utf8'));
}

test('Production reconciler is the only automatic Vercel deployment owner for both apps', async () => {
  const [browserConfig, actionConfig] = await Promise.all([
    readJson(browserConfigUrl),
    readJson(actionConfigUrl),
  ]);

  assert.equal(browserConfig.git?.deploymentEnabled, false);
  assert.equal(actionConfig.git?.deploymentEnabled, false);
});

test('reconciler reuses an exact healthy Production deployment when config is unchanged', async () => {
  const workflow = await readFile(reconcileUrl, 'utf8');

  for (const app of ['browser', 'Action']) {
    const marker = app === 'browser'
      ? 'Resolve or deploy exact browser Production'
      : 'Resolve or deploy exact Action Production';
    const start = workflow.indexOf(`- name: ${marker}`);
    assert.notEqual(start, -1, `${marker} step must exist`);

    const nextStep = workflow.indexOf('\n      - name:', start + marker.length);
    const block = workflow.slice(start, nextStep === -1 ? undefined : nextStep);

    assert.match(block, /CONFIG_CHANGED/);
    assert.match(block, /current_state/);
    assert.match(block, /current_sha/);
    assert.match(block, /health/);
    assert.match(block, /need_deploy=0/);
    assert.match(block, /if \[ "\$CONFIG_CHANGED" = '1' \] \|\| \[ "\$current_state" != 'READY' \] \|\| \[ "\$current_sha" != "\$CANDIDATE_SHA" \] \|\| \[ "\$health" != '200' \]; then/);
    assert.match(block, /else[\s\S]*?deployment_url="https:\/\/\$current_url"[\s\S]*?reused=true/);
  }
});
