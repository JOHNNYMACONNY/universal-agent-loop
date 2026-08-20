export const REQUIRED_COARSE_RATE_LIMIT = {
  provider: 'vercel-waf' as const,
  status: 'configured' as const,
  ruleName: 'ual-game-browser-mcp-rate-600-per-60s-ip',
  pathPrefix: '/mcp',
  windowSeconds: 60,
  requestsPerWindow: 600,
  key: 'ip',
  algorithm: 'fixed_window',
};

export interface VerifiedCoarseRateLimit {
  provider: 'vercel-waf';
  status: 'configured';
  ruleName: string;
  ruleId: string | null;
  pathPrefix: string;
  windowSeconds: number;
  requestsPerWindow: number;
  key: string;
  algorithm: string;
  limitationReason: null;
}

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function asInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
  return null;
}

function matchesRequiredRule(ruleValue: unknown): VerifiedCoarseRateLimit | null {
  const rule = asRecord(ruleValue);
  if (!rule || rule.name !== REQUIRED_COARSE_RATE_LIMIT.ruleName || rule.active === false) return null;

  const groups = rule.conditionGroup;
  if (!Array.isArray(groups) || groups.length !== 1) return null;
  const group = asRecord(groups[0]);
  const conditions = group?.conditions;
  if (!Array.isArray(conditions) || conditions.length !== 1) return null;
  const condition = asRecord(conditions[0]);
  if (
    !condition ||
    condition.type !== 'path' ||
    condition.op !== 'pre' ||
    condition.value !== REQUIRED_COARSE_RATE_LIMIT.pathPrefix ||
    condition.neg === true
  ) {
    return null;
  }

  const action = asRecord(rule.action);
  const mitigate = asRecord(action?.mitigate);
  const rateLimit = asRecord(mitigate?.rateLimit);
  if (!mitigate || !rateLimit || mitigate.action !== 'rate_limit') return null;

  const windowSeconds = asInteger(rateLimit.window);
  const requestsPerWindow = asInteger(rateLimit.limit);
  const keys = rateLimit.keys;
  if (
    rateLimit.algo !== REQUIRED_COARSE_RATE_LIMIT.algorithm ||
    rateLimit.action !== 'rate_limit' ||
    windowSeconds !== REQUIRED_COARSE_RATE_LIMIT.windowSeconds ||
    requestsPerWindow !== REQUIRED_COARSE_RATE_LIMIT.requestsPerWindow ||
    !Array.isArray(keys) ||
    keys.length !== 1 ||
    keys[0] !== REQUIRED_COARSE_RATE_LIMIT.key
  ) {
    return null;
  }

  return {
    provider: REQUIRED_COARSE_RATE_LIMIT.provider,
    status: REQUIRED_COARSE_RATE_LIMIT.status,
    ruleName: REQUIRED_COARSE_RATE_LIMIT.ruleName,
    ruleId: typeof rule.id === 'string' ? rule.id : null,
    pathPrefix: REQUIRED_COARSE_RATE_LIMIT.pathPrefix,
    windowSeconds,
    requestsPerWindow,
    key: REQUIRED_COARSE_RATE_LIMIT.key,
    algorithm: REQUIRED_COARSE_RATE_LIMIT.algorithm,
    limitationReason: null,
  };
}

export function verifyCoarseRateLimitRule(configValue: unknown): VerifiedCoarseRateLimit | null {
  const config = asRecord(configValue);
  const active = asRecord(config?.active);
  const rules = active?.rules;
  if (!Array.isArray(rules)) return null;

  for (const rule of rules) {
    const verified = matchesRequiredRule(rule);
    if (verified) return verified;
  }
  return null;
}
