import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import { Client, StreamableHTTPClientTransport, type AuthProvider } from '@modelcontextprotocol/client';

export type ToolCaller = (name: string, args: Record<string, unknown>) => Promise<any>;

export interface AcceptanceConfig {
  targetRegistrationId: string;
  expectedCommitSha: string;
}

export interface AcceptanceEvidence {
  sessionId: string;
  expectedCommitSha: string;
  deployedCommitSha: string;
  deploymentId: string;
  deploymentUrl: string;
  duplicateSuppressed: boolean;
  heldMovementObserved: boolean;
  combinedMovementObserved: boolean;
  consoleDiagnosticCaptured: boolean;
  failedRequestCaptured: boolean;
  trustBoundaryObserved: boolean;
  ended: boolean;
  finalActionSeq: number;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`remote acceptance failed: ${message}`);
}

function hasDiagnostic(value: any): boolean {
  return JSON.stringify(value?.console_errors ?? value?.consoleErrors ?? []).includes('EXPECTED_REMOTE_QA_DIAGNOSTIC');
}

function hasFailedRequest(value: any): boolean {
  return JSON.stringify(value?.failed_requests ?? value?.failedRequests ?? []).includes('expected-failure');
}

function point(value: any): { x: number; y: number } {
  const candidate = value?.value ?? value;
  assert(candidate && Number.isFinite(candidate.x) && Number.isFinite(candidate.y), 'player state must contain finite x/y');
  return { x: Number(candidate.x), y: Number(candidate.y) };
}

function safeDiagnostic(text: string): string {
  return text
    .replace(/rgc1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[registration-capability-redacted]')
    .slice(0, 2048);
}

export function decodeRemoteToolResult(name: string, result: any): any {
  const textPart = result?.content?.find((part: any) => part?.type === 'text');
  const text = textPart?.type === 'text' && typeof textPart.text === 'string' ? textPart.text : '';

  if (result?.isError) {
    if (!text) throw new Error(`${name}: MCP tool returned an error without diagnostic text`);
    try {
      throw new Error(`${name}: ${JSON.stringify(JSON.parse(text))}`);
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error(`${name}: ${safeDiagnostic(text)}`);
      throw error;
    }
  }

  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${name}: expected JSON MCP evidence`);
  }
}

export async function runAcceptanceSequence(call: ToolCaller, config: AcceptanceConfig): Promise<AcceptanceEvidence> {
  const started = await call('game_session_start', {
    target_registration_id: config.targetRegistrationId,
    expected_commit_sha: config.expectedCommitSha,
    viewport: { width: 1280, height: 720 },
  });
  const sessionId = String(started.session_id ?? '');
  assert(sessionId, 'session start must return session_id');
  assert(started.deployment_provenance?.expected_commit_sha === config.expectedCommitSha, 'expected SHA missing from provenance');
  assert(started.deployment_provenance?.deployed_commit_sha === config.expectedCommitSha, 'deployed SHA does not match expected SHA');
  assert(started.observation?.content_trust === 'UNTRUSTED_TARGET_CONTENT', 'initial target observation must be untrusted');

  let actionSeq = 0;
  let consoleDiagnosticCaptured = hasDiagnostic(started.observation);
  let failedRequestCaptured = hasFailedRequest(started.observation);
  let trustBoundaryObserved = started.observation?.content_trust === 'UNTRUSTED_TARGET_CONTENT';

  const observe = async () => {
    const value = await call('game_observe', { session_id: sessionId });
    consoleDiagnosticCaptured ||= hasDiagnostic(value);
    failedRequestCaptured ||= hasFailedRequest(value);
    trustBoundaryObserved ||= value?.content_trust === 'UNTRUSTED_TARGET_CONTENT';
    return value;
  };

  const input = async (id: string, actions: unknown[]) => {
    const before = actionSeq;
    const value = await call('game_input', { session_id: sessionId, action_batch_id: id, expected_action_seq: before, actions });
    assert(value.execution_status === 'COMPLETE', `${id} did not complete`);
    assert(value.action_seq_before === before, `${id} action sequence did not start at expected value`);
    actionSeq = Number(value.action_seq_after);
    assert(actionSeq === before + 1, `${id} action sequence did not advance exactly once`);
    return { value, request: { session_id: sessionId, action_batch_id: id, expected_action_seq: before, actions } };
  };

  const initialPlayer = point(await call('game_read_state', { session_id: sessionId, path: '/player' }));
  await input('focus_click', [{ type: 'click', x: 400, y: 225 }]);
  await input('up_down', [{ type: 'key_down', key: 'ArrowUp' }]);
  await observe();
  await input('held_wait', [{ type: 'wait', duration_ms: 300 }]);
  const heldPlayer = point(await call('game_read_state', { session_id: sessionId, path: '/player' }));
  const heldMovementObserved = heldPlayer.x !== initialPlayer.x || heldPlayer.y !== initialPlayer.y;
  assert(heldMovementObserved, 'held key did not produce movement across calls');

  await input('right_down', [{ type: 'key_down', key: 'ArrowRight' }]);
  await input('combined_wait', [{ type: 'wait', duration_ms: 300 }]);
  const combinedPlayer = point(await call('game_read_state', { session_id: sessionId, path: '/player' }));
  const combinedMovementObserved = combinedPlayer.x !== heldPlayer.x && combinedPlayer.y !== heldPlayer.y;
  assert(combinedMovementObserved, 'simultaneous movement did not change both axes');
  await input('right_up', [{ type: 'key_up', key: 'ArrowRight' }]);
  await input('up_up', [{ type: 'key_up', key: 'ArrowUp' }]);
  await input('relative_pointer', [{ type: 'pointer_move_relative', delta_x: 30, delta_y: -15 }]);
  await observe();

  const beforeCount = Number((await call('game_read_state', { session_id: sessionId, path: '/inputCount' }))?.value ?? 0);
  const duplicateProbe = await input('duplicate_probe', [{ type: 'press', key: 'Enter' }]);
  const afterFirst = Number((await call('game_read_state', { session_id: sessionId, path: '/inputCount' }))?.value ?? 0);
  assert(afterFirst > beforeCount, 'first duplicate probe did not reach the game');
  const duplicate = await call('game_input', duplicateProbe.request);
  assert(duplicate.duplicate === true, 'repeated action_batch_id was not identified as duplicate');
  assert(Number(duplicate.action_seq_after) === actionSeq, 'duplicate advanced action sequence');
  const afterSecond = Number((await call('game_read_state', { session_id: sessionId, path: '/inputCount' }))?.value ?? 0);
  const duplicateSuppressed = afterSecond === afterFirst;
  assert(duplicateSuppressed, 'duplicate batch replayed gameplay input');

  const reset = await call('game_reset', { session_id: sessionId, mode: 'target' });
  trustBoundaryObserved ||= reset?.content_trust === 'UNTRUSTED_TARGET_CONTENT';
  await observe();
  const endedResult = await call('game_session_end', { session_id: sessionId });
  const ended = endedResult?.ended === true;
  assert(ended, 'session end was not acknowledged');
  assert(consoleDiagnosticCaptured, 'expected console diagnostic was not captured');
  assert(failedRequestCaptured, 'expected failed request was not captured');
  assert(trustBoundaryObserved, 'untrusted-content marker was not observed');

  return {
    sessionId,
    expectedCommitSha: config.expectedCommitSha,
    deployedCommitSha: String(started.deployment_provenance.deployed_commit_sha),
    deploymentId: String(started.deployment_provenance.deployment_id),
    deploymentUrl: String(started.deployment_provenance.deployment_url),
    duplicateSuppressed,
    heldMovementObserved,
    combinedMovementObserved,
    consoleDiagnosticCaptured,
    failedRequestCaptured,
    trustBoundaryObserved,
    ended,
    finalActionSeq: actionSeq,
  };
}

export function createRemoteToolCaller(url: string, bearerToken?: string): ToolCaller {
  return async (name, args) => {
    const client = new Client({ name: 'ual-remote-acceptance', version: '0.1.0' });
    const authProvider: AuthProvider | undefined = bearerToken ? { token: async () => bearerToken } : undefined;
    const transport = new StreamableHTTPClientTransport(new URL(url), authProvider ? { authProvider } : undefined);
    try {
      await client.connect(transport);
      const result = await client.callTool({ name, arguments: args });
      return decodeRemoteToolResult(name, result);
    } finally {
      await client.close();
    }
  };
}

export async function runRemoteAcceptanceFromEnv(): Promise<AcceptanceEvidence> {
  const url = process.env.REMOTE_MCP_URL;
  const targetRegistrationId = process.env.TARGET_REGISTRATION_ID;
  const expectedCommitSha = process.env.EXPECTED_COMMIT_SHA;
  if (!url || !targetRegistrationId || !expectedCommitSha) throw new Error('REMOTE_MCP_URL, TARGET_REGISTRATION_ID, and EXPECTED_COMMIT_SHA are required');
  const evidence = await runAcceptanceSequence(createRemoteToolCaller(url, process.env.REMOTE_MCP_BEARER_TOKEN), { targetRegistrationId, expectedCommitSha });
  await writeFile(process.env.REMOTE_EVIDENCE_PATH ?? 'remote-acceptance-evidence.json', `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  return evidence;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const evidence = await runRemoteAcceptanceFromEnv();
  process.stdout.write(`${JSON.stringify({ ok: true, deploymentId: evidence.deploymentId, commit: evidence.expectedCommitSha })}\n`);
}
