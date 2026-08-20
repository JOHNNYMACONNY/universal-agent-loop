import test from 'node:test';
import assert from 'node:assert/strict';

import type { TargetRegistration } from '../src/contracts.js';
import { RuntimeError } from '../src/errors.js';
import { buildSandboxNetworkPolicy } from '../src/security/network-policy.js';
import { createRebindingAwareResolver, validateRegisteredUrl, type DnsResolver } from '../src/security/url-policy.js';

const registration: TargetRegistration = {
  target_registration_id: 'reg_1',
  project_id: 'project-1',
  repository: { owner: 'owner', name: 'repo' },
  expected_commit_sha: 'a'.repeat(40),
  deployment_id: 'dpl_1',
  deployment_url: 'https://game.example.com',
  deployment_origin: 'https://game.example.com',
  allowed_hosts: ['game.example.com', 'cdn.example.com'],
  created_at: '2026-08-19T00:00:00.000Z',
  expires_at: '2026-08-19T00:15:00.000Z',
  provenance_source: 'provider_api',
};

const publicResolve: DnsResolver = async () => [{ address: '93.184.216.34', family: 4 }];

async function blocked(url: string, resolve: DnsResolver = publicResolve): Promise<void> {
  await assert.rejects(
    validateRegisteredUrl(new URL(url), registration, resolve),
    (error: unknown) => error instanceof RuntimeError && error.code === 'TARGET_BLOCKED',
  );
}

test('accepts registered HTTPS host with globally routable DNS', async () => {
  await validateRegisteredUrl(new URL('https://game.example.com/play'), registration, publicResolve);
});

test('rejects unregistered host and non-HTTPS scheme', async () => {
  await blocked('https://evil.example.com');
  await blocked('http://game.example.com');
  await blocked('file:///etc/passwd');
  await blocked('data:text/plain,hello');
  await blocked('javascript:alert(1)');
});

test('rejects localhost and private/reserved address families', async () => {
  for (const address of [
    '127.0.0.1', '10.0.0.1', '172.16.1.1', '192.168.1.1', '169.254.169.254',
    '0.0.0.0', '224.0.0.1', '100.64.0.1', '198.18.0.1', '::1', 'fc00::1', 'fe80::1', '::',
  ]) {
    const resolver: DnsResolver = async () => [{ address, family: address.includes(':') ? 6 : 4 }];
    await blocked('https://game.example.com', resolver);
  }
});

test('rejects when any DNS answer is private even if another answer is public', async () => {
  const resolver: DnsResolver = async () => [
    { address: '93.184.216.34', family: 4 },
    { address: '10.0.0.5', family: 4 },
  ];
  await blocked('https://game.example.com', resolver);
});

test('rebinding-aware resolver fails closed if a later resolution turns private', async () => {
  let calls = 0;
  const resolver = createRebindingAwareResolver(async () => {
    calls += 1;
    return calls === 1
      ? [{ address: '93.184.216.34', family: 4 }]
      : [{ address: '127.0.0.1', family: 4 }];
  });
  await validateRegisteredUrl(new URL('https://game.example.com'), registration, resolver);
  await assert.rejects(
    validateRegisteredUrl(new URL('https://game.example.com'), registration, resolver),
    (error: unknown) => error instanceof RuntimeError && error.code === 'TARGET_BLOCKED',
  );
});

test('sandbox policy is deny-by-default with only trusted concrete hosts', () => {
  const policy = buildSandboxNetworkPolicy(registration);
  assert.deepEqual(policy.allow, ['game.example.com', 'cdn.example.com']);
  assert.ok(policy.subnets.deny.includes('10.0.0.0/8'));
  assert.ok(policy.subnets.deny.includes('169.254.0.0/16'));
  assert.equal(policy.subnets.deny.some((cidr) => cidr.includes(':')), false);
  assert.equal('mode' in policy, false);
  assert.equal('allowedDomains' in policy, false);
  assert.equal('allowedCIDRs' in policy, false);
  assert.equal('deniedCIDRs' in policy, false);
});
