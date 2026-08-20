import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildCanonicalSkillPackage, verifyCanonicalSkillPackage } from '../scripts/check-skill-package.js';

const COMMIT = 'a'.repeat(40);
const canonicalUrl = new URL('../../../skills/game-browser-testing/SKILL.md', import.meta.url);

test('generated package bytes equal canonical skill and metadata pins commit + content hash', async () => {
  const out = await mkdtemp(join(tmpdir(), 'gbr-skill-'));
  const result = await buildCanonicalSkillPackage({ canonicalPath: canonicalUrl, outputDir: out, ualCommitSha: COMMIT });
  const canonical = await readFile(canonicalUrl);
  const packaged = await readFile(result.skillPath);
  assert.deepEqual(packaged, canonical);
  const metadata = JSON.parse(await readFile(result.metadataPath, 'utf8'));
  assert.equal(metadata.ual_commit_sha, COMMIT);
  assert.match(metadata.skill_sha256, /^[0-9a-f]{64}$/);
  assert.equal(metadata.canonical_path, 'skills/game-browser-testing/SKILL.md');
  await verifyCanonicalSkillPackage({ canonicalPath: canonicalUrl, skillPath: result.skillPath, metadataPath: result.metadataPath, expectedCommitSha: COMMIT });
});

test('verification fails on byte drift or commit mismatch', async () => {
  const out = await mkdtemp(join(tmpdir(), 'gbr-skill-drift-'));
  const result = await buildCanonicalSkillPackage({ canonicalPath: canonicalUrl, outputDir: out, ualCommitSha: COMMIT });
  await writeFile(result.skillPath, 'drift\n', 'utf8');
  await assert.rejects(verifyCanonicalSkillPackage({ canonicalPath: canonicalUrl, skillPath: result.skillPath, metadataPath: result.metadataPath, expectedCommitSha: COMMIT }), /drift|hash/i);

  const fresh = await mkdtemp(join(tmpdir(), 'gbr-skill-commit-'));
  const packaged = await buildCanonicalSkillPackage({ canonicalPath: canonicalUrl, outputDir: fresh, ualCommitSha: COMMIT });
  await assert.rejects(verifyCanonicalSkillPackage({ canonicalPath: canonicalUrl, skillPath: packaged.skillPath, metadataPath: packaged.metadataPath, expectedCommitSha: 'b'.repeat(40) }), /commit/i);
});

test('packaging rejects an unpinned commit identifier', async () => {
  const out = await mkdtemp(join(tmpdir(), 'gbr-skill-invalid-'));
  await assert.rejects(buildCanonicalSkillPackage({ canonicalPath: canonicalUrl, outputDir: out, ualCommitSha: 'main' }), /40|commit/i);
});
