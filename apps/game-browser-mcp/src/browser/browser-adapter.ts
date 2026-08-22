import type { GameAction } from '../contracts.js';

export interface BrowserSessionRef {
  logicalSessionId: string;
  sandboxId: string;
}

export interface BrowserStartInput {
  logicalSessionId: string;
  targetUrl: string;
  allowedHosts: string[];
  viewport?: { width: number; height: number };
}

export interface BrowserStartResult {
  session: BrowserSessionRef;
  observation: BrowserObservation;
}

export interface BrowserHealth { alive: boolean; detail?: string }

export interface BrowserObservation {
  url: string;
  title?: string;
  screenshot?: { path?: string; base64?: string };
  accessibilitySnapshot?: string;
  consoleErrors?: unknown[];
  failedRequests?: unknown[];
  heldKeys: string[];
  heldPointerButtons: string[];
}

export interface AcceptedActionBatch {
  actionBatchId: string;
  actions: GameAction[];
}

export interface BrowserBatchResult {
  status: 'COMPLETE' | 'UNKNOWN';
  heldKeys: string[];
  heldPointerButtons: string[];
  summary?: Record<string, unknown>;
}

export interface BrowserAdapter {
  start(input: BrowserStartInput): Promise<BrowserStartResult>;
  health(session: BrowserSessionRef): Promise<BrowserHealth>;
  observe(session: BrowserSessionRef): Promise<BrowserObservation>;
  latestScreenshot(session: BrowserSessionRef): Promise<{ base64: string; mimeType: 'image/png' }>;
  input(session: BrowserSessionRef, batch: AcceptedActionBatch): Promise<BrowserBatchResult>;
  readState(session: BrowserSessionRef, path?: string): Promise<unknown>;
  reset(session: BrowserSessionRef): Promise<BrowserObservation>;
  releaseHeldInput(session: BrowserSessionRef): Promise<void>;
  end(session: BrowserSessionRef): Promise<void>;
}

