import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const snapshotBuilderUrl = new URL('../scripts/create-browser-snapshot.ts', import.meta.url);

test('browser snapshot builder stays on the Sandbox v3 image API used by snapshot consumers', async () => {
  const source = await readFile(snapshotBuilderUrl, 'utf8');

  assert.match(
    source,
    /image:\s*['"]vercel\/sandbox\/node:24['"]/,
    '@vercel/sandbox 3.x snapshot builders must use the v3 managed-image path',
  );
  assert.doesNotMatch(
    source,
    /runtime:\s*['"]node24['"]/,
    'runtime: node24 forces the legacy v2 create API and can produce a snapshot incompatible with the v3 named-sandbox restore path',
  );
});
