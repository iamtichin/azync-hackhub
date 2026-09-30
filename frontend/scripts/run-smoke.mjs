import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';

const port = Number(process.env.SMOKE_PORT || 3100);
const baseURL = `http://127.0.0.1:${port}`;
let next;

async function assertPortAvailable() {
  await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', (error) => {
      reject(new Error(`Smoke port ${port} is unavailable; refusing to test against another server.`, { cause: error }));
    });
    probe.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
      probe.close((error) => error ? reject(error) : resolve());
    });
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (next.exitCode !== null || next.signalCode !== null) {
      throw new Error(`Next exited before becoming ready (exit code ${next.exitCode}).`);
    }
    let response;
    try {
      response = await fetch(baseURL);
    } catch {
      // The server is still starting.
    }
    if (response?.ok) {
      // A competing server can answer the health request just before our
      // child reports EADDRINUSE. Never start Playwright in that race.
      await wait(250);
      if (next.exitCode !== null || next.signalCode !== null) {
        throw new Error(`Next exited before becoming ready (exit code ${next.exitCode}).`);
      }
      return;
    }
    await wait(100);
  }
  throw new Error(`Timed out waiting for ${baseURL}.`);
}

async function stopNext() {
  if (!next?.pid || next.exitCode !== null || next.signalCode !== null) return;
  next.kill('SIGTERM');
  const exited = await Promise.race([
    new Promise((resolve) => next.once('exit', resolve)),
    wait(5_000).then(() => false),
  ]);
  if (exited === false && process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(next.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  }
}

try {
  await assertPortAvailable();
  next = spawn(
    process.execPath,
    ['./scripts/start-smoke-server.cjs', String(port)],
    {
      stdio: 'inherit',
      windowsHide: true,
      env: { ...process.env, NODE_ENV: 'production', NEXT_RUNTIME: 'nodejs' },
    },
  );
  await waitForServer();
  const playwright = spawn(
    process.execPath,
    ['./node_modules/playwright/cli.js', 'test', ...process.argv.slice(2)],
    { stdio: 'inherit', windowsHide: true },
  );
  const exitCode = await new Promise((resolve, reject) => {
    playwright.once('error', reject);
    playwright.once('exit', (code) => resolve(code ?? 1));
  });
  process.exitCode = exitCode;
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await stopNext();
}
