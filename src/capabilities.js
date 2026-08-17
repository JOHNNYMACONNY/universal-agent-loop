// Harness capability detection (capabilities.md). Hermetic by default;
// network probes only with { probe: true }.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import dns from 'node:dns/promises';

function has(cmd, args = ['--version']) {
  try {
    execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    return true;
  } catch {
    return false;
  }
}

export async function detectCapabilities(root, { probe = false, harness = {} } = {}) {
  const git = has('git');
  let filesystem = false;
  try {
    fs.accessSync(root, fs.constants.R_OK | fs.constants.W_OK);
    filesystem = true;
  } catch { /* false */ }

  let github = false;
  const ghBin = process.env.AGENT_LOOP_GH || 'gh';
  try {
    execFileSync(ghBin, ['auth', 'status'], { stdio: ['ignore', 'pipe', 'pipe'] });
    github = true;
  } catch { /* false */ }

  let network = 'unknown';
  if (probe) {
    try {
      await dns.lookup('github.com');
      network = true;
    } catch {
      network = false;
    }
  }

  const caps = {
    shell: true,
    filesystem,
    git,
    worktrees: git,
    github_read: github,
    github_write: github,
    network,
    ci_visibility: github,
    deployment_access: false,
    secret_access: false,
    // Harness-reported capabilities the engine cannot detect itself.
    browser: 'unknown',
    screenshots: 'unknown',
    subagents: 'unknown',
    skills: 'unknown',
    mcp: 'unknown',
    ...harness,
  };
  return caps;
}
