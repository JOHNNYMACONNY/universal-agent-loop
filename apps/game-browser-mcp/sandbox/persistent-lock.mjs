import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';

const OWNER_FILE = 'owner.json';
const ORPHAN_GRACE_MS = 1_000;

function readBootId() {
  try { return readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim(); }
  catch { return 'unknown-boot'; }
}

function readProcessStart(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const closing = stat.lastIndexOf(')');
    if (closing < 0) return null;
    const fields = stat.slice(closing + 1).trim().split(/\s+/);
    return fields[19] ?? null; // field 22 (starttime), with field 3 at index 0
  } catch {
    return null;
  }
}

const BOOT_ID = readBootId();

function readOwner(lockPath) {
  try { return JSON.parse(readFileSync(`${lockPath}/${OWNER_FILE}`, 'utf8')); }
  catch { return null; }
}

function lockAgeMs(lockPath) {
  try { return Math.max(0, Date.now() - statSync(lockPath).mtimeMs); }
  catch { return Number.POSITIVE_INFINITY; }
}

function ownerIsAlive(owner) {
  if (!owner || owner.bootId !== BOOT_ID || !Number.isInteger(owner.pid) || typeof owner.processStart !== 'string') return false;
  return readProcessStart(owner.pid) === owner.processStart;
}

function mayReclaim(lockPath) {
  const owner = readOwner(lockPath);
  if (owner) return !ownerIsAlive(owner);
  // Another worker may have just created the directory and not written ownership yet.
  return lockAgeMs(lockPath) >= ORPHAN_GRACE_MS;
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function withPersistentLock(lockPath, fn, options = {}) {
  const waitMs = options.waitMs ?? 180_000;
  const pollMs = options.pollMs ?? 10;
  const deadline = Date.now() + waitMs;
  const token = randomUUID();
  const owner = {
    token,
    pid: process.pid,
    bootId: BOOT_ID,
    processStart: readProcessStart(process.pid) ?? `pid-${process.pid}`,
    acquiredAt: new Date().toISOString(),
  };

  while (true) {
    try {
      mkdirSync(lockPath);
      writeFileSync(`${lockPath}/${OWNER_FILE}`, JSON.stringify(owner), { mode: 0o600 });
      break;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      if (mayReclaim(lockPath)) {
        rmSync(lockPath, { recursive: true, force: true });
        continue;
      }
      if (Date.now() >= deadline) {
        const lockError = new Error('sandbox ledger lock timed out');
        lockError.workerCode = 'SESSION_RECOVERY_REQUIRED';
        throw lockError;
      }
      sleep(pollMs);
    }
  }

  try {
    return fn();
  } finally {
    const current = readOwner(lockPath);
    // Only the owner that acquired this lock may remove it.
    if (current?.token === token) rmSync(lockPath, { recursive: true, force: true });
  }
}
