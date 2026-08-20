import test from 'node:test';
import assert from 'node:assert/strict';

import { decodeRemoteToolResult, runAcceptanceSequence, runRemoteAcceptanceFromEnv, type ToolCaller } from '../scripts/run-remote-acceptance.js';

const SHA = 'a'.repeat(40);

test('acceptance sequence exercises held movement, combined input, duplicate replay, reset, diagnostics, and end', async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  let actionSeq = 0;
  let inputCount = 0;
  let x = 100;
  let y = 200;
  const completed = new Map<string, unknown>();
  const caller: ToolCaller = async (name, args) => {
    calls.push({ name, args });
    if (name === 'game_session_start') return { session_id: 'session_1', deployment_provenance: { expected_commit_sha: SHA, deployed_commit_sha: SHA, deployment_id: 'dpl_1', deployment_url: 'https://example.test', target_registration_id: 'reg_1', repository: { owner: 'o', name: 'r' } }, observation: { content_trust: 'UNTRUSTED_TARGET_CONTENT', console_errors: ['EXPECTED_REMOTE_QA_DIAGNOSTIC'], failed_requests: [{ url: '/fixture/expected-failure', status: 404 }] } };
    if (name === 'game_observe') return { content_trust: 'UNTRUSTED_TARGET_CONTENT', console_errors: ['EXPECTED_REMOTE_QA_DIAGNOSTIC'], failed_requests: [{ url: '/fixture/expected-failure', status: 404 }] };
    if (name === 'game_read_state') return { content_trust: 'UNTRUSTED_TARGET_CONTENT', value: args.path === '/player' ? { x, y } : args.path === '/inputCount' ? inputCount : { x, y, inputCount } };
    if (name === 'game_input') {
      const id = String(args.action_batch_id);
      if (completed.has(id)) return { ...(completed.get(id) as object), duplicate: true };
      const actions = args.actions as Array<{ type: string; key?: string }>;
      for (const action of actions) {
        if (action.type === 'key_down' || action.type === 'key_up' || action.type === 'press' || action.type === 'click') inputCount += 1;
        if (action.type === 'wait') { x += 10; y -= 10; }
      }
      const value = { action_seq_before: actionSeq, action_seq_after: ++actionSeq, duplicate: false, execution_status: 'COMPLETE' };
      completed.set(id, value);
      return value;
    }
    if (name === 'game_reset') return { content_trust: 'UNTRUSTED_TARGET_CONTENT' };
    if (name === 'game_session_end') return { ended: true };
    throw new Error(`unexpected tool ${name}`);
  };

  const evidence = await runAcceptanceSequence(caller, { targetRegistrationId: 'reg_1', expectedCommitSha: SHA });
  assert.equal(evidence.duplicateSuppressed, true);
  assert.equal(evidence.consoleDiagnosticCaptured, true);
  assert.equal(evidence.failedRequestCaptured, true);
  assert.equal(evidence.ended, true);
  assert.ok(calls.filter((call) => call.name === 'game_observe').length >= 3);
  assert.ok(calls.some((call) => call.name === 'game_input' && JSON.stringify(call.args).includes('pointer_move_relative')));
});

test('remote tool decoder preserves plain-text MCP validation errors', () => {
  assert.throws(
    () => decodeRemoteToolResult('game_session_start', {
      isError: true,
      content: [{ type: 'text', text: 'Input validation error: target_registration_id is too long' }],
    }),
    /game_session_start: Input validation error: target_registration_id is too long/,
  );
});

test('remote tool decoder fails closed on non-JSON success payloads', () => {
  assert.throws(
    () => decodeRemoteToolResult('game_observe', {
      content: [{ type: 'text', text: 'not-json' }],
    }),
    /game_observe: expected JSON MCP evidence/,
  );
});

test('provider-backed remote acceptance runs only when environment is configured', { skip: !process.env.REMOTE_MCP_URL }, async () => {
  const evidence = await runRemoteAcceptanceFromEnv();
  assert.equal(evidence.ended, true);
  assert.equal(evidence.duplicateSuppressed, true);
});
