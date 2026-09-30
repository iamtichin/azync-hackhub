import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { test } from 'node:test';

test('refuses an occupied smoke port before launching Playwright', async () => {
  const occupied = createServer();
  await new Promise((resolve, reject) => {
    occupied.once('error', reject);
    occupied.listen(0, '127.0.0.1', resolve);
  });
  try {
    const result = spawnSync(process.execPath, ['scripts/run-smoke.mjs'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 10_000,
      windowsHide: true,
      env: { ...process.env, SMOKE_PORT: String(occupied.address().port) },
    });
    assert.equal(result.status, 1);
    assert.match(`${result.stdout}${result.stderr}`, /refusing to test against another server/);
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, /Running \d+ tests/);
  } finally {
    await new Promise((resolve) => occupied.close(resolve));
  }
});
