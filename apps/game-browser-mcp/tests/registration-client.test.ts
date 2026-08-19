import test from 'node:test';
import assert from 'node:assert/strict';

import { registerRemoteDeployment } from '../scripts/register-vercel-deployment.js';

const SHA = 'a'.repeat(40);

test('registration client sends only immutable deployment ID and exact commit SHA', async () => {
  let requestUrl = '';
  let requestInit: RequestInit | undefined;
  const result = await registerRemoteDeployment({
    runtimeBaseUrl: 'https://runtime.example.com',
    deploymentId: 'dpl_abc123',
    commitSha: SHA,
    controlToken: 'secret-token',
    fetchImpl: (async (url, init) => {
      requestUrl = String(url);
      requestInit = init;
      return new Response(JSON.stringify({
        target_registration_id: 'reg_1',
        deployment_id: 'dpl_abc123',
        expected_commit_sha: SHA,
        deployment_url: 'https://runtime-abc.vercel.app/fixture/',
      }), { status: 201, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch,
  });

  assert.equal(requestUrl, 'https://runtime.example.com/internal/registrations');
  assert.equal(requestInit?.method, 'POST');
  assert.deepEqual(JSON.parse(String(requestInit?.body)), { deploymentId: 'dpl_abc123', expectedCommitSha: SHA });
  const headers = new Headers(requestInit?.headers);
  assert.equal(headers.get('x-registration-control-token'), 'secret-token');
  assert.equal(result.targetRegistrationId, 'reg_1');
  assert.equal(result.deploymentId, 'dpl_abc123');
  assert.equal(result.expectedCommitSha, SHA);
});

test('registration client rejects aliases, malformed SHAs, and cross-origin control URLs before fetch', async () => {
  let calls = 0;
  const fetchImpl = (async () => { calls += 1; return new Response('{}'); }) as typeof fetch;
  for (const input of [
    { deploymentId: 'project-git-main.vercel.app', commitSha: SHA },
    { deploymentId: 'dpl_abc123', commitSha: 'short' },
  ]) {
    await assert.rejects(registerRemoteDeployment({
      runtimeBaseUrl: 'https://runtime.example.com',
      deploymentId: input.deploymentId,
      commitSha: input.commitSha,
      controlToken: 'secret-token',
      fetchImpl,
    }), /deployment|commit/i);
  }
  await assert.rejects(registerRemoteDeployment({
    runtimeBaseUrl: 'http://runtime.example.com',
    deploymentId: 'dpl_abc123', commitSha: SHA, controlToken: 'secret-token', fetchImpl,
  }), /HTTPS/i);
  assert.equal(calls, 0);
});

test('registration client fails closed on non-201 or mismatched returned provenance', async () => {
  await assert.rejects(registerRemoteDeployment({
    runtimeBaseUrl: 'https://runtime.example.com', deploymentId: 'dpl_abc123', commitSha: SHA, controlToken: 'secret-token',
    fetchImpl: (async () => new Response(JSON.stringify({ error: 'PROVENANCE_MISMATCH' }), { status: 409 })) as typeof fetch,
  }), /PROVENANCE_MISMATCH|409/);

  await assert.rejects(registerRemoteDeployment({
    runtimeBaseUrl: 'https://runtime.example.com', deploymentId: 'dpl_abc123', commitSha: SHA, controlToken: 'secret-token',
    fetchImpl: (async () => new Response(JSON.stringify({
      target_registration_id: 'reg_1', deployment_id: 'dpl_other', expected_commit_sha: SHA,
      deployment_url: 'https://runtime.example.com/fixture/',
    }), { status: 201, headers: { 'content-type': 'application/json' } })) as typeof fetch,
  }), /mismatch/i);
});
