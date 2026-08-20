import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflowUrl = new URL('../.github/workflows/game-browser-mcp-bootstrap.yml', import.meta.url);
const workflow = await readFile(workflowUrl, 'utf8');

test('provider bootstrap serializes all shared preview mutations', () => {
  assert.match(workflow, /^concurrency:\n(?: {2}.+\n)+/m, 'bootstrap workflow must declare top-level concurrency');
  assert.match(workflow, /group:\s*game-browser-mcp-bootstrap\b/, 'all bootstrap runs must share one concurrency group');
  assert.match(workflow, /cancel-in-progress:\s*false\b/, 'an already-running exact-commit acceptance must not be cancelled by a later candidate');
});

test('provider bootstrap records coarse MCP rate-limit configuration or a real platform limitation', () => {
  assert.match(workflow, /coarse MCP rate limit/i, 'bootstrap must contain an explicit coarse MCP rate-limit gate');
  assert.match(workflow, /(?:security\/firewall\/config|firewall rules)/, 'rate-limit gate must inspect or configure Vercel Firewall');
  assert.match(workflow, /platform_limited/, 'unsupported plan/capability must be recorded explicitly rather than silently skipped');
  assert.match(workflow, /runtime-completion-metadata\.json/, 'bootstrap must persist the rate-limit outcome as completion evidence');
  assert.doesNotMatch(workflow, /\b(?:buy pro|purchase|upgrade.*plan)\b/i, 'bootstrap must never change billing to obtain WAF rate limiting');
});
