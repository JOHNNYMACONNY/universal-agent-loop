import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const runtimePackage = new URL('../apps/game-browser-mcp/package.json', import.meta.url);
const rootPackage = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

test('browser runtime is independently packaged and root stays dependency-free', async () => {
  const child = JSON.parse(await readFile(runtimePackage, 'utf8'));
  assert.equal(child.name, '@ual/game-browser-mcp');
  assert.equal(rootPackage.dependencies, undefined);
  assert.equal(rootPackage.devDependencies, undefined);
});
