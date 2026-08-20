import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSandboxNetworkPolicyForHosts } from '../src/security/network-policy.js';
import { isGloballyRoutableAddress } from '../src/security/url-policy.js';

test('Vercel Sandbox subnet policy emits only provider-accepted special/private IPv4 CIDRs', () => {
  const policy = buildSandboxNetworkPolicyForHosts(['game.example.com']);

  assert.ok(policy.subnets.deny.length > 0);
  assert.equal(policy.subnets.deny.some((cidr) => cidr.includes(':')), false);
  assert.ok(policy.subnets.deny.includes('10.0.0.0/8'));
  assert.ok(policy.subnets.deny.includes('127.0.0.0/8'));
  assert.ok(policy.subnets.deny.includes('169.254.0.0/16'));
  assert.ok(policy.subnets.deny.includes('192.168.0.0/16'));
  assert.ok(policy.subnets.deny.includes('224.0.0.0/4'));
  assert.equal(policy.subnets.deny.includes('240.0.0.0/4'), false);
});

test('application URL guard continues rejecting provider-unsupported and IPv6 reserved addresses', () => {
  for (const address of ['240.0.0.1', '255.255.255.255', '::', '::1', 'fc00::1', 'fd12::1', 'fe80::1', 'ff02::1', '2001:db8::1']) {
    assert.equal(isGloballyRoutableAddress(address), false, `expected ${address} to remain blocked`);
  }
});
