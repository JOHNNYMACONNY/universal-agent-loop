import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';

import type { TargetRegistration } from '../contracts.js';
import { RuntimeError } from '../errors.js';

export type DnsAnswer = { address: string; family: 4 | 6 };
export type DnsResolver = (hostname: string) => Promise<DnsAnswer[]>;

const defaultResolver: DnsResolver = async (hostname) => {
  const answers = await lookup(hostname, { all: true, verbatim: true });
  return answers.map(({ address, family }) => ({ address, family: family as 4 | 6 }));
};

function ipv4Int(address: string): number {
  return address.split('.').reduce((acc, part) => ((acc << 8) | Number(part)) >>> 0, 0);
}

function inV4(address: string, base: string, bits: number): boolean {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipv4Int(address) & mask) === (ipv4Int(base) & mask);
}

function globallyRoutableV4(address: string): boolean {
  const blocked: Array<[string, number]> = [
    ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
    ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
    ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
    ['224.0.0.0', 4], ['240.0.0.0', 4],
  ];
  return !blocked.some(([base, bits]) => inV4(address, base, bits));
}

function globallyRoutableV6(address: string): boolean {
  const value = address.toLowerCase();
  if (value === '::' || value === '::1') return false;
  if (value.startsWith('fc') || value.startsWith('fd')) return false;
  if (/^fe[89ab]/.test(value)) return false;
  if (value.startsWith('ff')) return false;
  if (value.startsWith('2001:db8')) return false;
  if (value.startsWith('::ffff:')) {
    const mapped = value.slice('::ffff:'.length);
    return isIP(mapped) === 4 && globallyRoutableV4(mapped);
  }
  return true;
}

export function isGloballyRoutableAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return globallyRoutableV4(address);
  if (family === 6) return globallyRoutableV6(address);
  return false;
}

export function createRebindingAwareResolver(resolve: DnsResolver = defaultResolver): DnsResolver {
  return async (hostname) => resolve(hostname);
}

export async function validateRegisteredUrl(
  url: URL,
  registration: TargetRegistration,
  resolve: DnsResolver = defaultResolver,
): Promise<void> {
  if (url.protocol !== 'https:') throw new RuntimeError('TARGET_BLOCKED', 'HTTPS target required');
  if (url.username || url.password) throw new RuntimeError('TARGET_BLOCKED', 'userinfo is not allowed in target URLs');

  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!registration.allowed_hosts.includes(host)) {
    throw new RuntimeError('TARGET_BLOCKED', 'host is not present in trusted target registration');
  }
  if (host === 'localhost' || host.endsWith('.localhost')) {
    throw new RuntimeError('TARGET_BLOCKED', 'localhost is forbidden');
  }

  const literalFamily = isIP(host);
  const answers = literalFamily
    ? [{ address: host, family: literalFamily as 4 | 6 }]
    : await resolve(host);

  if (answers.length === 0 || answers.some(({ address }) => !isGloballyRoutableAddress(address))) {
    throw new RuntimeError('TARGET_BLOCKED', 'target resolves to a private, reserved, or non-routable address');
  }
}
