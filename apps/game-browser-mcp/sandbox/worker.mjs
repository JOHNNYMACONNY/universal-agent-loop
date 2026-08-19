import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname } from 'node:path';

const encoded = process.argv[2];
if (!encoded) fail('missing request');
let request;
try { request = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')); } catch { fail('invalid request encoding'); }
const session = typeof request.session_id === 'string' ? request.session_id : '';
if (!session || !/^[A-Za-z0-9_.-]{1,128}$/.test(session)) fail('invalid session');
const root = '/vercel/sandbox/.game-browser';
const ledgerPath = `${root}/${session}.json`;
mkdirSync(root, { recursive: true });

function fail(message) { process.stdout.write(JSON.stringify({ ok: false, error: message })); process.exit(1); }
function output(data) { process.stdout.write(JSON.stringify({ ok: true, ...data })); }
function load() { return existsSync(ledgerPath) ? JSON.parse(readFileSync(ledgerPath, 'utf8')) : null; }
function save(value) { writeFileSync(ledgerPath, JSON.stringify(value), { mode: 0o600 }); }
function ab(args, { allowFailure = false } = {}) {
  const proc = spawnSync('agent-browser', ['--session', session, '--json', ...args.map(String)], { encoding: 'utf8', shell: false, timeout: 30_000 });
  let parsed = null;
  try { parsed = proc.stdout ? JSON.parse(proc.stdout) : null; } catch { parsed = proc.stdout; }
  if (!allowFailure && (proc.status !== 0 || parsed?.success === false)) throw new Error(String(parsed?.error ?? proc.stderr ?? `agent-browser ${args[0]} failed`));
  return parsed?.data ?? parsed;
}
function held(ledger) { return { heldKeys: [...ledger.heldKeys], heldPointerButtons: [...ledger.heldPointerButtons] }; }
function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
function release(ledger) {
  for (const key of [...ledger.heldKeys]) { try { ab(['keyup', key]); } catch {} }
  for (const button of [...ledger.heldPointerButtons]) { try { ab(['mouse', 'up', button]); } catch {} }
  ledger.heldKeys = []; ledger.heldPointerButtons = []; save(ledger);
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
  return { url, title, accessibilitySnapshot, consoleErrors: [...(Array.isArray(consoleErrors) ? consoleErrors : [consoleErrors]), ...(Array.isArray(pageErrors) ? pageErrors : [pageErrors])], failedRequests: Array.isArray(requests) ? requests.filter((item) => item?.failed || item?.status >= 400) : [], ...(screenshot ? { screenshot } : {}), capturedAt: new Date().toISOString(), ...held(ledger) };
}
function act(ledger, action) {
  switch (action.type) {
    case 'key_down': ab(['keydown', action.key]); if (!ledger.heldKeys.includes(action.key)) ledger.heldKeys.push(action.key); break;
    case 'key_up': ab(['keyup', action.key]); ledger.heldKeys = ledger.heldKeys.filter((k) => k !== action.key); break;
    case 'press':
      if (action.duration_ms) { ab(['keydown', action.key]); if (!ledger.heldKeys.includes(action.key)) ledger.heldKeys.push(action.key); ab(['wait', String(action.duration_ms)]); ab(['keyup', action.key]); ledger.heldKeys = ledger.heldKeys.filter((k) => k !== action.key); }
      else ab(['press', action.key]);
      break;
    case 'pointer_move': ledger.pointerX = action.x; ledger.pointerY = action.y; ab(['mouse', 'move', action.x, action.y]); break;
    case 'pointer_move_relative': ledger.pointerX = clamp(ledger.pointerX + action.delta_x, 0, ledger.viewport.width - 1); ledger.pointerY = clamp(ledger.pointerY + action.delta_y, 0, ledger.viewport.height - 1); ab(['mouse', 'move', ledger.pointerX, ledger.pointerY]); break;
    case 'pointer_down': { const b = action.button ?? 'left'; ab(['mouse', 'down', b]); if (!ledger.heldPointerButtons.includes(b)) ledger.heldPointerButtons.push(b); break; }
    case 'pointer_up': { const b = action.button ?? 'left'; ab(['mouse', 'up', b]); ledger.heldPointerButtons = ledger.heldPointerButtons.filter((v) => v !== b); break; }
    case 'click': { const b = action.button ?? 'left'; ab(['mouse', 'move', action.x, action.y]); ledger.pointerX = action.x; ledger.pointerY = action.y; ab(['mouse', 'down', b]); ab(['mouse', 'up', b]); break; }
    case 'scroll': ab(['mouse', 'wheel', action.delta_y, action.delta_x ?? 0]); break;
    case 'wait': ab(['wait', String(action.duration_ms)]); break;
    default: throw new Error('unsupported action');
  }
  save(ledger);
}

try {
  if (request.type === 'start') {
    if (typeof request.target_url !== 'string' || !request.target_url.startsWith('https://')) fail('invalid target');
    const viewport = request.viewport ?? { width: 1280, height: 720 };
    const ledger = { session, targetUrl: request.target_url, viewport, pointerX: Math.floor(viewport.width / 2), pointerY: Math.floor(viewport.height / 2), heldKeys: [], heldPointerButtons: [], batches: {}, recoveryRequired: false };
    if (request.viewport) ab(['set', 'viewport', viewport.width, viewport.height]);
    ab(['open', request.target_url]); save(ledger); output({ observation: observe(ledger) });
  } else {
    const ledger = load(); if (!ledger) fail('session ledger missing');
    if (request.type === 'health') { output({ alive: !ledger.ended && !ledger.recoveryRequired }); }
    else if (request.type === 'observe') { output({ observation: observe(ledger) }); }
    else if (request.type === 'input') {
      const id = request.action_batch_id;
      const prior = ledger.batches[id];
      if (prior?.state === 'COMPLETE') output({ status: 'COMPLETE', duplicate: true, ...held(ledger), summary: prior.summary ?? {} });
      else if (prior?.state === 'ACCEPTED' || ledger.recoveryRequired) output({ status: 'UNKNOWN', duplicate: true, ...held(ledger) });
      else {
        ledger.batches[id] = { state: 'ACCEPTED' }; save(ledger);
        try {
          for (const action of request.actions ?? []) act(ledger, action);
          const summary = { actionCount: request.actions.length };
          ledger.batches[id] = { state: 'COMPLETE', summary }; save(ledger); output({ status: 'COMPLETE', duplicate: false, summary, ...held(ledger) });
        } catch (error) {
          ledger.recoveryRequired = true; release(ledger); save(ledger); output({ status: 'UNKNOWN', duplicate: false, summary: { error: error instanceof Error ? error.message : 'input failure' }, ...held(ledger) });
        }
      }
    } else if (request.type === 'read_state') {
      const path = request.path ?? '';
      const source = `(() => { const p=${JSON.stringify(path)}; let v=window.__GAME_TEST__; if (p) for (const raw of p.split('/').slice(1)) { const k=raw.replace(/~1/g,'/').replace(/~0/g,'~'); if (v==null || typeof v!=='object') return null; v=v[k]; } return JSON.parse(JSON.stringify(v ?? null)); })()`;
      const value = ab(['eval', '-b', Buffer.from(source).toString('base64')], { allowFailure: true }); output({ value });
    } else if (request.type === 'reset') { release(ledger); ledger.recoveryRequired = false; ledger.batches = {}; ab(['open', ledger.targetUrl]); save(ledger); output({ observation: observe(ledger) }); }
    else if (request.type === 'release') { release(ledger); output(held(ledger)); }
    else if (request.type === 'end') { release(ledger); ab(['close'], { allowFailure: true }); ledger.ended = true; save(ledger); output({ ended: true }); }
    else fail('unsupported worker operation');
  }
} catch (error) { fail(error instanceof Error ? error.message : 'worker failure'); }
