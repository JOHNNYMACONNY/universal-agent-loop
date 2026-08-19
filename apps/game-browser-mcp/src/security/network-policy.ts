import type { TargetRegistration } from '../contracts.js';

export interface SandboxNetworkPolicy {
  mode: 'custom';
  allowedDomains: string[];
  allowedCIDRs: string[];
  deniedCIDRs: string[];
}

export function buildSandboxNetworkPolicy(registration: TargetRegistration): SandboxNetworkPolicy {
  return {
    mode: 'custom',
    allowedDomains: [...new Set(registration.allowed_hosts.map((host) => host.toLowerCase()))],
    allowedCIDRs: [],
    deniedCIDRs: [],
  };
}
