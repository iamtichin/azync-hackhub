function assertIsolatedE2eEnvironment() {
  if (process.env.NODE_ENV !== 'test' || process.env.AZYNC_E2E_ISOLATED !== 'true') throw new Error('Phase3 requires isolated E2E mode');
  const url = new URL(process.env.DATABASE_URL || '');
  if (url.protocol !== 'postgresql:' || !['localhost', '127.0.0.1'].includes(url.hostname) || url.port !== '5433' || url.pathname !== '/azync_hackhub_e2e' || url.search !== '?schema=public') throw new Error('Phase3 refuses non-isolated PostgreSQL');
  if (!['localhost', '127.0.0.1'].includes(process.env.REDIS_HOST) || process.env.REDIS_PORT !== '6380' || process.env.REDIS_DB !== '0' || process.env.REDIS_QUEUE_PREFIX !== 'azync-e2e') throw new Error('Phase3 refuses non-isolated Redis');
}
module.exports = { assertIsolatedE2eEnvironment };
