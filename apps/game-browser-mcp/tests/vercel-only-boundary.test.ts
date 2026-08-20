import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('..', import.meta.url));
const pkg = JSON.parse(readFileSync(`${root}/package.json`, 'utf8')) as { dependencies?: Record<string, string> };

test('production package has no Upstash dependency or obsolete Redis adapters', () => {
  assert.equal(pkg.dependencies?.['@upstash/redis'], undefined);
  assert.equal(existsSync(`${root}/src/sessions/upstash-session-store.ts`), false);
  assert.equal(existsSync(`${root}/src/provenance/upstash-registration-store.ts`), false);
});

test('production server and runtime README do not require Redis credentials', () => {
  const server = readFileSync(`${root}/src/server.ts`, 'utf8');
  const readme = readFileSync(`${root}/README.md`, 'utf8');
  for (const marker of ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']) {
    assert.equal(server.includes(marker), false, `server still references ${marker}`);
    assert.equal(readme.includes(marker), false, `README still references ${marker}`);
  }
});
