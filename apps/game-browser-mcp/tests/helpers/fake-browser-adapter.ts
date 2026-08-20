import { randomUUID } from 'node:crypto';
import type { GameAction } from '../../src/contracts.js';
import type {
  AcceptedActionBatch,
  BrowserAdapter,
  BrowserBatchResult,
  BrowserHealth,
  BrowserObservation,
  BrowserSessionRef,
  BrowserStartInput,
  BrowserStartResult,
} from '../../src/browser/browser-adapter.js';

export type { AcceptedActionBatch } from '../../src/browser/browser-adapter.js';

interface Options {
  ambiguousBatchIds?: string[];
  state?: unknown;
}

interface FakeSession {
  alive: boolean;
  url: string;
  heldKeys: Set<string>;
  heldPointerButtons: Set<string>;
}

function pointer(value: unknown, path?: string): unknown {
  if (!path || path === '') return structuredClone(value);
  let current: unknown = value;
  for (const encoded of path.split('/').slice(1)) {
    const key = encoded.replace(/~1/g, '/').replace(/~0/g, '~');
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return structuredClone(current);
}

export class FakeBrowserAdapter implements BrowserAdapter {
  readonly #sessions = new Map<string, FakeSession>();
  readonly #ambiguous = new Set<string>();
  readonly #state: unknown;
  startCalls = 0;
  inputCalls = 0;
  releaseCalls = 0;
  endCalls = 0;

  constructor(options: Options = {}) {
    for (const id of options.ambiguousBatchIds ?? []) this.#ambiguous.add(id);
    this.#state = options.state ?? {};
  }

  #entry(ref: BrowserSessionRef): FakeSession {
    const entry = this.#sessions.get(ref.sandboxId);
    if (!entry || !entry.alive) throw new Error('browser session unavailable');
    return entry;
  }

  #observation(entry: FakeSession): BrowserObservation {
    return {
      url: entry.url,
      title: 'Fake Game',
      screenshot: { base64: 'ZmFrZQ==' },
      accessibilitySnapshot: 'canvas game',
      consoleErrors: [],
      failedRequests: [],
      heldKeys: [...entry.heldKeys],
      heldPointerButtons: [...entry.heldPointerButtons],
    };
  }

  async start(input: BrowserStartInput): Promise<BrowserStartResult> {
    this.startCalls += 1;
    const sandboxId = `fake_${randomUUID()}`;
    const entry: FakeSession = { alive: true, url: input.targetUrl, heldKeys: new Set(), heldPointerButtons: new Set() };
    this.#sessions.set(sandboxId, entry);
    const session = { logicalSessionId: input.logicalSessionId, sandboxId };
    return { session, observation: this.#observation(entry) };
  }

  async health(session: BrowserSessionRef): Promise<BrowserHealth> {
    return { alive: this.#sessions.get(session.sandboxId)?.alive === true };
  }

  async observe(session: BrowserSessionRef): Promise<BrowserObservation> { return this.#observation(this.#entry(session)); }

  async input(session: BrowserSessionRef, batch: AcceptedActionBatch): Promise<BrowserBatchResult> {
    this.inputCalls += 1;
    const entry = this.#entry(session);
    for (const action of batch.actions) this.#apply(entry, action);
    return {
      status: this.#ambiguous.has(batch.actionBatchId) ? 'UNKNOWN' : 'COMPLETE',
      heldKeys: [...entry.heldKeys],
      heldPointerButtons: [...entry.heldPointerButtons],
    };
  }

  #apply(entry: FakeSession, action: GameAction): void {
    if (action.type === 'key_down') entry.heldKeys.add(action.key);
    if (action.type === 'key_up') entry.heldKeys.delete(action.key);
    if (action.type === 'pointer_down') entry.heldPointerButtons.add(action.button ?? 'left');
    if (action.type === 'pointer_up') entry.heldPointerButtons.delete(action.button ?? 'left');
  }

  async readState(session: BrowserSessionRef, path?: string): Promise<unknown> { this.#entry(session); return pointer(this.#state, path); }
  async reset(session: BrowserSessionRef): Promise<BrowserObservation> { const entry = this.#entry(session); entry.heldKeys.clear(); entry.heldPointerButtons.clear(); return this.#observation(entry); }
  async releaseHeldInput(session: BrowserSessionRef): Promise<void> { this.releaseCalls += 1; const entry = this.#entry(session); entry.heldKeys.clear(); entry.heldPointerButtons.clear(); }
  async end(session: BrowserSessionRef): Promise<void> { this.endCalls += 1; const entry = this.#sessions.get(session.sandboxId); if (entry) entry.alive = false; }
  loseSession(session: BrowserSessionRef): void { const entry = this.#sessions.get(session.sandboxId); if (entry) entry.alive = false; }
}
