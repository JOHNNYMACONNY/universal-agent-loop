#!/usr/bin/env node
import { main } from '../src/cli.js';

main().then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`agent-loop: ${err.message}\n`);
    process.exit(2);
  },
);
