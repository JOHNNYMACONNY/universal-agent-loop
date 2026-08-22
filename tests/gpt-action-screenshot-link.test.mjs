import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

import { handleGameBrowserControlRequest } from '../apps/gpt-action-api/src/game-browser-control.mjs';

const pngBytes = Buffer.from('cached-png-frame');
const screenshot = {
  base64: pngBytes.toString('base64'),
  path: '/vercel/sandbox/.game-browser/session_123-latest.png',
};

const env = {
  GAME_BROWSER_RUNTIME_BASE_URL: 'https://browser.example.test',
  GAME_BROWSER_BRIDGE_TOKEN: 'bridge-secret-value',
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('Action projection exposes a short-lived signed HTTPS link for the already-captured screenshot without leaking bytes or runtime paths', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith('/internal/gpt-action/observe')) {
      return jsonResponse({
        session_id: 'session_123',
        observation_seq: 7,
        observation: {
          session_id: 'session_123',
          observation_seq: 7,
          screenshot,
        },
      });
    }
    if (String(url).endsWith('/internal/gpt-action/screenshot')) {
      assert.equal(options.headers.authorization, 'Bearer bridge-secret-value');
      assert.deepEqual(JSON.parse(options.body), { session_id: 'session_123' });
      return jsonResponse({
        session_id: 'session_123',
        screenshot: { base64: screenshot.base64, mime_type: 'image/png' },
      });
    }
    throw new Error(`unexpected upstream ${url}`);
  };

  const observed = await handleGameBrowserControlRequest({
    method: 'POST',
    path: '/game-browser/observe',
    body: { sessionId: 'session_123', expectedObservationSeq: 6 },
    headers: { host: 'preview.example.test' },
  }, { env, fetchImpl });

  assert.equal(observed.status, 200);
  const descriptor = observed.body.observation.screenshot;
  assert.equal(descriptor.available, true);
  assert.equal(descriptor.transported, true);
  assert.equal(descriptor.mime_type, 'image/png');
  assert.equal(descriptor.bytes, pngBytes.byteLength);
  assert.match(descriptor.screenshot_url, /^https:\/\/browser\.example\.test\/internal\/gpt-action\/screenshot\?/);
  assert.match(descriptor.expires_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal('base64' in descriptor, false);
  assert.equal(JSON.stringify(observed.body).includes(screenshot.base64), false);
  assert.equal(JSON.stringify(observed.body).includes(screenshot.path), false);

  const screenshotUrl = new URL(descriptor.screenshot_url);
  assert.equal(screenshotUrl.searchParams.get('session_id'), 'session_123');
  const expires = Number(screenshotUrl.searchParams.get('expires'));
  assert.equal(Number.isSafeInteger(expires), true);
  assert.ok(expires > Date.now());
  assert.ok(expires <= Date.now() + 5 * 60_000);
  const expectedSignature = createHmac('sha256', 'bridge-secret-value')
    .update(`ual:game-browser-screenshot-link:v1\nsession_123\n${expires}`, 'utf8')
    .digest('hex');
  assert.equal(screenshotUrl.searchParams.get('sig'), expectedSignature);
  assert.equal(calls.length, 1);
});

test('Action projection fails closed instead of issuing a capability for oversized screenshots', async () => {
  const oversized = { base64: Buffer.alloc(2_000_001, 1).toString('base64'), path: '/tmp/oversized.png' };
  const response = await handleGameBrowserControlRequest({
    method: 'POST',
    path: '/game-browser/observe',
    body: { sessionId: 'session_123' },
  }, {
    env,
    fetchImpl: async () => jsonResponse({
      session_id: 'session_123',
      observation: { session_id: 'session_123', screenshot: oversized },
    }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.observation.screenshot, {
    available: true,
    transported: false,
    reason: 'SCREENSHOT_TOO_LARGE',
    bytes: 2_000_001,
  });
  assert.equal(JSON.stringify(response.body).includes(oversized.base64), false);
  assert.equal(JSON.stringify(response.body).includes(oversized.path), false);
});

