import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

function assertCommitSha(value: string): void {
  if (!/^[0-9a-f]{40}$/i.test(value)) throw new Error('UAL commit SHA must be exactly 40 hexadecimal characters');
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export interface SkillPackagePaths {
  skillPath: string;
  metadataPath: string;
}

export async function buildCanonicalSkillPackage(input: {
  canonicalPath: URL | string;
  outputDir: string;
  ualCommitSha: string;
}): Promise<SkillPackagePaths> {
  assertCommitSha(input.ualCommitSha);
  const canonicalBytes = await readFile(input.canonicalPath);
  const skillPath = join(input.outputDir, 'skills', 'game-browser-testing', 'SKILL.md');
  const metadataPath = join(input.outputDir, 'skill-package.json');
  await mkdir(dirname(skillPath), { recursive: true });
  await writeFile(skillPath, canonicalBytes);
  await writeFile(metadataPath, `${JSON.stringify({
    ual_commit_sha: input.ualCommitSha.toLowerCase(),
    canonical_path: 'skills/game-browser-testing/SKILL.md',
    skill_sha256: sha256(canonicalBytes),
  }, null, 2)}\n`, 'utf8');
  return { skillPath, metadataPath };
}

export async function verifyCanonicalSkillPackage(input: {
  canonicalPath: URL | string;
  skillPath: string;
  metadataPath: string;
  expectedCommitSha: string;
}): Promise<void> {
  assertCommitSha(input.expectedCommitSha);
  const [canonicalBytes, packagedBytes, metadataRaw] = await Promise.all([
    readFile(input.canonicalPath),
    readFile(input.skillPath),
    readFile(input.metadataPath, 'utf8'),
  ]);
  const metadata = JSON.parse(metadataRaw) as Record<string, unknown>;
  if (metadata.ual_commit_sha !== input.expectedCommitSha.toLowerCase()) throw new Error('skill package commit mismatch');
  if (metadata.canonical_path !== 'skills/game-browser-testing/SKILL.md') throw new Error('skill package canonical path mismatch');
  const canonicalHash = sha256(canonicalBytes);
  const packagedHash = sha256(packagedBytes);
  if (canonicalHash !== packagedHash || metadata.skill_sha256 !== canonicalHash) throw new Error('skill package byte/hash drift detected');
}

async function main(): Promise<void> {
  const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
  const canonicalPath = new URL('../../../skills/game-browser-testing/SKILL.md', import.meta.url);
  const outputDir = process.env.SKILL_PACKAGE_OUTPUT ?? join(repoRoot, '.generated', 'game-browser-plugin');
  const commitSha = process.env.UAL_COMMIT_SHA ?? process.env.GITHUB_SHA;
  if (!commitSha) throw new Error('UAL_COMMIT_SHA or GITHUB_SHA is required');
  const paths = await buildCanonicalSkillPackage({ canonicalPath, outputDir, ualCommitSha: commitSha });
  await verifyCanonicalSkillPackage({ canonicalPath, ...paths, expectedCommitSha: commitSha });
  process.stdout.write(`${JSON.stringify({ ok: true, outputDir, commit: commitSha })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
