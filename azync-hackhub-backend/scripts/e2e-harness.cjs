const { spawnSync } = require('node:child_process');
const {
  existsSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} = require('node:fs');
const { relative, resolve } = require('node:path');
const { config: loadDotenv } = require('dotenv');
const { randomUUID } = require('node:crypto');

const root = resolve(__dirname, '..');
const composeFile = 'docker-compose.test.yml';
const composeLockFile = resolve(root, '.e2e-compose.lock');
const testDatabase = 'azync_hackhub_e2e';
const localHosts = new Set(['127.0.0.1', 'localhost', '::1']);

function loadEnvironment({ requireRunId = false } = {}) {
  const suppliedRunId = process.env.AZYNC_E2E_RUN_ID;
  const requested = process.env.AZYNC_E2E_ENV_FILE;
  const configured = requested
    ? resolve(root, requested)
    : resolve(root, '.env.test');
  const fallback = resolve(root, '.env.test.example');
  if (requested && !existsSync(configured)) {
    throw new Error(`Missing configured E2E environment file: ${configured}`);
  }
  const file = existsSync(configured) ? configured : fallback;
  if (relative(root, file).startsWith('..') || !existsSync(file)) {
    throw new Error(
      'E2E environment file must exist inside the backend project',
    );
  }
  const result = loadDotenv({ path: file, override: true });
  if (result.error) throw result.error;
  if (suppliedRunId) process.env.AZYNC_E2E_RUN_ID = suppliedRunId;
  if (!process.env.AZYNC_E2E_RUN_ID && requireRunId) {
    throw new Error(
      'AZYNC_E2E_RUN_ID is required for standalone lifecycle commands; use test:e2e:ci or provide one shared run ID',
    );
  }
  process.env.AZYNC_E2E_RUN_ID ||= randomUUID();
  assertIsolatedEnvironment();
}

function currentRunId() {
  const runId = process.env.AZYNC_E2E_RUN_ID;
  if (!runId) throw new Error('E2E run ID was not initialized');
  return runId;
}

function readComposeLock() {
  return existsSync(composeLockFile)
    ? readFileSync(composeLockFile, 'utf8').trim()
    : undefined;
}

function acquireComposeLock() {
  const runId = currentRunId();
  const owner = readComposeLock();
  if (owner && owner !== runId) {
    throw new Error(
      `Another isolated E2E run (${owner}) owns the fixed test ports; run its test:e2e:down first`,
    );
  }
  writeFileSync(composeLockFile, `${runId}\n`, { flag: 'w' });
}

function assertComposeLockOwned() {
  if (readComposeLock() !== currentRunId()) {
    throw new Error(
      'This E2E lifecycle command does not own the fixed test ports; run test:e2e:up with the same AZYNC_E2E_RUN_ID first',
    );
  }
}

function releaseComposeLock() {
  if (readComposeLock() === currentRunId()) unlinkSync(composeLockFile);
}

function assertIsolatedEnvironment() {
  if (
    process.env.NODE_ENV !== 'test' ||
    process.env.AZYNC_E2E_ISOLATED !== 'true'
  ) {
    throw new Error('E2E requires NODE_ENV=test and AZYNC_E2E_ISOLATED=true');
  }
  let url;
  try {
    url = new URL(process.env.DATABASE_URL || '');
  } catch {
    throw new Error('E2E DATABASE_URL is invalid');
  }
  const queryKeys = [...url.searchParams.keys()];
  if (
    url.protocol !== 'postgresql:' ||
    !localHosts.has(url.hostname) ||
    url.port !== '5433' ||
    url.pathname.replace(/^\//, '') !== testDatabase ||
    url.hash ||
    queryKeys.length !== 1 ||
    queryKeys[0] !== 'schema' ||
    url.searchParams.get('schema') !== 'public'
  ) {
    throw new Error(
      `E2E DATABASE_URL must target local ${testDatabase} on port 5433`,
    );
  }
  if (
    !localHosts.has(process.env.REDIS_HOST || '') ||
    process.env.REDIS_PORT !== '6380' ||
    process.env.REDIS_DB !== '0' ||
    process.env.REDIS_QUEUE_PREFIX !== 'azync-e2e'
  ) {
    throw new Error(
      'E2E Redis must target the dedicated local instance on port 6380, database 0, with prefix azync-e2e',
    );
  }
  const encryptionKey = process.env.AI_DATA_ENCRYPTION_KEY;
  const decodedKey = encryptionKey
    ? Buffer.from(encryptionKey, 'base64')
    : undefined;
  if (
    !encryptionKey ||
    !decodedKey ||
    decodedKey.length !== 32 ||
    decodedKey.toString('base64') !== encryptionKey
  )
    throw new Error(
      'E2E requires a canonical base64-encoded 32-byte AI_DATA_ENCRYPTION_KEY fixture',
    );
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
    shell: false,
  });
  if (result.error) {
    console.error(
      `Unable to start ${command}: ${result.error.code || result.error.message}`,
    );
  }
  if (result.signal) {
    console.error(`${command} terminated by signal ${result.signal}`);
  }
  if (result.status !== 0) process.exitCode = result.status || 1;
  return result.status === 0;
}

function compose(args) {
  const runId = process.env.AZYNC_E2E_RUN_ID;
  const normalized = runId.replace(/[^a-zA-Z0-9_-]/g, '').toLowerCase();
  if (!normalized)
    throw new Error('AZYNC_E2E_RUN_ID must contain letters or numbers');
  return run('docker', [
    'compose',
    '--project-name',
    `azync-hackhub-e2e-${normalized}`,
    '-f',
    composeFile,
    ...args,
  ]);
}

function execute(action) {
  loadEnvironment({
    requireRunId: ['up', 'migrate', 'run', 'down'].includes(action),
  });
  switch (action) {
    case 'validate':
      return true;
    case 'up':
      acquireComposeLock();
      let started = false;
      try {
        started = compose(['up', '--detach', '--wait']);
        return started;
      } finally {
        if (!started) {
          compose(['down', '--volumes', '--remove-orphans']);
          releaseComposeLock();
        }
      }
    case 'migrate':
      assertComposeLockOwned();
      return run(process.execPath, [
        require.resolve('prisma/build/index.js'),
        'migrate',
        'deploy',
      ]);
    case 'run':
      assertComposeLockOwned();
      return run('node', [
        '--experimental-vm-modules',
        './node_modules/jest/bin/jest.js',
        '--config',
        './test/jest-e2e.json',
        '--runInBand',
      ]);
    case 'down':
      assertComposeLockOwned();
      try {
        return compose(['down', '--volumes', '--remove-orphans']);
      } finally {
        releaseComposeLock();
      }
    case 'ci': {
      let started = false;
      try {
        started = execute('up');
        return started && execute('migrate') && execute('run');
      } finally {
        if (started) execute('down');
      }
    }
    default:
      throw new Error(`Unknown E2E harness action: ${action}`);
  }
}

try {
  if (!execute(process.argv[2] || 'validate')) process.exitCode = 1;
} catch (error) {
  console.error(`E2E harness refused to run: ${error.message}`);
  process.exitCode = 1;
}
