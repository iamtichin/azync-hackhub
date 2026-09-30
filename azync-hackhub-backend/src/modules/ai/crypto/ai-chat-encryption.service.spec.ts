import { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../../prisma/prisma.service';
import { AiChatEncryptionService } from './ai-chat-encryption.service';

describe('AiChatEncryptionService', () => {
  const key = Buffer.alloc(32, 7).toString('base64');
  const config = {
    get: jest.fn((name: string) =>
      name === 'AI_DATA_ENCRYPTION_KEY'
        ? key
        : name === 'AI_DATA_ENCRYPTION_KEY_VERSION'
          ? 'v1'
          : undefined,
    ),
  } as unknown as ConfigService;
  const prisma = {} as PrismaService;

  it('binds encrypted messages to the judge and session scope', () => {
    const service = new AiChatEncryptionService(prisma, config);
    const scope = {
      id: 'session-1',
      submissionId: 'submission-1',
      hackathonId: 'hackathon-1',
      judgeId: 'judge-1',
    };
    const material = service.createSessionMaterial({
      ...scope,
      title: 'Private review',
    });
    const encryptedScope = { ...scope, ...material };
    const encrypted = service.encryptMessage(
      encryptedScope,
      { id: 'message-1', role: 'USER', contextVersion: 3 },
      'What evidence supports this score?',
    );
    const message = {
      role: 'USER',
      contextVersion: 3,
      ...encrypted,
    };

    expect(message.content).toBeNull();
    expect(message.contentCiphertext).not.toContain('evidence');
    expect(service.decryptMessages(encryptedScope, [message])[0].content).toBe(
      'What evidence supports this score?',
    );
    expect(service.decryptTitle({ ...encryptedScope, title: null })).toBe(
      'Private review',
    );
    expect(() =>
      service.decryptMessages({ ...encryptedScope, judgeId: 'judge-2' }, [
        message,
      ]),
    ).toThrow();
  });
});
