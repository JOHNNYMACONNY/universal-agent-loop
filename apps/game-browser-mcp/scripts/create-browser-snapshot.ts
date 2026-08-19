import { readFile } from 'node:fs/promises';
import { Sandbox } from '@vercel/sandbox';

const version = process.env.AGENT_BROWSER_VERSION;
if (!version || !/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(version)) throw new Error('AGENT_BROWSER_VERSION must be explicitly pinned');
const workerUrl = new URL('../sandbox/worker.mjs', import.meta.url);
const worker = await readFile(workerUrl);

const sandbox = await Sandbox.create({ runtime: 'node24', persistent: false, timeout: 20 * 60_000 } as any);
try {
  const install = await sandbox.runCommand('npm', ['install', '-g', `agent-browser@${version}`]);
  if (install.exitCode !== 0) throw new Error(await install.stderr());
  const browserInstall = await sandbox.runCommand('agent-browser', ['install', '--with-deps']);
  if (browserInstall.exitCode !== 0) throw new Error(await browserInstall.stderr());
  await sandbox.writeFiles([{ path: '/vercel/sandbox/worker.mjs', content: worker, mode: 0o755 }]);
  const smoke = await sandbox.runCommand('agent-browser', ['--version']);
  if (smoke.exitCode !== 0) throw new Error(await smoke.stderr());
  const snapshot = await sandbox.snapshot({ expiration: 30 * 24 * 60 * 60_000 });
  process.stdout.write(`${snapshot.snapshotId}\n`);
} catch (error) {
  try { await sandbox.stop(); } catch {}
  throw error;
}
