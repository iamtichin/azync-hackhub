const { ConfigService } = require('@nestjs/config');
const {
  AiChatEncryptionService,
} = require('../dist/src/modules/ai/crypto/ai-chat-encryption.service.js');
const {
  PrismaService,
} = require('../dist/src/modules/prisma/prisma.service.js');

const ids = {
  organizer: 'phase8-backup-organizer',
  judge: 'phase8-backup-judge',
  hackathon: 'phase8-backup-hackathon',
  team: 'phase8-backup-team',
  submission: 'phase8-backup-submission',
  context: 'phase8-backup-context',
  session: 'phase8-backup-session',
  message: 'phase8-backup-message',
};

async function readAndDecrypt(prisma, encryption) {
  const session = await prisma.aiChatSession.findUnique({
    where: { id: ids.session },
    include: { messages: { orderBy: { createdAt: 'asc' } } },
  });
  if (!session) throw new Error('Backup fixture session is missing');
  const title = encryption.decryptTitle(session);
  const messages = encryption.decryptMessages(session, session.messages);
  return {
    title,
    messages: messages.map((message) => message.content),
    plaintextColumnsCleared:
      session.title === null &&
      session.messages.every((message) => message.content === null),
    encryptedEnvelopePresent: Boolean(
      session.encryptedDek &&
        session.titleCiphertext &&
        session.messages.every((message) => message.contentCiphertext),
    ),
  };
}

async function seed(prisma, encryption) {
  await prisma.user.createMany({
    data: [
      {
        id: ids.organizer,
        githubId: 'phase8-backup-organizer-github',
        githubUsername: 'phase8-backup-organizer',
        name: 'Backup Organizer',
      },
      {
        id: ids.judge,
        githubId: 'phase8-backup-judge-github',
        githubUsername: 'phase8-backup-judge',
        name: 'Backup Judge',
      },
    ],
  });
  await prisma.hackathon.create({
    data: {
      id: ids.hackathon,
      organizerId: ids.organizer,
      name: 'Phase 8 backup fixture',
      isPublished: true,
      startDate: new Date('2026-09-01T00:00:00.000Z'),
      endDate: new Date('2026-10-01T00:00:00.000Z'),
      judges: { create: { userId: ids.judge } },
    },
  });
  await prisma.team.create({
    data: {
      id: ids.team,
      name: 'Phase 8 backup team',
      hackathonId: ids.hackathon,
    },
  });
  await prisma.submission.create({
    data: {
      id: ids.submission,
      teamId: ids.team,
      hackathonId: ids.hackathon,
      projectName: 'Phase 8 backup project',
      description: 'Encrypted chat backup and restore fixture.',
      githubUrl: 'https://github.com/example/phase8-backup',
      demoUrl: 'https://example.com/phase8-backup',
      walletAddress: '7EqQdEUwTCgDiseM8LxrfZgq8Y8pT8h1C3L2tK9X8t3s',
      finalSnapshot: { receiptVersion: 2, projectName: 'Phase 8 backup project' },
      finalizedAt: new Date('2026-09-02T00:00:00.000Z'),
      receiptVersion: 2,
    },
  });
  await prisma.aiContextSession.create({
    data: {
      id: ids.context,
      submissionId: ids.submission,
      hackathonId: ids.hackathon,
      contextVersion: 1,
    },
  });
  await prisma.aiChatSession.create({
    data: {
      id: ids.session,
      submissionId: ids.submission,
      hackathonId: ids.hackathon,
      contextSessionId: ids.context,
      judgeId: ids.judge,
      title: 'Restorable private review',
      contextVersion: 1,
      rulesVersion: 'rules-v1',
      rubricVersion: 'rubric-v1',
      messages: {
        create: {
          id: ids.message,
          role: 'USER',
          content: 'Private fixture survives backup and restore.',
          contextVersion: 1,
        },
      },
    },
  });
  await encryption.ensureEncrypted(ids.session);
}

async function main() {
  const mode = process.argv[2];
  if (!['seed', 'verify'].includes(mode)) {
    throw new Error('Usage: phase8-backup-fixture.cjs seed|verify');
  }
  const prisma = new PrismaService();
  await prisma.$connect();
  try {
    const encryption = new AiChatEncryptionService(
      prisma,
      new ConfigService(process.env),
    );
    if (mode === 'seed') await seed(prisma, encryption);
    const result = await readAndDecrypt(prisma, encryption);
    if (
      result.title !== 'Restorable private review' ||
      result.messages[0] !== 'Private fixture survives backup and restore.' ||
      !result.plaintextColumnsCleared ||
      !result.encryptedEnvelopePresent
    ) {
      throw new Error('Encrypted backup fixture verification failed');
    }
    process.stdout.write(
      `${JSON.stringify({ mode, ...result })}\n`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
