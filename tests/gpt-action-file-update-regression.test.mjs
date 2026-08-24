import assert from 'node:assert/strict';
import test from 'node:test';

import { handleActionRequest } from '../apps/gpt-action-api/src/app.mjs';

const env = {
  UAL_ACTION_API_KEY: 'action-secret',
  GITHUB_TOKEN: 'skill-read-secret',
  GITHUB_CONTROL_TOKEN: 'control-secret',
  GITHUB_CONTROL_OWNERS: 'JOHNNYMACONNY',
};

function request(body) {
  return {
    method: 'PUT',
    path: '/github/file',
    searchParams: {},
    body,
    headers: {
      host: 'preview.example.test',
      authorization: 'Bearer action-secret',
      'content-type': 'application/json',
    },
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const baseBody = {
  repository: 'JOHNNYMACONNY/universal-agent-loop',
  path: 'src/file.js',
  branch: 'chatgpt/file-update',
  message: 'fix: update existing file',
  content: 'updated\n',
};

test('existing-file update rejects the previously observed truncated blob sha before GitHub access', async () => {
  const truncatedObservedSha = '7a4c6eb69559a5a4bd51f4da5addbafe18c384';
  let calls = 0;
  const response = await handleActionRequest(request({ ...baseBody, sha: truncatedObservedSha }), {
    env,
    fetchImpl: async () => {
      calls += 1;
      throw new Error('malformed blob sha must fail before GitHub access');
    },
  });

  assert.equal(response.status, 400);
  assert.deepEqual(response.body, { error: 'INVALID_BLOB_SHA' });
  assert.equal(calls, 0);
});

test('existing-file update accepts an exact 40-hex blob sha and forwards it unchanged', async () => {
  const exactBlobSha = '7a4c6eb69559fca5a4bd51f4da5addbafe18c384';
  const captures = [];
  const responses = [
    jsonResponse({ full_name: 'JOHNNYMACONNY/universal-agent-loop', default_branch: 'main' }),
    jsonResponse({
      content: { sha: 'ca23ae757f1f9fb5a0c67cd2f197c3681bde11f9', html_url: 'https://github.com/blob' },
      commit: { sha: '2872ece8b499adf138697d04550184ad24e69b27', html_url: 'https://github.com/commit' },
    }),
  ];
  const response = await handleActionRequest(request({ ...baseBody, sha: exactBlobSha }), {
    env,
    fetchImpl: async (url, options = {}) => {
      captures.push({ url, options });
      const next = responses.shift();
      if (!next) throw new Error(`unexpected fetch ${url}`);
      return next;
    },
  });

  assert.equal(response.status, 200);
  assert.equal(captures.length, 2);
  assert.equal(JSON.parse(captures[1].options.body).sha, exactBlobSha);
});

test('mutation failures expose only bounded sanitized GitHub code/message diagnostics', async () => {
  const exactBlobSha = '7a4c6eb69559fca5a4bd51f4da5addbafe18c384';
  const responses = [
    jsonResponse({ full_name: 'JOHNNYMACONNY/universal-agent-loop', default_branch: 'main' }),
    jsonResponse({
      message: 'sha does not match',
      errors: [{ resource: 'Commit', field: 'sha', code: 'invalid' }],
      secret_noise: 'control-secret',
      arbitrary: { nested: 'must-not-leak' },
    }, 409),
  ];
  const response = await handleActionRequest(request({ ...baseBody, sha: exactBlobSha }), {
    env,
    fetchImpl: async () => responses.shift(),
  });

  assert.equal(response.status, 409);
  assert.deepEqual(response.body, {
    error: 'GITHUB_CONTROL_CONFLICT',
    status: 409,
    upstreamCode: 'invalid',
    upstreamMessage: 'sha does not match',
  });
  const serialized = JSON.stringify(response.body);
  assert.equal(serialized.includes('control-secret'), false);
  assert.equal(serialized.includes('must-not-leak'), false);
});

test('mutation diagnostics omit unsafe arbitrary GitHub messages and codes', async () => {
  const exactBlobSha = '7a4c6eb69559fca5a4bd51f4da5addbafe18c384';
  const responses = [
    jsonResponse({ full_name: 'JOHNNYMACONNY/universal-agent-loop', default_branch: 'main' }),
    jsonResponse({
      message: 'control-secret leaked upstream detail',
      errors: [{ code: 'invalid\ncontrol-secret' }],
    }, 409),
  ];
  const response = await handleActionRequest(request({ ...baseBody, sha: exactBlobSha }), {
    env,
    fetchImpl: async () => responses.shift(),
  });

  assert.equal(response.status, 409);
  assert.deepEqual(response.body, { error: 'GITHUB_CONTROL_CONFLICT', status: 409 });
});
