import { createServer } from 'node:http';
import test from 'node:test';
import assert from 'node:assert/strict';

import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createRuntimeApp } from '../src/server.js';

const services = {
  sessionStart: async (args: unknown) => ({ kind: 'start', args }),
  observe: async (args: unknown) => ({ kind: 'observe', args }),
  input: async (args: unknown) => ({ kind: 'input', args }),
  readState: async (args: unknown) => ({ kind: 'read', args }),
  reset: async (args: unknown) => ({ kind: 'reset', args }),
  sessionEnd: async (args: unknown) => ({ kind: 'end', args }),
};

async function withClient(fn: (client: Client) => Promise<void>) {
  const app = createRuntimeApp(services as any, { allowedHosts: ['127.0.0.1', 'localhost'] });
  const http = createServer(app);
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  const address = http.address();
  if (!address || typeof address === 'string') throw new Error('missing test address');
  const client = new Client({ name: 'runtime-test', version: '1.0.0' });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`)));
    await fn(client);
  } finally {
    await client.close();
    await new Promise<void>((resolve, reject) => http.close((error) => error ? reject(error) : resolve()));
  }
}

test('MCP exposes exactly the six bounded gameplay tools', async () => {
  await withClient(async (client) => {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((tool) => tool.name).sort(), [
      'game_input', 'game_observe', 'game_read_state', 'game_reset', 'game_session_end', 'game_session_start',
    ]);
    for (const tool of tools) {
      const schema = JSON.stringify(tool.inputSchema);
      assert.doesNotMatch(schema, /shell|command|javascript|source|playwright|cdp/i);
      assert.match(tool.description ?? '', /untrusted|authority|repository|deployment/i);
    }
  });
});

test('MCP routes valid calls to tool services and returns JSON evidence', async () => {
  await withClient(async (client) => {
    const result = await client.callTool({ name: 'game_observe', arguments: { session_id: 'session_1' } });
    assert.equal(result.isError, undefined);
    const text = result.content?.[0]?.type === 'text' ? result.content[0].text : '';
    assert.deepEqual(JSON.parse(text), { kind: 'observe', args: { session_id: 'session_1' } });
  });
});

test('MCP accepts bounded signed registration capabilities larger than opaque session IDs', async () => {
  await withClient(async (client) => {
    const capability = `rgc1.${'a'.repeat(1500)}.${'b'.repeat(43)}`;
    const result = await client.callTool({
      name: 'game_session_start',
      arguments: {
        target_registration_id: capability,
        expected_commit_sha: 'a'.repeat(40),
        viewport: { width: 1280, height: 720 },
      },
    });
    assert.equal(result.isError, undefined);
    const text = result.content?.[0]?.type === 'text' ? result.content[0].text : '';
    assert.deepEqual(JSON.parse(text), {
      kind: 'start',
      args: {
        target_registration_id: capability,
        expected_commit_sha: 'a'.repeat(40),
        viewport: { width: 1280, height: 720 },
      },
    });
  });
});

test('MCP rejects excessively large registration capability input', async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: 'game_session_start',
      arguments: {
        target_registration_id: `rgc1.${'a'.repeat(5000)}.${'b'.repeat(43)}`,
        expected_commit_sha: 'a'.repeat(40),
      },
    });
    assert.equal(result.isError, true);
  });
});

test('MCP rejects generic URL/shell/JS escape fields at schema boundary', async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: 'game_observe',
      arguments: { session_id: 'session_1', url: 'https://evil.example', shell: 'id', javascript: 'alert(1)' },
    });
    assert.equal(result.isError, true);
  });
});
