import assert from 'node:assert/strict';
import test from 'node:test';

import { handleActionRequest } from '../apps/gpt-action-api/src/app.mjs';

const env = {
  UAL_ACTION_API_KEY: 'action-secret',
  GITHUB_TOKEN: 'skill-read-secret',
  GITHUB_CONTROL_TOKEN: 'control-secret',
  GITHUB_CONTROL_OWNERS: 'JOHNNYMACONNY',
};

function request(path, { method = 'GET', searchParams = {}, body } = {}) {
  return {
    method,
    path,
    searchParams,
    body,
    headers: { host: 'preview.example.test', authorization: 'Bearer action-secret' },
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

test('tree reads preserve slash-separated nested branch refs in the GitHub path', async () => {
  const seen = [];
  const response = await handleActionRequest(
    request('/github/tree', {
      searchParams: { repository: 'JOHNNYMACONNY/universal-agent-loop', ref: 'chatgpt/feature' },
    }),
    {
      env,
      fetchImpl: async (url) => {
        seen.push(url);
        return jsonResponse({ sha: 'tree-sha', truncated: false, tree: [] });
      },
    },
  );

  assert.equal(response.status, 200);
  assert.equal(
    seen[0],
    'https://api.github.com/repos/JOHNNYMACONNY/universal-agent-loop/git/trees/chatgpt/feature?recursive=1',
  );
});

test('branch creation preserves slash-separated nested source refs in the GitHub ref path', async () => {
  const seen = [];
  const responses = [
    jsonResponse({ full_name: 'JOHNNYMACONNY/universal-agent-loop', default_branch: 'main' }),
    jsonResponse({ object: { type: 'commit', sha: 'source-sha' } }),
    jsonResponse({ ref: 'refs/heads/chatgpt/new', object: { sha: 'source-sha' } }, 201),
  ];
  const response = await handleActionRequest(
    request('/github/branch', {
      method: 'POST',
      body: {
        repository: 'JOHNNYMACONNY/universal-agent-loop',
        branch: 'chatgpt/new',
        fromRef: 'chatgpt/base',
      },
    }),
    {
      env,
      fetchImpl: async (url) => {
        seen.push(url);
        return responses.shift();
      },
    },
  );

  assert.equal(response.status, 201);
  assert.equal(
    seen[1],
    'https://api.github.com/repos/JOHNNYMACONNY/universal-agent-loop/git/ref/heads/chatgpt/base',
  );
});
