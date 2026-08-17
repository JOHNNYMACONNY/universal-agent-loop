// Durable repo-local state (.agent-loop/state.json). Smallest footprint:
// created only when the caller decides durable state is required.
import fs from 'node:fs';
import path from 'node:path';
import { isValidTransition } from './lifecycle.js';
import { gitFacts } from './git.js';

const DIR = '.agent-loop';
const FILE = 'state.json';

export function statePath(root) {
  return path.join(root, DIR, FILE);
}

export function readState(root) {
  try {
    return JSON.parse(fs.readFileSync(statePath(root), 'utf8'));
  } catch {
    return null;
  }
}

export function writeState(root, state) {
  const dir = path.join(root, DIR);
  fs.mkdirSync(dir, { recursive: true });
  const next = { ...state, version: 1, updated_at: new Date().toISOString() };
  if (!next.created_at) next.created_at = next.updated_at;
  fs.writeFileSync(statePath(root), JSON.stringify(next, null, 2) + '\n');
  return next;
}

export function initState(root, { project, task, authority = [], lifecycleState = 'DISCOVER' }) {
  const existing = readState(root);
  if (existing) return { state: existing, created: false };
  const state = writeState(root, {
    project,
    task,
    lifecycle_state: lifecycleState,
    authority,
    artifacts: {},
    verification: [],
    history: [{ state: lifecycleState, at: new Date().toISOString(), note: 'init' }],
  });
  return { state, created: true };
}

// Transition with edge validation. Returns { ok, state?, error? }.
// opts.controlPlaneDirective is required for COMPLETE_LOCAL -> PUBLISH_GATE.
export function transition(root, to, note = '', opts = {}) {
  const current = readState(root);
  if (!current) return { ok: false, error: 'no state file; run state init first' };
  const from = current.lifecycle_state;
  if (!isValidTransition(from, to, opts)) {
    return { ok: false, error: `invalid transition ${from} -> ${to}` };
  }
  current.lifecycle_state = to;
  current.history = [...(current.history || []), { state: to, at: new Date().toISOString(), note }];
  writeState(root, current);
  return { ok: true, state: current };
}

// Verification evidence is anchored to the implementation identity it
// exercised: current git HEAD (when in a repo). A later commit makes the
// evidence stale.
export function recordVerification(root, command, result) {
  const current = readState(root);
  if (!current) return { ok: false, error: 'no state file' };
  const git = gitFacts(root);
  current.verification = [...(current.verification || []),
    { command, result, head: git.isRepo ? git.head : null, at: new Date().toISOString() }];
  writeState(root, current);
  return { ok: true };
}

// Critic evidence is anchored to BOTH the implementation identity (HEAD)
// and the verification evidence it reviewed (verification_index). Any later
// commit or re-verification makes the critic pass stale. A critic pass is
// evidence for the CRITIC gate only — never proof of project completion
// by itself, and never an expansion of the authority set.
export const CRITIC_METHODS = ['code-review', 'subagent', 'fresh-prompt'];

export function recordCritic(root, { result, method = 'code-review' } = {}) {
  const current = readState(root);
  if (!current) return { ok: false, error: 'no state file' };
  if (!['pass', 'fail'].includes(result)) {
    return { ok: false, error: 'critic result must be pass|fail' };
  }
  const git = gitFacts(root);
  current.critic = {
    result,
    method: CRITIC_METHODS.includes(method) ? method : 'fresh-prompt',
    head: git.isRepo ? git.head : null,
    verification_index: (current.verification || []).length - 1,
    at: new Date().toISOString(),
  };
  writeState(root, current);
  return { ok: true, critic: current.critic };
}
