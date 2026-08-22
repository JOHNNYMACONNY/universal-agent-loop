import assert from 'node:assert/strict';
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
  VERCEL_PROJECT_PRODUCTION_URL: 'action.example.test',
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
  assert.match(descriptor.screenshot_url, /^https:\/\/action\.example\.test\/game-browser\/screenshot\?/);
  assert.match(descriptor.expires_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal('base64' in descriptor, false);
  assert.equal(JSON.stringify(observed.body).includes(screenshot.base64), false);
  assert.equal(JSON.stringify(observed.body).includes(screenshot.path), false);

  const screenshotUrl = new URL(descriptor.screenshot_url);
  const rendered = await handleGameBrowserControlRequest({
    method: 'GET',
    path: screenshotUrl.pathname,
    searchParams: Object.fromEntries(screenshotUrl.searchParams.entries()),
    headers: { host: screenshotUrl.host },
  }, { env, fetchImpl });

  assert.equal(rendered.status, 200);
  assert.equal(rendered.headers['content-type'], 'image/png');
  assert.equal(rendered.headers['cache-control'], 'private, no-store, max-age=0');
  assert.ok(Buffer.isBuffer(rendered.body));
  assert.deepEqual(rendered.body, pngBytes);
  assert.equal(calls.length, 2);
});

test('signed screenshot links fail closed when tampered', async () => {
  const fetchImpl = async (url) => {
    if (String(url).endsWith('/internal/gpt-action/observe')) {
      return jsonResponse({ session_id: 'session_123', observation: { session_id: 'session_123', screenshot } });
    }
    throw new Error('tampered link must not reach browser runtime');
  };

  const observed = await handleGameBrowserControlRequest({
    method: 'POST',
    path: '/game-browser/observe',
    body: { sessionId: 'session_123' },
    headers: { host: 'action.example.test' },
  }, { env, fetchImpl });
  const screenshotUrl = new URL(observed.body.observation.screenshot.screenshot_url);
  screenshotUrl.searchParams.set('sig', '0'.repeat(64));

  const response = await handleGameBrowserControlRequest({
    method: 'GET',
    path: screenshotUrl.pathname,
    searchParams: Object.fromEntries(screenshotUrl.searchParams.entries()),
    headers: { host: screenshotUrl.host },
  }, { env, fetchImpl });

  assert.equal(response.status, 403);
  assert.deepEqual(response.body, { error: 'INVALID_SCREENSHOT_LINK' });
});
