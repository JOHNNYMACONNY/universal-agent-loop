import test from 'node:test';
import assert from 'node:assert/strict';

import type { TargetRegistration } from '../src/contracts.js';
import { buildSandboxNetworkPolicy, PRIVATE_RESERVED_CIDRS } from '../src/security/network-policy.js';

const registration: TargetRegistration = {
  target_registration_id: 'reg_1', project_id: 'project-1', repository: { owner: 'owner', name: 'repo' },
  expected_commit_sha: 'a'.repeat(40), deployment_id: 'dpl_1', deployment_url: 'https://game.example.com/fixture/',
  deployment_origin: 'https://game.example.com', allowed_hosts: ['game.example.com', 'cdn.example.com'],
  created_at: '2026-08-19T00:00:00.000Z', expires_at: '2026-08-19T00:15:00.000Z', provenance_source: 'provider_api',
};

test('sandbox egress combines exact trusted domains with provider-valid private/reserved IPv4 denial', () => {
  const policy = buildSandboxNetworkPolicy(registration);
  assert.deepEqual(policy.allow, ['game.example.com', 'cdn.example.com']);
  for (const cidr of ['10.0.0.0/8', '127.0.0.0/8', '169.254.0.0/16', '192.168.0.0/16']) {
    assert.ok(policy.subnets.deny.includes(cidr as (typeof PRIVATE_RESERVED_CIDRS)[number]), `missing ${cidr}`);
  }
  assert.equal(policy.subnets.deny.some((cidr) => cidr.includes(':')), false);
});

test('policy never adds an unregistered hostname or permissive public CIDR', () => {
  const policy = buildSandboxNetworkPolicy(registration);
  assert.equal(policy.allow.includes('evil.example.com'), false);
  assert.equal(policy.subnets.deny.length, PRIVATE_RESERVED_CIDRS.length);
  assert.equal('allowedCIDRs' in policy, false);
});
