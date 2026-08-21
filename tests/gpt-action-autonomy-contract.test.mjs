import assert from 'node:assert/strict';
import test from 'node:test';

import { handleActionRequest } from '../apps/gpt-action-api/src/app.mjs';

test('routine implementation mutations can be always-allowed while draft PR publication stays consequential', async () => {
  const response = await handleActionRequest({
    method: 'GET',
    path: '/openapi.json',
    headers: { host: 'preview.example.test' },
  }, {
    env: {},
    fetchImpl: async () => { throw new Error('unexpected fetch'); },
  });

  assert.equal(response.status, 200);
  const paths = response.body.paths;
  assert.equal(paths['/github/branch'].post['x-openai-isConsequential'], false);
  assert.equal(paths['/github/file'].put['x-openai-isConsequential'], false);
  assert.equal(paths['/github/draft-pull-request'].post['x-openai-isConsequential'], true);
});
