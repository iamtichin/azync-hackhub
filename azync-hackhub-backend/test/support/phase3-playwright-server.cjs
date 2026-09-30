/* Isolated Nest fixture for the browser-to-webhook latency exercise. */
const { createHmac, randomUUID } = require('node:crypto');
const { resolve } = require('node:path');
const { existsSync } = require('node:fs');
const { config } = require('dotenv');
const { Test } = require('@nestjs/testing');
const { ValidationPipe } = require('@nestjs/common');

const root = resolve(__dirname, '../..');
const suppliedRunId = process.env.AZYNC_E2E_RUN_ID;
const envFile = process.env.AZYNC_E2E_ENV_FILE || (existsSync(resolve(root, '.env.test')) ? '.env.test' : '.env.test.example');
if (resolve(root, envFile).startsWith(root) === false) throw new Error('E2E env file must be within backend');
config({ path: resolve(root, envFile), override: true });
if (suppliedRunId) process.env.AZYNC_E2E_RUN_ID = suppliedRunId;
process.env.FRONTEND_URL = 'http://127.0.0.1:3100';
const { assertIsolatedE2eEnvironment } = require('./phase3-isolation.cjs');
assertIsolatedE2eEnvironment();

const { AppModule } = require('../../dist/src/app.module.js');
const { PrismaService } = require('../../dist/src/modules/prisma/prisma.service.js');
const { SolanaService } = require('../../dist/src/modules/solana/solana.service.js');
const runId = process.env.AZYNC_E2E_RUN_ID || randomUUID();
const unique = randomUUID();
const hackathonId = `phase3-hack-${unique}`;
const teamId = `phase3-team-${unique}`;
const userId = `phase3-user-${unique}`;
const deliveryId = `phase3-delivery-${unique}`;
const repositoryFullName = `fixture/phase3-${unique}`;
const headSha = 'c'.repeat(40);
const workflowRunId = String(Date.now());
let app;
let prisma;
let receivedAt;
let stopping = false;

function jwt() {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const signed = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: userId, jti: unique, exp: Math.floor(Date.now() / 1000) + 600 })}`;
  return `${signed}.${createHmac('sha256', process.env.JWT_SECRET).update(signed).digest('base64url')}`;
}

async function stop() {
  if (stopping) return;
  stopping = true;
  try {
    if (prisma) {
      await prisma.gitHubWebhookDelivery.deleteMany({ where: { deliveryId } });
      await prisma.team.deleteMany({ where: { id: teamId } });
      await prisma.hackathon.deleteMany({ where: { id: hackathonId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    }
  } finally {
    if (app) await app.close();
    process.exit(0);
  }
}

process.on('message', async (message) => {
  if (message === 'stop') await stop();
  if (message === 'received') process.send?.({ type: 'received', ns: receivedAt?.toString() });
  if (message === 'persisted') {
    const repository = await prisma.gitHubRepository.findUnique({ where: { teamId } });
    const run = repository && await prisma.gitHubWorkflowRun.findUnique({
      where: { repositoryId_runId_runAttempt: { repositoryId: repository.id, runId: workflowRunId, runAttempt: 1 } },
    });
    const delivery = await prisma.gitHubWebhookDelivery.findUnique({ where: { deliveryId } });
    process.send?.({ type: 'persisted', run: run && { id: run.runId, testStatus: run.testStatus, headSha: run.headSha }, delivery: delivery && { status: delivery.status, id: delivery.deliveryId } });
  }
});
process.on('SIGTERM', () => { void stop(); });

async function main() {
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(SolanaService)
    .useValue({ getHealth: async () => ({ status: 'ok', network: 'fixture' }) })
    .compile();
  app = module.createNestApplication({ rawBody: true });
  app.use((req, _res, next) => {
    if (req.path === '/webhooks/github' && req.headers['x-github-delivery'] === deliveryId) receivedAt = process.hrtime.bigint();
    next();
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.enableCors({ origin: ['http://127.0.0.1:3100'], credentials: true, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization'] });
  await app.listen(3201, '127.0.0.1');
  prisma = app.get(PrismaService);
  await prisma.user.create({ data: { id: userId, githubId: `phase3-${unique}`, githubUsername: `phase3-${unique}`, name: 'Phase3 User' } });
  await prisma.hackathon.create({ data: { id: hackathonId, name: 'Phase3 Event', isPublished: true, startDate: new Date('2026-09-01T00:00:00Z'), endDate: new Date('2026-10-01T00:00:00Z') } });
  await prisma.team.create({ data: { id: teamId, name: 'Phase3 Team', hackathonId, registrations: { create: { hackathonId } }, repository: { create: { fullName: repositoryFullName, url: `https://github.com/${repositoryFullName}`, webhookConfigured: true } } } });
  process.send?.({ type: 'ready', runId, hackathonId, teamId, userId, deliveryId, repositoryFullName, headSha, workflowRunId, token: jwt() });
}
main().catch(async (error) => {
  process.send?.({ type: 'error', message: error.stack || String(error) });
  if (app) await app.close();
  process.exit(1);
});
