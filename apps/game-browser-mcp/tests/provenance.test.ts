import test from 'node:test';
import assert from 'node:assert/strict';

import { RuntimeError } from '../src/errors.js';
import { createRegistrationHandler } from '../src/admin/register-deployment.js';
import { MemoryRegistrationStore } from '../src/provenance/registration-store.js';
import { RegistrationService } from '../src/provenance/registration-service.js';
import { VercelDeploymentVerifier } from '../src/provenance/vercel-deployment.js';

const SHA = 'a'.repeat(40);
const OTHER_SHA = 'b'.repeat(40);
const trust = {
  projectId: 'project-1',
  repositoryOwner: 'owner',
  repositoryName: 'repo',
  targetEntryPath: '/',
  approvedDeploymentHostPatterns: ['*.vercel.app'],
  approvedDependencyHosts: ['cdn.example.com'],
  approvedRedirectHosts: ['play.example.com'],
};

function fakeFetch(body: unknown, status = 200): typeof fetch {
  return (async () => new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })) as typeof fetch;
}

function deployment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'dpl_1',
    url: 'repo-abc123.vercel.app',
    projectId: 'project-1',
    readyState: 'READY',
    gitSource: { type: 'github', org: 'owner', repo: 'repo', sha: SHA, ref: 'feature' },
    meta: { githubCommitSha: SHA, githubCommitOrg: 'owner', githubCommitRepo: 'repo' },
    ...overrides,
  };
}

test('verifier accepts only exact ready deployment provenance', async () => {
  const verifier = new VercelDeploymentVerifier({ token: 'token', teamId: 'team_1', fetchImpl: fakeFetch(deployment()) });
  const verified = await verifier.verify({
    deploymentId: 'dpl_1', expectedCommitSha: SHA,
    repository: { owner: 'owner', name: 'repo' }, projectId: 'project-1',
  });
  assert.equal(verified.deploymentId, 'dpl_1');
  assert.equal(verified.deploymentUrl, 'https://repo-abc123.vercel.app');
  assert.equal(verified.commitSha, SHA);
});

test('verifier rejects moving aliases before provider call', async () => {
  let calls = 0;
  const verifier = new VercelDeploymentVerifier({
    token: 'token',
    fetchImpl: (async () => { calls += 1; return new Response('{}'); }) as typeof fetch,
  });
  await assert.rejects(
    verifier.verify({ deploymentId: 'repo-git-main.vercel.app', expectedCommitSha: SHA, repository: { owner: 'owner', name: 'repo' }, projectId: 'project-1' }),
    (error: unknown) => error instanceof RuntimeError && error.code === 'PROVENANCE_MISMATCH',
  );
  assert.equal(calls, 0);
});

test('verifier rejects SHA, project, repo, and readiness mismatches', async () => {
  for (const body of [
    deployment({ gitSource: { type: 'github', org: 'owner', repo: 'repo', sha: OTHER_SHA } }),
    deployment({ projectId: 'wrong-project' }),
    deployment({ gitSource: { type: 'github', org: 'owner', repo: 'wrong', sha: SHA } }),
    deployment({ readyState: 'BUILDING' }),
  ]) {
    const verifier = new VercelDeploymentVerifier({ token: 'token', fetchImpl: fakeFetch(body) });
    await assert.rejects(
      verifier.verify({ deploymentId: 'dpl_1', expectedCommitSha: SHA, repository: { owner: 'owner', name: 'repo' }, projectId: 'project-1' }),
      (error: unknown) => error instanceof RuntimeError && ['PROVENANCE_MISMATCH', 'STALE_DEPLOYMENT'].includes(error.code),
    );
  }
});

test('registration derives concrete target and allowed hosts only from trusted sources', async () => {
  const store = new MemoryRegistrationStore();
  const verifier = new VercelDeploymentVerifier({ token: 'token', fetchImpl: fakeFetch(deployment()) });
  const service = new RegistrationService({
    verifier, store, trust, now: () => new Date('2026-08-19T00:00:00.000Z'),
    idFactory: () => 'reg_1', registrationTtlMs: 15 * 60_000,
  });
  const registration = await service.register({ deploymentId: 'dpl_1', expectedCommitSha: SHA });
  assert.equal(registration.repository.owner, 'owner');
  assert.equal(registration.deployment_url, 'https://repo-abc123.vercel.app');
  assert.deepEqual(registration.allowed_hosts, ['repo-abc123.vercel.app', 'cdn.example.com', 'play.example.com']);
  assert.deepEqual(await store.get('reg_1'), registration);
});

test('registration store permits idempotent same content but rejects overwrite drift', async () => {
  const store = new MemoryRegistrationStore();
  const verifier = new VercelDeploymentVerifier({ token: 'token', fetchImpl: fakeFetch(deployment()) });
  const service = new RegistrationService({ verifier, store, trust, idFactory: () => 'reg_same' });
  const first = await service.register({ deploymentId: 'dpl_1', expectedCommitSha: SHA });
  await store.put(first);
  await assert.rejects(store.put({ ...first, deployment_id: 'dpl_other' }), /overwrite/i);
});

test('internal registration handler fails closed on control token', async () => {
  const service = { register: async () => ({ target_registration_id: 'reg_1' }) } as unknown as RegistrationService;
  const handler = createRegistrationHandler(service, 'correct-secret');
  const req = { headers: { 'x-registration-control-token': 'wrong' }, body: { deploymentId: 'dpl_1', expectedCommitSha: SHA } } as any;
  let status = 200;
  let payload: unknown;
  const res = { status(code: number) { status = code; return this; }, json(value: unknown) { payload = value; return this; } } as any;
  await handler(req, res, (() => undefined) as any);
  assert.equal(status, 401);
  assert.deepEqual(payload, { error: 'unauthorized' });
});
