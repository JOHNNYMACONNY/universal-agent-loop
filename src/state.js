// Durable repo-local state (.agent-loop/state.json). Smallest footprint:
// created only when the caller decides durable state is required.
import fs from 'node:fs';
import path from 'node:path';
import { isValidTransition } from './lifecycle.js';

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
export function transition(root, to, note = '') {
  const current = readState(root);
  if (!current) return { ok: false, error: 'no state file; run state init first' };
  const from = current.lifecycle_state;
  if (!isValidTransition(from, to)) {
    return { ok: false, error: `invalid transition ${from} -> ${to}` };
  }
  current.lifecycle_state = to;
  current.history = [...(current.history || []), { state: to, at: new Date().toISOString(), note }];
  writeState(root, current);
  return { ok: true, state: current };
}

export function recordVerification(root, command, result) {
  const current = readState(root);
  if (!current) return { ok: false, error: 'no state file' };
  current.verification = [...(current.verification || []),
    { command, result, at: new Date().toISOString() }];
  writeState(root, current);
  return { ok: true };
}
