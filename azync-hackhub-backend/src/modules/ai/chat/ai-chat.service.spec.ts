import type { PrismaService } from '../../prisma/prisma.service';
import type { AIProvider } from '../providers/ai-provider.interface';
import { AnalysisError } from '../orchestrator/analysis-error';
import { AiChatService } from './ai-chat.service';
import type { AiChatEncryptionService } from '../crypto/ai-chat-encryption.service';

describe('AiChatService failure persistence', () => {
  it('keeps two judges’ private session histories separate', async () => {
    const judgeOneSession = {
      id: 'judge-1-session',
      submissionId: 'submission-1',
      hackathonId: 'hackathon-1',
      judgeId: 'judge-1',
      title: null,
      titleCiphertext: 'ciphertext',
      titleIv: 'iv',
      titleAuthTag: 'tag',
      encryptedDek: 'dek',
      dekIv: 'dek-iv',
      dekAuthTag: 'dek-tag',
      encryptionVersion: 'v1',
      _count: { messages: 3 },
    };
    const judgeTwoSession = {
      ...judgeOneSession,
      id: 'judge-2-session',
      judgeId: 'judge-2',
      _count: { messages: 1 },
    };
    const prisma = {
      submission: { findUnique: jest.fn().mockResolvedValue({ hackathonId: 'hackathon-1' }) },
      hackathonJudge: { findUnique: jest.fn().mockResolvedValue({ id: 'assignment-1' }) },
      aiChatSession: {
        findMany: jest.fn().mockImplementation(({ where }: { where: { judgeId: string } }) =>
          Promise.resolve(where.judgeId === 'judge-1'
            ? [judgeOneSession]
            : [judgeTwoSession]),
        ),
      },
    } as unknown as PrismaService;
    const encryption = {
      ensureEncrypted: jest.fn().mockResolvedValue(undefined),
      decryptTitle: jest.fn().mockReturnValue('Judge one private review'),
    } as unknown as AiChatEncryptionService;
    const service = new AiChatService(prisma, {} as AIProvider, encryption);

    await expect(service.listSessions('submission-1', 'judge-1')).resolves.toEqual([
      expect.objectContaining({ id: 'judge-1-session', judgeId: 'judge-1', title: 'Judge one private review' }),
    ]);
    await expect(service.listSessions('submission-1', 'judge-2')).resolves.toEqual([
      expect.objectContaining({ id: 'judge-2-session', judgeId: 'judge-2', title: 'Judge one private review' }),
    ]);
    expect(prisma.aiChatSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { submissionId: 'submission-1', judgeId: 'judge-1' } }),
    );
    expect(encryption.decryptTitle).toHaveBeenCalledWith(judgeOneSession);
    expect(encryption.decryptTitle).toHaveBeenCalledWith(judgeTwoSession);
  });

  it('does not let judge A read judge B’s session', async () => {
    const prisma = {
      aiChatSession: { findFirst: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;
    const encryption = {
      ensureEncrypted: jest.fn(),
      decryptMessages: jest.fn(),
    } as unknown as AiChatEncryptionService;
    const service = new AiChatService(prisma, {} as AIProvider, encryption);

    await expect(
      service.listMessages('submission-1', 'judge-2-session', 'judge-1'),
    ).rejects.toThrow('AI chat session not found');
    expect(prisma.aiChatSession.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'judge-2-session',
        submissionId: 'submission-1',
        judgeId: 'judge-1',
      },
      select: { id: true, hackathonId: true },
    });
    expect(encryption.ensureEncrypted).not.toHaveBeenCalled();
    expect(encryption.decryptMessages).not.toHaveBeenCalled();
  });

  it('persists the user message and returns typed partial success', async () => {
    const userMessage = { id: 'message-1', role: 'USER', content: 'Question' };
    const prisma = {
      aiChatSession: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'session-1',
          submissionId: 'submission-1',
          hackathonId: 'hackathon-1',
          contextVersion: 1,
          submission: {
            id: 'submission-1',
            hackathonId: 'hackathon-1',
            projectName: 'Project',
            description: 'Description',
            githubUrl: 'https://github.com/example/project',
            demoUrl: 'https://example.com',
            hackathon: {
              id: 'hackathon-1',
              name: 'Hackathon',
              rulesVersion: 'rules-v1',
              rubricVersion: 'rubric-v1',
              rules: [],
              rubric: [],
            },
            aiAnalyses: [],
            evidence: [],
          },
          contextSession: {
            contextVersion: 1,
            snapshots: [{
              analysisId: null,
              evidenceLinks: [{
                evidence: {
                  id: 'evidence-1',
                  type: 'GITHUB_TEST_SIGNAL',
                  status: 'VERIFIED',
                  source: 'github',
                  reference: 'https://github.com/example/project/tree/commit',
                  sourceRevision: 'commit',
                  facts: {
                    executionStatus: 'NOT_RUN',
                    testFilePaths: ['project.test.ts'],
                    workflowPaths: ['ci.yml'],
                  },
                  errorCode: null,
                  collectedAt: new Date('2026-01-01T00:00:00.000Z'),
                },
              }],
            }],
          },
          messages: [],
        }),
      },
      hackathonJudge: {
        findUnique: jest.fn().mockResolvedValue({ id: 'judge' }),
      },
      evidence: { findMany: jest.fn().mockResolvedValue([]) },
      aiChatMessage: { create: jest.fn().mockResolvedValue(userMessage) },
      $transaction: jest.fn(async (callback: (tx: any) => unknown) => callback({
        aiChatMessage: {
          create: jest.fn().mockResolvedValue({
            id: 'message-2',
            role: 'ASSISTANT',
            content: null,
          }),
        },
        aiChatSession: { update: jest.fn().mockResolvedValue({}) },
      })),
    } as unknown as PrismaService;
    const provider = {
      analyze: jest
        .fn()
        .mockRejectedValue(
          new AnalysisError(
            'PROVIDER_UNAVAILABLE',
            'Provider unavailable',
            true,
          ),
        ),
    } as unknown as AIProvider;
    const encryption = {
      ensureEncrypted: jest.fn(),
      newSessionId: jest.fn()
        .mockReturnValueOnce('message-1')
        .mockReturnValueOnce('message-2'),
      encryptMessage: jest.fn((_session, metadata) => ({
        id: metadata.id,
        content: null,
        contentCiphertext: 'ciphertext',
        contentIv: 'iv',
        contentAuthTag: 'tag',
        encryptionVersion: 'v1',
      })),
      decryptMessages: jest.fn((_session: unknown, messages: any[]) =>
        messages.map((message: typeof userMessage) => ({
          ...message,
          content: 'Question',
        })),
      ),
    } as unknown as AiChatEncryptionService;
    const service = new AiChatService(prisma, provider, encryption);

    await expect(
      service.sendMessage('submission-1', 'session-1', 'judge-1', 'Question'),
    ).resolves.toMatchObject({
      status: 'partial',
      userMessage,
      assistantMessage: expect.objectContaining({
        id: 'message-2',
        role: 'ASSISTANT',
      }),
      answer: expect.stringContaining('NOT_RUN'),
      evidenceIds: ['evidence-1'],
      error: { code: 'PROVIDER_UNAVAILABLE', retryable: true },
    });
    expect(prisma.aiChatMessage.create).toHaveBeenCalledTimes(1);
  });

  it('rechecks a judge assignment before decrypting a transcript after a revocation', async () => {
    const prisma = {
      aiChatSession: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'session-1',
          submissionId: 'submission-1',
          hackathonId: 'hackathon-1',
          judgeId: 'judge-1',
        }),
        findUnique: jest.fn().mockResolvedValue({
          id: 'session-1',
          submissionId: 'submission-1',
          hackathonId: 'hackathon-1',
          judgeId: 'judge-1',
          encryptedDek: 'dek',
          dekIv: 'iv',
          dekAuthTag: 'tag',
          encryptionVersion: 'v1',
        }),
      },
      hackathonJudge: {
        // The assignment was valid for the initial ownership check, then an
        // organizer revoked it during encryption migration.
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({ id: 'assignment-1' })
          .mockResolvedValueOnce(null),
      },
      aiChatMessage: { findMany: jest.fn() },
    } as unknown as PrismaService;
    const encryption = {
      ensureEncrypted: jest.fn().mockResolvedValue(undefined),
      decryptMessages: jest.fn(),
    } as unknown as AiChatEncryptionService;
    const service = new AiChatService(
      prisma,
      {} as AIProvider,
      encryption,
    );

    await expect(
      service.listMessages('submission-1', 'session-1', 'judge-1'),
    ).rejects.toThrow('User is not assigned as a judge');
    expect(encryption.decryptMessages).not.toHaveBeenCalled();
    expect(prisma.aiChatMessage.findMany).not.toHaveBeenCalled();
  });
});
