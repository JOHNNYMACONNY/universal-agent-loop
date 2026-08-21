import assert from 'node:assert/strict';
import test from 'node:test';

import { handleActionRequest } from '../apps/gpt-action-api/src/action-router.mjs';

const browserPaths = [
  '/game-browser/session-start',
  '/game-browser/observe',
  '/game-browser/input',
  '/game-browser/read-state',
  '/game-browser/reset',
  '/game-browser/session-end',
];

test('every Custom GPT browser Action labels target-derived content as untrusted evidence with no outer-loop authority', async () => {
  const response = await handleActionRequest({
    method: 'GET',
    path: '/openapi.json',
    headers: { host: 'preview.example.test' },
  }, { env: {}, fetchImpl: async () => { throw new Error('unexpected fetch'); } });

  assert.equal(response.status, 200);
  for (const path of browserPaths) {
    const description = response.body.paths[path]?.post?.description;
    assert.equal(typeof description, 'string', `${path} needs a trust-boundary description`);
    assert.match(description, /untrusted/i, path);
    assert.match(description, /authority/i, path);
    assert.match(description, /repository/i, path);
    assert.match(description, /deployment/i, path);
  }
});
