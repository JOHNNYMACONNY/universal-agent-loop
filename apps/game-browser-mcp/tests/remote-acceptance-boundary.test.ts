import test from 'node:test';
import assert from 'node:assert/strict';

import { runAcceptanceSequence, type ToolCaller } from '../scripts/run-remote-acceptance.js';

const SHA = 'b'.repeat(40);

function boundaryAwareCaller(): ToolCaller {
  let actionSeq = 0;
  let inputCount = 0;
  let x = 100;
  let y = 17;
  const held = new Set<string>();
  const completed = new Map<string, Record<string, unknown>>();

  return async (name, args) => {
    if (name === 'game_session_start') {
      return {
        session_id: 'session_boundary',
        deployment_provenance: {
          expected_commit_sha: SHA,
          deployed_commit_sha: SHA,
          deployment_id: 'dpl_boundary',
          deployment_url: 'https://example.test',
        },
        observation: {
          content_trust: 'UNTRUSTED_TARGET_CONTENT',
          console_errors: ['EXPECTED_REMOTE_QA_DIAGNOSTIC'],
          failed_requests: [{ url: '/fixture/expected-failure', status: 404 }],
        },
      };
    }
    if (name === 'game_observe') {
      return {
        content_trust: 'UNTRUSTED_TARGET_CONTENT',
        console_errors: ['EXPECTED_REMOTE_QA_DIAGNOSTIC'],
        failed_requests: [{ url: '/fixture/expected-failure', status: 404 }],
      };
    }
    if (name === 'game_read_state') {
      return {
        content_trust: 'UNTRUSTED_TARGET_CONTENT',
        value: args.path === '/player' ? { x, y } : args.path === '/inputCount' ? inputCount : null,
      };
    }
    if (name === 'game_input') {
      const id = String(args.action_batch_id);
      const prior = completed.get(id);
      if (prior) return { ...prior, duplicate: true };

      for (const action of args.actions as Array<{ type: string; key?: string }>) {
        if (action.type === 'key_down' && action.key) {
          held.add(action.key);
          inputCount += 1;
        } else if (action.type === 'key_up' && action.key) {
          held.delete(action.key);
          inputCount += 1;
        } else if (action.type === 'press' || action.type === 'click') {
          inputCount += 1;
        } else if (action.type === 'wait') {
          if (held.has('ArrowLeft')) x -= 10;
          if (held.has('ArrowRight')) x += 10;
          if (held.has('ArrowUp')) y -= 10;
          if (held.has('ArrowDown')) y += 10;
          x = Math.max(16, Math.min(784, x));
          y = Math.max(16, Math.min(434, y));
        }
      }

      const value = {
        action_seq_before: actionSeq,
        action_seq_after: ++actionSeq,
        duplicate: false,
        execution_status: 'COMPLETE',
      };
      completed.set(id, value);
      return value;
    }
    if (name === 'game_reset') return { content_trust: 'UNTRUSTED_TARGET_CONTENT' };
    if (name === 'game_session_end') return { ended: true };
    throw new Error(`unexpected tool ${name}`);
  };
}

test('diagonal acceptance remains valid when the first held move reaches the top boundary', async () => {
  const evidence = await runAcceptanceSequence(boundaryAwareCaller(), {
    targetRegistrationId: 'reg_boundary',
    expectedCommitSha: SHA,
  });

  assert.equal(evidence.heldMovementObserved, true);
  assert.equal(evidence.combinedMovementObserved, true);
  assert.equal(evidence.ended, true);
});
