import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  runAcceptanceSequence,
  runAcceptanceWithEvidence,
  type ToolCaller,
} from '../scripts/run-remote-acceptance.js';

const SHA = 'c'.repeat(40);

function failingCaller(onEnd: () => void): ToolCaller {
  let actionSeq = 0;
  return async (name, args) => {
    if (name === 'game_session_start') {
      return {
        session_id: 'session_failure',
        deployment_provenance: {
          expected_commit_sha: SHA,
          deployed_commit_sha: SHA,
          deployment_id: 'dpl_failure',
          deployment_url: 'https://example.test',
        },
        observation: {
          content_trust: 'UNTRUSTED_TARGET_CONTENT',
          console_errors: ['EXPECTED_REMOTE_QA_DIAGNOSTIC'],
          failed_requests: [{ url: '/fixture/expected-failure', status: 404 }],
        },
      };
    }
    if (name === 'game_observe') return { content_trust: 'UNTRUSTED_TARGET_CONTENT' };
    if (name === 'game_read_state') {
      return { content_trust: 'UNTRUSTED_TARGET_CONTENT', value: args.path === '/player' ? { x: 100, y: 200 } : 0 };
    }
    if (name === 'game_input') {
      const before = Number(args.expected_action_seq);
      actionSeq = before + 1;
      return {
        action_seq_before: before,
        action_seq_after: actionSeq,
        duplicate: false,
        execution_status: 'COMPLETE',
      };
    }
    if (name === 'game_session_end') {
      onEnd();
      return { ended: true };
    }
    throw new Error(`unexpected tool ${name}`);
  };
}

test('acceptance failure after session start still ends the remote session', async () => {
  let endCalls = 0;
  await assert.rejects(
    runAcceptanceSequence(failingCaller(() => { endCalls += 1; }), {
      targetRegistrationId: 'reg_failure',
      expectedCommitSha: SHA,
    }),
    /held key did not produce movement across calls/,
  );
  assert.equal(endCalls, 1);
});

test('acceptance failure writes bounded sanitized evidence before rethrowing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gbr-failure-evidence-'));
  const path = join(dir, 'evidence.json');
  let endCalls = 0;

  await assert.rejects(
    runAcceptanceWithEvidence(
      failingCaller(() => { endCalls += 1; }),
      { targetRegistrationId: 'rgc1.secret.payload', expectedCommitSha: SHA },
      path,
    ),
    /held key did not produce movement across calls/,
  );

  const evidence = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(evidence.ok, false);
  assert.equal(evidence.expectedCommitSha, SHA);
  assert.match(evidence.error, /held key did not produce movement across calls/);
  assert.equal(JSON.stringify(evidence).includes('rgc1.secret.payload'), false);
  assert.equal(endCalls, 1);
});
