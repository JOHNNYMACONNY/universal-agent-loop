import test from 'node:test';
import assert from 'node:assert/strict';

import type { TargetRegistration } from '../src/contracts.js';
import { RuntimeError } from '../src/errors.js';
import { resolvePinnedEgressPolicy } from '../src/security/network-policy.js';
import type { DnsResolver } from '../src/security/url-policy.js';

const registration: TargetRegistration = {
  target_registration_id: 'reg_1', project_id: 'project-1', repository: { owner: 'owner', name: 'repo' },
  expected_commit_sha: 'a'.repeat(40), deployment_id: 'dpl_1', deployment_url: 'https://game.example.com/fixture/',
  deployment_origin: 'https://game.example.com', allowed_hosts: ['game.example.com', 'cdn.example.com'],
  created_at: '2026-08-19T00:00:00.000Z', expires_at: '2026-08-19T00:15:00.000Z', provenance_source: 'provider_api',
};

test('trusted hostnames are pinned to globally routable CIDRs for the sandbox lifetime', async () => {
  const resolver: DnsResolver = async (host) => host === 'game.example.com'
    ? [{ address: '93.184.216.34', family: 4 }]
    : [{ address: '2606:4700:4700::1111', family: 6 }];
  const policy = await resolvePinnedEgressPolicy(registration, resolver);
  assert.deepEqual(policy, {
    mode: 'custom',
    allowedDomains: [],
    allowedCIDRs: ['93.184.216.34/32', '2606:4700:4700::1111/128'],
    deniedCIDRs: [],
  });
});

test('any private/reserved resolution fails the whole pinned egress policy closed', async () => {
  const resolver: DnsResolver = async (host) => host === 'game.example.com'
    ? [{ address: '93.184.216.34', family: 4 }]
    : [{ address: '10.0.0.5', family: 4 }];
  await assert.rejects(
    resolvePinnedEgressPolicy(registration, resolver),
    (error: unknown) => error instanceof RuntimeError && error.code === 'TARGET_BLOCKED',
  );
});

test('mixed public/private answers for one trusted hostname fail closed rather than pinning only the public answer', async () => {
  const resolver: DnsResolver = async () => [
    { address: '93.184.216.34', family: 4 },
    { address: '127.0.0.1', family: 4 },
  ];
  await assert.rejects(resolvePinnedEgressPolicy(registration, resolver), /private|reserved|routable/i);
});
