import { domainToASCII } from 'node:url';

export interface RuntimeConfig {
  limits: {
    maxSessionLifetimeMs: number;
    maxIdleMs: number;
    maxActionsPerInput: number;
    maxActionsPerSession: number;
    maxSingleWaitMs: number;
    maxRelativePointerDelta: number;
  };
  trust: {
    projectId: string;
    repositoryOwner: string;
    repositoryName: string;
    approvedDeploymentHostPatterns: string[];
    approvedDependencyHosts: string[];
    approvedRedirectHosts: string[];
  };
}

function positiveInt(env: Record<string, string | undefined>, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${key} must be a positive integer`);
  return value;
}

function positiveNumber(env: Record<string, string | undefined>, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${key} must be positive`);
  return value;
}

function normalizeHost(raw: string): string {
  const trimmed = raw.trim().toLowerCase().replace(/\.$/, '');
  if (!trimmed) throw new Error('empty hostname');
  const wildcard = trimmed.startsWith('*.');
  const body = wildcard ? trimmed.slice(2) : trimmed;
  const ascii = domainToASCII(body);
  if (!ascii || ascii.includes('/') || ascii.includes(':') || !/^[a-z0-9.-]+$/.test(ascii)) {
    throw new Error(`invalid hostname: ${raw}`);
  }
  return wildcard ? `*.${ascii}` : ascii;
}

function hostList(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return [...new Set(raw.split(',').map(normalizeHost))];
}

export function loadRuntimeConfig(env: Record<string, string | undefined> = process.env): RuntimeConfig {
  return {
    limits: {
      maxSessionLifetimeMs: positiveInt(env, 'MAX_SESSION_LIFETIME_MS', 15 * 60_000),
      maxIdleMs: positiveInt(env, 'MAX_IDLE_MS', 3 * 60_000),
      maxActionsPerInput: positiveInt(env, 'MAX_ACTIONS_PER_INPUT', 20),
      maxActionsPerSession: positiveInt(env, 'MAX_ACTIONS_PER_SESSION', 500),
      maxSingleWaitMs: positiveInt(env, 'MAX_SINGLE_WAIT_MS', 10_000),
      maxRelativePointerDelta: positiveNumber(env, 'MAX_RELATIVE_POINTER_DELTA', 2000),
    },
    trust: {
      projectId: env.TARGET_PROJECT_ID?.trim() ?? '',
      repositoryOwner: env.TARGET_REPOSITORY_OWNER?.trim() ?? '',
      repositoryName: env.TARGET_REPOSITORY_NAME?.trim() ?? '',
      approvedDeploymentHostPatterns: hostList(env.APPROVED_DEPLOYMENT_HOST_PATTERNS),
      approvedDependencyHosts: hostList(env.APPROVED_DEPENDENCY_HOSTS),
      approvedRedirectHosts: hostList(env.APPROVED_REDIRECT_HOSTS),
    },
  };
}
