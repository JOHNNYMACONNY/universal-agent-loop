import {
  readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, rmSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';

const encoded = process.argv[2];
if (!encoded) respondError('INVALID_ARGUMENT', 'missing request');
let request;
try { request = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')); }
catch { respondError('INVALID_ARGUMENT', 'invalid request encoding'); }
const session = typeof request.session_id === 'string' ? request.session_id : '';
if (!session || !/^[A-Za-z0-9_.-]{1,128}$/.test(session)) respondError('INVALID_ARGUMENT', 'invalid session');

const root = process.env.GBR_ROOT || '/vercel/sandbox/.game-browser';
const ledgerPath = `${root}/${session}.json`;
const lockPath = `${root}/${session}.lock`;
mkdirSync(root, { recursive: true });

function respondError(code, detail) {
  process.stdout.write(JSON.stringify({ ok: false, error: code, detail }));
  process.exit(1);
}
function output(data) { process.stdout.write(JSON.stringify({ ok: true, ...data })); }
function sleep(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
function withLock(fn) {
  const deadline = Date.now() + 180_000;
  while (true) {
    try { mkdirSync(lockPath); break; }
    catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      if (Date.now() >= deadline) throw workerError('SESSION_RECOVERY_REQUIRED', 'sandbox ledger lock timed out');
      sleep(10);
    }
  }
  try { return fn(); }
  finally { rmSync(lockPath, { recursive: true, force: true }); }
}
function workerError(code, detail) {
  const error = new Error(detail);
  error.workerCode = code;
  return error;
}
function normalizeLedger(value) {
  if (!value) return value;
  value.browserBatches ??= value.batches ?? {};
  value.browserRecoveryRequired ??= value.recoveryRequired ?? false;
  value.coordinatorBatches ??= {};
  value.pendingBatchId ??= null;
  value.recoveryReason ??= null;
  value.sessionRecord ??= null;
  return value;
}
function load() {
  return existsSync(ledgerPath) ? normalizeLedger(JSON.parse(readFileSync(ledgerPath, 'utf8'))) : null;
}
function save(value) {
  const temp = `${ledgerPath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temp, JSON.stringify(value), { mode: 0o600 });
  renameSync(temp, ledgerPath);
}
function ab(args, { allowFailure = false } = {}) {
  const proc = spawnSync('agent-browser', ['--session', session, '--json', ...args.map(String)], {
    encoding: 'utf8', shell: false, timeout: 30_000,
  });
  let parsed = null;
  try { parsed = proc.stdout ? JSON.parse(proc.stdout) : null; } catch { parsed = proc.stdout; }
  if (!allowFailure && (proc.status !== 0 || parsed?.success === false)) {
    throw new Error(String(parsed?.error ?? proc.stderr ?? `agent-browser ${args[0]} failed`));
  }
  return parsed?.data ?? parsed;
}
function held(ledger) {
  return { heldKeys: [...ledger.heldKeys], heldPointerButtons: [...ledger.heldPointerButtons] };
}
function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
function release(ledger) {
  for (const key of [...ledger.heldKeys]) { try { ab(['keyup', key]); } catch {} }
  for (const button of [...ledger.heldPointerButtons]) { try { ab(['mouse', 'up', button]); } catch {} }
  ledger.heldKeys = [];
  ledger.heldPointerButtons = [];
  save(ledger);
}
function dataString(value) { return typeof value === 'string' ? value : JSON.stringify(value ?? ''); }
function observe(ledger) {
  const url = dataString(ab(['get', 'url']));
  const title = dataString(ab(['get', 'title'], { allowFailure: true }));
  const accessibilitySnapshot = dataString(ab(['snapshot'], { allowFailure: true }));
  const consoleErrors = ab(['console'], { allowFailure: true }) ?? [];
  const pageErrors = ab(['errors'], { allowFailure: true }) ?? [];
  const requests = ab(['network', 'requests'], { allowFailure: true }) ?? [];
  const shotPath = `${root}/${session}-latest.png`;
  ab(['screenshot', shotPath], { allowFailure: true });
  let screenshot;
  try { screenshot = { base64: readFileSync(shotPath).toString('base64') }; } catch {}
  return {
    url, title, accessibilitySnapshot,
    consoleErrors: [
      ...(Array.isArray(consoleErrors) ? consoleErrors : [consoleErrors]),
      ...(Array.isArray(pageErrors) ? pageErrors : [pageErrors]),
    ],
    failedRequests: Array.isArray(requests) ? requests.filter((item) => item?.failed || item?.status >= 400) : [],
    ...(screenshot ? { screenshot } : {}),
    capturedAt: new Date().toISOString(),
    ...held(ledger),
  };
}
function act(ledger, action) {
  switch (action.type) {
    case 'key_down':
      ab(['keydown', action.key]);
      if (!ledger.heldKeys.includes(action.key)) ledger.heldKeys.push(action.key);
      break;
    case 'key_up':
      ab(['keyup', action.key]);
      ledger.heldKeys = ledger.heldKeys.filter((key) => key !== action.key);
      break;
    case 'press':
      if (action.duration_ms) {
        ab(['keydown', action.key]);
        if (!ledger.heldKeys.includes(action.key)) ledger.heldKeys.push(action.key);
        save(ledger);
        ab(['wait', String(action.duration_ms)]);
        ab(['keyup', action.key]);
        ledger.heldKeys = ledger.heldKeys.filter((key) => key !== action.key);
      } else ab(['press', action.key]);
      break;
    case 'pointer_move':
      ledger.pointerX = action.x; ledger.pointerY = action.y;
      ab(['mouse', 'move', action.x, action.y]);
      break;
    case 'pointer_move_relative':
      ledger.pointerX = clamp(ledger.pointerX + action.delta_x, 0, ledger.viewport.width - 1);
      ledger.pointerY = clamp(ledger.pointerY + action.delta_y, 0, ledger.viewport.height - 1);
      ab(['mouse', 'move', ledger.pointerX, ledger.pointerY]);
      break;
    case 'pointer_down': {
      const button = action.button ?? 'left';
      ab(['mouse', 'down', button]);
      if (!ledger.heldPointerButtons.includes(button)) ledger.heldPointerButtons.push(button);
      break;
    }
    case 'pointer_up': {
      const button = action.button ?? 'left';
      ab(['mouse', 'up', button]);
      ledger.heldPointerButtons = ledger.heldPointerButtons.filter((value) => value !== button);
      break;
    }
    case 'click': {
      const button = action.button ?? 'left';
      ab(['mouse', 'move', action.x, action.y]);
      ledger.pointerX = action.x; ledger.pointerY = action.y;
      ab(['mouse', 'down', button]); ab(['mouse', 'up', button]);
      break;
    }
    case 'scroll': ab(['mouse', 'wheel', action.delta_y, action.delta_x ?? 0]); break;
    case 'wait': ab(['wait', String(action.duration_ms)]); break;
    default: throw new Error('unsupported action');
  }
  save(ledger);
}
function requireLedger() {
  const ledger = load();
  if (!ledger) throw workerError('SESSION_NOT_FOUND', 'session ledger missing');
  return ledger;
}
function requireRecord(ledger) {
  if (!ledger.sessionRecord) throw workerError('SESSION_NOT_FOUND', 'session record missing');
  return ledger.sessionRecord;
}

function dispatch() {
  if (request.type === 'start') {
    if (typeof request.target_url !== 'string' || !request.target_url.startsWith('https://')) {
      throw workerError('TARGET_BLOCKED', 'invalid target');
    }
    if (existsSync(ledgerPath)) throw workerError('STORAGE_ERROR', 'sandbox session ledger already exists');
    const viewport = request.viewport ?? { width: 1280, height: 720 };
    const ledger = {
      session,
      targetUrl: request.target_url,
      viewport,
      pointerX: Math.floor(viewport.width / 2),
      pointerY: Math.floor(viewport.height / 2),
      heldKeys: [],
      heldPointerButtons: [],
      browserBatches: {},
      browserRecoveryRequired: false,
      ended: false,
      sessionRecord: null,
      coordinatorBatches: {},
      pendingBatchId: null,
      recoveryReason: null,
    };
    if (request.viewport) ab(['set', 'viewport', viewport.width, viewport.height]);
    ab(['open', request.target_url]);
    save(ledger);
    output({ observation: observe(ledger) });
    return;
  }

  const ledger = requireLedger();

  if (request.type === 'health') {
    output({ alive: !ledger.ended && !ledger.browserRecoveryRequired });
    return;
  }
  if (request.type === 'observe') {
    output({ observation: observe(ledger) });
    return;
  }
  if (request.type === 'input') {
    const id = request.action_batch_id;
    const prior = ledger.browserBatches[id];
    if (prior?.state === 'COMPLETE') {
      output({ status: 'COMPLETE', duplicate: true, ...held(ledger), summary: prior.summary ?? {} });
      return;
    }
    if (prior?.state === 'ACCEPTED' || ledger.browserRecoveryRequired) {
      output({ status: 'UNKNOWN', duplicate: true, ...held(ledger) });
      return;
    }
    ledger.browserBatches[id] = { state: 'ACCEPTED' };
    save(ledger);
    try {
      for (const action of request.actions ?? []) act(ledger, action);
      const summary = { actionCount: request.actions.length };
      ledger.browserBatches[id] = { state: 'COMPLETE', summary };
      save(ledger);
      output({ status: 'COMPLETE', duplicate: false, summary, ...held(ledger) });
    } catch (error) {
      ledger.browserRecoveryRequired = true;
      release(ledger);
      save(ledger);
      output({
        status: 'UNKNOWN', duplicate: false,
        summary: { error: error instanceof Error ? error.message : 'input failure' },
        ...held(ledger),
      });
    }
    return;
  }
  if (request.type === 'read_state') {
    const path = request.path ?? '';
    const source = `(() => { const p=${JSON.stringify(path)}; let v=window.__GAME_TEST__; if (p) for (const raw of p.split('/').slice(1)) { const k=raw.replace(/~1/g,'/').replace(/~0/g,'~'); if (v==null || typeof v!=='object') return null; v=v[k]; } return JSON.parse(JSON.stringify(v ?? null)); })()`;
    const value = ab(['eval', '-b', Buffer.from(source).toString('base64')], { allowFailure: true });
    output({ value });
    return;
  }
  if (request.type === 'reset') {
    release(ledger);
    ledger.browserRecoveryRequired = false;
    ledger.browserBatches = {};
    ab(['open', ledger.targetUrl]);
    save(ledger);
    output({ observation: observe(ledger) });
    return;
  }
  if (request.type === 'release') {
    release(ledger); output(held(ledger)); return;
  }
  if (request.type === 'end') {
    release(ledger);
    ab(['close'], { allowFailure: true });
    ledger.ended = true;
    save(ledger);
    output({ ended: true });
    return;
  }

  if (request.type === 'session_create') {
    if (ledger.sessionRecord) throw workerError('STORAGE_ERROR', 'session record already exists');
    if (!request.record || request.record.session_id !== session) throw workerError('STORAGE_ERROR', 'session record binding mismatch');
    ledger.sessionRecord = request.record;
    ledger.coordinatorBatches = {};
    ledger.pendingBatchId = null;
    ledger.recoveryReason = null;
    save(ledger);
    output({ created: true });
    return;
  }
  if (request.type === 'session_get') {
    output({ record: ledger.sessionRecord ?? null });
    return;
  }
  if (request.type === 'session_begin_batch') {
    const record = requireRecord(ledger);
    const prior = ledger.coordinatorBatches[request.batch_id];
    if (prior?.state === 'COMPLETE') {
      output({ kind: 'DUPLICATE', result: prior.result ?? {} });
      return;
    }
    if (prior || ledger.pendingBatchId) throw workerError('SESSION_RECOVERY_REQUIRED', 'another batch is in flight');
    if (record.lifecycle !== 'ACTIVE') throw workerError('SESSION_RECOVERY_REQUIRED', 'session is not active');
    if (record.action_seq !== request.expected_action_seq) throw workerError('ACTION_REJECTED', 'action sequence mismatch');
    const total = record.total_action_count ?? 0;
    if (total + request.action_count > request.max_actions_per_session) {
      throw workerError('LIMIT_EXCEEDED', 'session action budget exceeded');
    }
    record.total_action_count = total + request.action_count;
    ledger.pendingBatchId = request.batch_id;
    ledger.coordinatorBatches[request.batch_id] = { state: 'ACCEPTED' };
    save(ledger);
    output({ kind: 'ACCEPTED', actionSeq: record.action_seq });
    return;
  }
  if (request.type === 'session_complete_batch') {
    const record = requireRecord(ledger);
    const prior = ledger.coordinatorBatches[request.batch_id];
    if (prior?.state === 'COMPLETE') {
      output({ actionSeqAfter: record.action_seq });
      return;
    }
    if (!prior || prior.state !== 'ACCEPTED' || ledger.pendingBatchId !== request.batch_id) {
      throw workerError('SESSION_RECOVERY_REQUIRED', 'batch completion state is ambiguous');
    }
    record.action_seq += 1;
    ledger.pendingBatchId = null;
    ledger.coordinatorBatches[request.batch_id] = { state: 'COMPLETE', result: request.result ?? {} };
    save(ledger);
    output({ actionSeqAfter: record.action_seq });
    return;
  }
  if (request.type === 'session_update_held') {
    const record = requireRecord(ledger);
    record.held_keys = request.held_keys;
    record.held_pointer_buttons = request.held_pointer_buttons;
    save(ledger);
    output({ updated: true });
    return;
  }
  if (request.type === 'session_touch') {
    const record = requireRecord(ledger);
    const atMs = new Date(request.at).getTime();
    const absoluteMs = new Date(record.absolute_expires_at).getTime();
    if (!Number.isFinite(atMs) || !Number.isFinite(absoluteMs)) throw workerError('STORAGE_ERROR', 'invalid session expiry timestamp');
    record.last_seen_at = new Date(atMs).toISOString();
    record.idle_expires_at = new Date(Math.min(absoluteMs, atMs + request.max_idle_ms)).toISOString();
    save(ledger);
    output({ record });
    return;
  }
  if (request.type === 'session_reset_recovery') {
    const record = requireRecord(ledger);
    record.lifecycle = 'ACTIVE';
    record.held_keys = [];
    record.held_pointer_buttons = [];
    ledger.pendingBatchId = null;
    ledger.recoveryReason = null;
    save(ledger);
    output({ reset: true });
    return;
  }
  if (request.type === 'session_mark_recovery') {
    const record = requireRecord(ledger);
    record.lifecycle = 'RECOVERY_REQUIRED';
    ledger.recoveryReason = request.reason;
    save(ledger);
    output({ recoveryRequired: true });
    return;
  }
  if (request.type === 'session_next_observation') {
    const record = requireRecord(ledger);
    record.observation_seq += 1;
    save(ledger);
    output({ observationSeq: record.observation_seq });
    return;
  }
  if (request.type === 'session_end') {
    const record = requireRecord(ledger);
    record.lifecycle = 'ENDING';
    save(ledger);
    output({ ended: true });
    return;
  }

  throw workerError('INVALID_ARGUMENT', 'unsupported worker operation');
}

try { withLock(dispatch); }
catch (error) {
  const code = error?.workerCode || 'INTERNAL_ERROR';
  const detail = error instanceof Error ? error.message : 'worker failure';
  process.stdout.write(JSON.stringify({ ok: false, error: code, detail }));
  process.exitCode = 1;
}
