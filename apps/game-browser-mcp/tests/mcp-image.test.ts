import { createServer } from 'node:http';
import test from 'node:test';
import assert from 'node:assert/strict';

import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createRuntimeApp } from '../src/server.js';

const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nJ8AAAAASUVORK5CYII=';

async function withClient(fn: (client: Client) => Promise<void>) {
  const services = {
    sessionStart: async () => ({}),
    observe: async () => ({
      session_id: 'session_1', content_trust: 'UNTRUSTED_TARGET_CONTENT',
      screenshot: { base64: PNG_1X1 }, url: 'https://game.example.com',
    }),
    input: async () => ({}), readState: async () => ({}), reset: async () => ({}), sessionEnd: async () => ({}),
  };
  const app = createRuntimeApp(services, { allowedHosts: ['127.0.0.1', 'localhost'] });
  const http = createServer(app);
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  const address = http.address();
  if (!address || typeof address === 'string') throw new Error('missing address');
  const client = new Client({ name: 'image-test', version: '1.0.0' });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`)));
    await fn(client);
  } finally {
    await client.close();
    await new Promise<void>((resolve, reject) => http.close((error) => error ? reject(error) : resolve()));
  }
}

test('game_observe returns screenshot as MCP image content, not inline base64 JSON', async () => {
  await withClient(async (client) => {
    const result = await client.callTool({ name: 'game_observe', arguments: { session_id: 'session_1' } });
    assert.notEqual(result.isError, true);
    const textPart = result.content?.find((part) => part.type === 'text');
    const imagePart = result.content?.find((part) => part.type === 'image');
    assert.ok(textPart?.type === 'text');
    assert.ok(imagePart?.type === 'image');
    assert.equal(imagePart.mimeType, 'image/png');
    assert.equal(imagePart.data, PNG_1X1);
    assert.doesNotMatch(textPart.text, new RegExp(PNG_1X1.slice(0, 24)));
    const structured = JSON.parse(textPart.text);
    assert.deepEqual(structured.screenshot, { content_ref: 'mcp:image:1', mime_type: 'image/png', content_trust: 'UNTRUSTED_TARGET_CONTENT' });
  });
});

test('oversized screenshot payload fails closed instead of expanding tool output', async () => {
  const services = {
    sessionStart: async () => ({}),
    observe: async () => ({ session_id: 'session_1', screenshot: { base64: Buffer.alloc(2_100_000).toString('base64') } }),
    input: async () => ({}), readState: async () => ({}), reset: async () => ({}), sessionEnd: async () => ({}),
  };
  const app = createRuntimeApp(services, { allowedHosts: ['127.0.0.1', 'localhost'] });
  const http = createServer(app);
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  const address = http.address();
  if (!address || typeof address === 'string') throw new Error('missing address');
  const client = new Client({ name: 'image-limit-test', version: '1.0.0' });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`)));
    const result = await client.callTool({ name: 'game_observe', arguments: { session_id: 'session_1' } });
    assert.equal(result.isError, true);
    const text = result.content?.[0]?.type === 'text' ? result.content[0].text : '';
    assert.match(text, /LIMIT_EXCEEDED|screenshot/i);
  } finally {
    await client.close();
    await new Promise<void>((resolve, reject) => http.close((error) => error ? reject(error) : resolve()));
  }
});
