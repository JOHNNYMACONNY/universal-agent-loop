import { readFile } from 'node:fs/promises';

import { verifyCoarseRateLimitRule } from '../src/waf-rule.js';

const configPath = process.argv[2];
if (!configPath) {
  console.error('Usage: verify-waf-rule.ts <vercel-firewall-config.json>');
  process.exit(64);
}

let parsed: unknown;
try {
  parsed = JSON.parse(await readFile(configPath, 'utf8')) as unknown;
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Unable to parse Vercel Firewall configuration: ${message}`);
  process.exit(65);
}

const verified = verifyCoarseRateLimitRule(parsed);
if (!verified) {
  console.error('Active Vercel WAF rule does not match the required coarse MCP rate-limit configuration.');
  process.exit(2);
}

process.stdout.write(`${JSON.stringify(verified)}\n`);
