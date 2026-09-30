import { randomUUID } from 'crypto';
import { existsSync } from 'fs';
import { dirname, relative, resolve } from 'path';
import { fileURLToPath } from 'url';
import { config as loadDotenv } from 'dotenv';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const TEST_DATABASE = 'azync_hackhub_e2e';
const TEST_DATABASE_PORT = '5433';
const TEST_REDIS_PORT = '6380';
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

function environmentFile(): string {
  const configured = process.env.AZYNC_E2E_ENV_FILE;
  if (configured) {
    const candidate = resolve(PROJECT_ROOT, configured);
    if (relative(PROJECT_ROOT, candidate).startsWith('..')) {
      throw new Error(
        'AZYNC_E2E_ENV_FILE must stay inside the backend project',
      );
    }
    if (!existsSync(candidate)) {
      throw new Error(`Missing configured E2E environment file: ${candidate}`);
    }
    return candidate;
  }

  const local = resolve(PROJECT_ROOT, '.env.test');
  return existsSync(local) ? local : resolve(PROJECT_ROOT, '.env.test.example');
}

export function loadAndValidateE2eEnvironment(): void {
  const suppliedRunId = process.env.AZYNC_E2E_RUN_ID;
  const file = environmentFile();
  if (!existsSync(file)) {
    throw new Error(`Missing E2E environment file: ${file}`);
  }

  const loaded = loadDotenv({ path: file, override: true });
  if (loaded.error) throw loaded.error;
  if (suppliedRunId) process.env.AZYNC_E2E_RUN_ID = suppliedRunId;
  if (!process.env.AZYNC_E2E_RUN_ID) {
    process.env.AZYNC_E2E_RUN_ID = randomUUID();
  }

  assertIsolatedE2eEnvironment();
}

export function assertIsolatedE2eEnvironment(): void {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('E2E requires NODE_ENV=test');
  }
  if (process.env.AZYNC_E2E_ISOLATED !== 'true') {
    throw new Error('E2E requires AZYNC_E2E_ISOLATED=true');
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('E2E requires DATABASE_URL');

  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error('E2E DATABASE_URL is invalid');
  }
  const database = parsed.pathname.replace(/^\//, '');
  const queryKeys = [...parsed.searchParams.keys()];
  if (
    parsed.protocol !== 'postgresql:' ||
    !LOCAL_HOSTS.has(parsed.hostname) ||
    parsed.port !== TEST_DATABASE_PORT ||
    database !== TEST_DATABASE ||
    parsed.hash ||
    queryKeys.length !== 1 ||
    queryKeys[0] !== 'schema' ||
    parsed.searchParams.get('schema') !== 'public'
  ) {
    throw new Error(
      `E2E DATABASE_URL must target local ${TEST_DATABASE} on port ${TEST_DATABASE_PORT}`,
    );
  }

  if (
    !LOCAL_HOSTS.has(process.env.REDIS_HOST ?? '') ||
    process.env.REDIS_PORT !== TEST_REDIS_PORT ||
    process.env.REDIS_DB !== '0' ||
    process.env.REDIS_QUEUE_PREFIX !== 'azync-e2e'
  ) {
    throw new Error(
      `E2E Redis must target a dedicated local instance on port ${TEST_REDIS_PORT}, database 0, with prefix azync-e2e`,
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
  ) {
    throw new Error('E2E requires its own AI_DATA_ENCRYPTION_KEY fixture');
  }
}

export function e2eFixtureId(prefix: string): string {
  const runId = process.env.AZYNC_E2E_RUN_ID;
  if (!runId) throw new Error('E2E run ID was not initialized');
  return `${prefix}-${runId}-${randomUUID()}`;
}
