import test from 'node:test';
import assert from 'node:assert/strict';

import app from '../src/server.js';

test('runtime package exports an Express application', () => {
  assert.equal(typeof app, 'function');
});
