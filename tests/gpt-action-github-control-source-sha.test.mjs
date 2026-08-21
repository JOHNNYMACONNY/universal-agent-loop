import assert from 'node:assert/strict';
import test from 'node:test';

import { handleActionRequest } from '../apps/gpt-action-api/src/app.mjs';

const env = {
  UAL_ACTION_API_KEY: 'action-secret',
  GITHUB_CONTROL_TOKEN: 'control-secret',
  GITHUB_CONTROL_OWNERS: 'JOHNNYMACONNY',
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('create branch accepts an exact same-repository commit SHA as fromRef', async () => {
  const sourceSha = 'd51d56cd8f51752db820d7df4fea733d88aacac4';
  const captures = [];
  const responses = [
    jsonResponse({ full_name: 'JOHNNYMACONNY/universal-agent-loop', default_branch: 'main' }),
    jsonResponse({ sha: sourceSha }),
    jsonResponse({ ref: 'refs/heads/chatgpt/exact-source', object: { sha: sourceSha } }, 201),
  ];
  const fetchImpl = async (url, options = {}) => {
    captures.push({ url, options });
    const response = responses.shift();
    if (!response) throw new Error(`unexpected fetch ${url}`);
    return response;
  };

  const response = await handleActionRequest({
    method: 'POST',
    path: '/github/branch',
    body: {
      repository: 'JOHNNYMACONNY/universal-agent-loop',
      branch: 'chatgpt/exact-source',
      fromRef: sourceSha,
    },
    headers: {
      host: 'preview.example.test',
      authorization: 'Bearer action-secret',
      'content-type': 'application/json',
    },
    searchParams: {},
  }, { env, fetchImpl });

  assert.equal(response.status, 201);
  assert.equal(
    captures[1].url,
    `https://api.github.com/repos/JOHNNYMACONNY/universal-agent-loop/git/commits/${sourceSha}`,
  );
  assert.deepEqual(JSON.parse(captures[2].options.body), {
    ref: 'refs/heads/chatgpt/exact-source',
    sha: sourceSha,
  });
  assert.deepEqual(response.body, {
    repository: 'JOHNNYMACONNY/universal-agent-loop',
    branch: 'chatgpt/exact-source',
    sha: sourceSha,
  });
});
