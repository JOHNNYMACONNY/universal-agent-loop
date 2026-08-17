// Git fact extraction. Read-only: this module never mutates the repo.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

function git(root, args) {
  try {
    const out = execFileSync('git', ['-C', root, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return out.trim();
  } catch {
    return null;
  }
}

export function gitFacts(root) {
  const inside = git(root, ['rev-parse', '--is-inside-work-tree']);
  if (inside !== 'true') return { isRepo: false };

  const head = git(root, ['rev-parse', 'HEAD']);
  const branch = git(root, ['symbolic-ref', '--short', '-q', 'HEAD']) || null;
  const detached = head !== null && branch === null;

  const porcelain = git(root, ['status', '--porcelain=v1', '--untracked-files=normal']) || '';
  const changes = [];
  for (const line of porcelain.split('\n')) {
    if (!line.trim()) continue;
    const x = line[0];
    const y = line[1];
    const path = line.slice(3).trim();
    changes.push({ path, index: x, worktree: y });
  }
  const staged = changes.filter((c) => c.index !== ' ' && c.index !== '?').map((c) => c.path);
  const modified = changes.filter((c) => c.worktree !== ' ' && c.worktree !== '?').map((c) => c.path);
  const untracked = changes.filter((c) => c.index === '?').map((c) => c.path);

  const worktreesRaw = git(root, ['worktree', 'list', '--porcelain']) || '';
  const worktrees = worktreesRaw
    .split('\n')
    .filter((l) => l.startsWith('worktree '))
    .map((l) => l.slice('worktree '.length));

  const branches = (git(root, ['branch', '--format=%(refname:short)']) || '')
    .split('\n')
    .map((b) => b.trim())
    .filter(Boolean);

  const logRaw = git(root, ['log', '-n', '10', '--format=%H%x09%s']) || '';
  const recentCommits = logRaw
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [sha, ...rest] = l.split('\t');
      return { sha, subject: rest.join('\t') };
    });

  const remotesRaw = git(root, ['remote', '-v']) || '';
  const remotes = [...new Set(
    remotesRaw.split('\n').filter(Boolean).map((l) => l.split(/\s+/)[0]),
  )];

  return {
    isRepo: true,
    head,
    branch,
    detached,
    dirty: changes.length > 0,
    staged,
    modified,
    untracked,
    changes,
    worktrees,
    branches,
    recentCommits,
    remotes,
  };
}

// Implementation fingerprint (protocol/lifecycle.md freshness rules).
// Deterministic identity of the ACTUAL local implementation state:
//   HEAD + staged tracked diff + unstaged tracked diff + relevant
//   untracked files (path + content hash).
// Exclusions: `.agent-loop/` (protocol-owned ephemeral state) is always
// invisible to the fingerprint — even when tracked — so recording evidence
// never invalidates itself. Git-ignored files are excluded by porcelain
// semantics. Returns null outside a git repository.
export function implementationFingerprint(root) {
  const inside = git(root, ['rev-parse', '--is-inside-work-tree']);
  if (inside !== 'true') return null;

  const head = git(root, ['rev-parse', 'HEAD']) || 'UNBORN';
  const pathspec = ['--', '.', ':(exclude).agent-loop'];
  const staged = git(root, ['diff', '--cached', '--full-index', ...pathspec]) || '';
  const unstaged = git(root, ['diff', '--full-index', ...pathspec]) || '';

  const statusOut = git(root, ['status', '--porcelain=v1', '--untracked-files=all', ...pathspec]) || '';
  const untracked = statusOut
    .split('\n')
    .filter((l) => l.startsWith('?? '))
    .map((l) => l.slice(3).trim())
    .sort();
  const manifest = [];
  for (const rel of untracked) {
    const abs = path.join(root, rel);
    let stat;
    try { stat = fs.statSync(abs); } catch { continue; }
    if (!stat.isFile()) continue;
    const h = createHash('sha256');
    try { h.update(fs.readFileSync(abs)); } catch { continue; }
    manifest.push(`${rel}:${h.digest('hex')}`);
  }

  return createHash('sha256')
    .update(head).update('\n')
    .update(staged).update('\n')
    .update(unstaged).update('\n')
    .update(manifest.join('\n'))
    .digest('hex');
}

// PR discovery via `gh`. Returns null when gh is unavailable/errors, so
// callers can degrade gracefully. Tests inject a fake gh via AGENT_LOOP_GH.
export function ghOpenPrs(root) {
  const ghBin = process.env.AGENT_LOOP_GH || 'gh';
  let out;
  try {
    out = execFileSync(
      ghBin,
      ['pr', 'list', '--state', 'open', '--json',
        'number,title,headRefName,url,statusCheckRollup'],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
  } catch {
    return null;
  }
  let prs;
  try {
    prs = JSON.parse(out);
  } catch {
    return null;
  }
  return prs.map((pr) => ({ ...pr, checks: summarizeChecks(pr.statusCheckRollup) }));
}

function summarizeChecks(rollup) {
  if (!Array.isArray(rollup) || rollup.length === 0) return 'none';
  let pending = false;
  for (const c of rollup) {
    const status = (c.status || '').toUpperCase();
    const conclusion = (c.conclusion || '').toUpperCase();
    if (status && status !== 'COMPLETED') { pending = true; continue; }
    if (['FAILURE', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED'].includes(conclusion)) {
      return 'failing';
    }
  }
  if (pending) return 'pending';
  return 'passing';
}
