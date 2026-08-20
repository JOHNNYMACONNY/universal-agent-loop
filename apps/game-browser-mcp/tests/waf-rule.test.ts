import test from 'node:test';
import assert from 'node:assert/strict';

import { verifyCoarseRateLimitRule } from '../src/waf-rule.js';

const requiredRule = {
  id: 'rule_required',
  name: 'ual-game-browser-mcp-rate-600-per-60s-ip',
  active: true,
  conditionGroup: [
    {
      conditions: [
        {
          type: 'path',
          op: 'pre',
          value: '/mcp',
          neg: false,
        },
      ],
    },
  ],
  action: {
    mitigate: {
      action: 'rate_limit',
      rateLimit: {
        algo: 'fixed_window',
        window: 60,
        limit: 600,
        keys: ['ip'],
        action: 'rate_limit',
      },
      redirect: null,
      actionDuration: null,
    },
  },
};

test('verifies the complete active Vercel WAF rule and returns normalized evidence', () => {
  const result = verifyCoarseRateLimitRule({ active: { rules: [requiredRule] } });

  assert.deepEqual(result, {
    provider: 'vercel-waf',
    status: 'configured',
    ruleName: 'ual-game-browser-mcp-rate-600-per-60s-ip',
    ruleId: 'rule_required',
    pathPrefix: '/mcp',
    windowSeconds: 60,
    requestsPerWindow: 600,
    key: 'ip',
    algorithm: 'fixed_window',
    limitationReason: null,
  });
});

test('rejects a same-name active rule whose path condition drifted', () => {
  const drifted = structuredClone(requiredRule);
  drifted.conditionGroup[0]!.conditions[0]!.value = '/admin';

  assert.equal(verifyCoarseRateLimitRule({ active: { rules: [drifted] } }), null);
});

test('rejects a same-name active rule whose rate-limit configuration drifted', () => {
  const drifted = structuredClone(requiredRule);
  drifted.action.mitigate.rateLimit.limit = 1000;

  assert.equal(verifyCoarseRateLimitRule({ active: { rules: [drifted] } }), null);
});

test('rejects a same-name rule with extra narrowing conditions', () => {
  const drifted = structuredClone(requiredRule);
  drifted.conditionGroup[0]!.conditions.push({
    type: 'header',
    op: 'eq',
    key: 'x-test',
    value: '1',
    neg: false,
  } as never);

  assert.equal(verifyCoarseRateLimitRule({ active: { rules: [drifted] } }), null);
});
