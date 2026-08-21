import assert from 'node:assert/strict';
import test from 'node:test';

import { handleActionRequest } from '../apps/gpt-action-api/src/app.mjs';

const env = {
  UAL_ACTION_API_KEY: 'action-secret',
  GITHUB_CONTROL_TOKEN: 'control-secret',
  GITHUB_CONTROL_OWNERS: 'JOHNNYMACONNY',
};

function request(path, searchParams) {
  return {
    method: 'GET',
    path,
    searchParams,
    headers: { authorization: 'Bearer action-secret', host: 'preview.example.test' },
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('GitHub control requests refuse automatic redirects', async () => {
  let capturedOptions;
  const response = await handleActionRequest(
    request('/github/repository', { repository: 'JOHNNYMACONNY/universal-agent-loop' }),
    {
      env,
      fetchImpl: async (_url, options) => {
        capturedOptions = options;
        return jsonResponse({
          full_name: 'JOHNNYMACONNY/universal-agent-loop',
          private: true,
          default_branch: 'main',
          archived: false,
          disabled: false,
        });
      },
    },
  );

  assert.equal(response.status, 200);
  assert.equal(capturedOptions.redirect, 'manual');
});

test('repository identity cannot change after owner allowlist validation', async () => {
  const response = await handleActionRequest(
    request('/github/repository', { repository: 'JOHNNYMACONNY/legacy-name' }),
    {
      env,
      fetchImpl: async () => jsonResponse({
        full_name: 'someone-else/transferred-repo',
        private: true,
        default_branch: 'main',
        archived: false,
        disabled: false,
      }),
    },
  );

  assert.equal(response.status, 403);
  assert.deepEqual(response.body, { error: 'REPOSITORY_NOT_ALLOWED' });
});
