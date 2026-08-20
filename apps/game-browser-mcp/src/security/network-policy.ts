import type { TargetRegistration } from '../contracts.js';

export interface SandboxNetworkPolicy {
  allow: string[];
  subnets: {
    deny: string[];
  };
}

// Vercel Sandbox v3 currently accepts IPv4 CIDRs for subnet policy and rejects
// IPv6 CIDRs such as ::/128. Private/reserved IPv6 remains blocked by the
// application URL/DNS guard before browser navigation.
export const PRIVATE_RESERVED_CIDRS = [
  '0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8',
  '169.254.0.0/16', '172.16.0.0/12', '192.0.0.0/24', '192.0.2.0/24',
  '192.168.0.0/16', '198.18.0.0/15', '198.51.100.0/24', '203.0.113.0/24',
  '224.0.0.0/4', '240.0.0.0/4',
] as const;

export function buildSandboxNetworkPolicyForHosts(hosts: string[]): SandboxNetworkPolicy {
  return {
    allow: [...new Set(hosts.map((host) => host.toLowerCase()))],
    subnets: { deny: [...PRIVATE_RESERVED_CIDRS] },
  };
}

export function buildSandboxNetworkPolicy(registration: TargetRegistration): SandboxNetworkPolicy {
  return buildSandboxNetworkPolicyForHosts(registration.allowed_hosts);
}
