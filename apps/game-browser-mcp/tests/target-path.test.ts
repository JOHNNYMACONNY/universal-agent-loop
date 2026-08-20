import test from 'node:test';
import assert from 'node:assert/strict';

import { loadRuntimeConfig } from '../src/env.js';
import { MemoryRegistrationStore } from '../src/provenance/registration-store.js';
import { RegistrationService } from '../src/provenance/registration-service.js';

const SHA = 'a'.repeat(40);

test('target entry path is server-owned, normalized, and applied inside verified deployment origin', async () => {
  const cfg = loadRuntimeConfig({
    TARGET_PROJECT_ID: 'project-1', TARGET_REPOSITORY_OWNER: 'owner', TARGET_REPOSITORY_NAME: 'repo',
    TARGET_ENTRY_PATH: '/fixture/', APPROVED_DEPLOYMENT_HOST_PATTERNS: '*.vercel.app',
  });
  assert.equal(cfg.trust.targetEntryPath, '/fixture/');
  const store = new MemoryRegistrationStore();
  const service = new RegistrationService({
    trust: cfg.trust,
    store,
    verifier: { async verify() { return { deploymentId: 'dpl_1', deploymentUrl: 'https://repo-abc.vercel.app', projectId: 'project-1', repository: { owner: 'owner', name: 'repo' }, commitSha: SHA }; } },
    idFactory: () => 'reg_1',
    now: () => new Date('2026-08-19T00:00:00.000Z'),
  });
  const reg = await service.register({ deploymentId: 'dpl_1', expectedCommitSha: SHA });
  assert.equal(reg.deployment_url, 'https://repo-abc.vercel.app/fixture/');
  assert.equal(reg.deployment_origin, 'https://repo-abc.vercel.app');
});

test('target entry path rejects absolute URLs, traversal, query, fragment, and protocol-relative paths', () => {
  for (const value of ['https://evil.example/', '//evil.example/', '/../secret', '/fixture?x=1', '/fixture#x']) {
    assert.throws(() => loadRuntimeConfig({ TARGET_ENTRY_PATH: value }), /TARGET_ENTRY_PATH/);
  }
});
