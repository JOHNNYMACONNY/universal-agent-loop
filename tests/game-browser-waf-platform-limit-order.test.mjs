import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflowUrl = new URL('../.github/workflows/game-browser-mcp-bootstrap.yml', import.meta.url);
const workflow = await readFile(workflowUrl, 'utf8');

test('HTTP 200 WAF configuration is verified before provider-limit diagnostic classification', () => {
  const verifiedProbe = workflow.indexOf('if [ "$waf_http" = "200" ] && verify_waf; then');
  const limitationProbe = workflow.indexOf('is_platform_limit "$waf_http" /tmp/waf-config.json');

  assert.notEqual(verifiedProbe, -1);
  assert.notEqual(limitationProbe, -1);
  assert.ok(verifiedProbe < limitationProbe);
});
