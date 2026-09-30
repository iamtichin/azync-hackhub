import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
} from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';

type CipherPayload = {
  ciphertext: string;
  iv: string;
  authTag: string;
};

export type ChatEncryptionScope = {
  id: string;
  submissionId: string;
  hackathonId: string;
  judgeId: string;
  encryptedDek: string | null;
  dekIv: string | null;
  dekAuthTag: string | null;
  encryptionVersion: string | null;
};

export type EncryptedChatMessage = {
  id: string;
  role: string;
  contextVersion: number;
  content: string | null;
  contentCiphertext: string | null;
  contentIv: string | null;
  contentAuthTag: string | null;
  encryptionVersion: string | null;
};

@Injectable()
export class AiChatEncryptionService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AiChatEncryptionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (
      this.config.get<string>('AI_DATA_ENCRYPTION_MIGRATE_ON_STARTUP') ===
      'false'
    ) {
      return;
    }
    let migrated = 0;
    while (true) {
      const legacy = await this.prisma.aiChatSession.findMany({
        where: {
          OR: [
            { encryptedDek: null },
            { title: { not: null } },
            { messages: { some: { content: { not: null } } } },
          ],
        },
        select: { id: true },
        take: 500,
      });
      if (legacy.length === 0) break;
      for (const session of legacy) await this.ensureEncrypted(session.id);
      migrated += legacy.length;
    }
    if (migrated > 0) {
      this.logger.log(
        JSON.stringify({
          event: 'ai_chat_plaintext_migrated',
          sessions: migrated,
        }),
      );
    }
  }

  newSessionId(): string {
    return randomUUID();
  }

  createSessionMaterial(input: {
    id: string;
    submissionId: string;
    hackathonId: string;
    judgeId: string;
    title: string | null;
  }) {
    const version = this.currentVersion();
    const dek = randomBytes(32);
    const wrapped = this.encrypt(
      this.masterKey(),
      dek,
      this.dekAad(input, version),
    );
    const encryptedTitle = input.title
      ? this.encrypt(
          dek,
          Buffer.from(input.title, 'utf8'),
          this.titleAad(input, version),
        )
      : null;
    return {
      encryptedDek: wrapped.ciphertext,
      dekIv: wrapped.iv,
      dekAuthTag: wrapped.authTag,
      encryptionVersion: version,
      title: null,
      titleCiphertext: encryptedTitle?.ciphertext ?? null,
      titleIv: encryptedTitle?.iv ?? null,
      titleAuthTag: encryptedTitle?.authTag ?? null,
    };
  }

  async ensureEncrypted(sessionId: string): Promise<void> {
    const session = await this.prisma.aiChatSession.findUnique({
      where: { id: sessionId },
      include: { messages: true },
    });
    if (!session) return;
    const version = session.encryptionVersion ?? this.currentVersion();
    let dek: Buffer;
    let material: ReturnType<
      AiChatEncryptionService['createSessionMaterial']
    > | null = null;
    if (
      session.encryptedDek &&
      session.dekIv &&
      session.dekAuthTag &&
      session.encryptionVersion
    ) {
      dek = this.unwrapDek(session);
    } else {
      material = this.createSessionMaterial({
        id: session.id,
        submissionId: session.submissionId,
        hackathonId: session.hackathonId,
        judgeId: session.judgeId,
        title: session.title,
      });
      dek = this.unwrapDek({ ...session, ...material });
    }

    await this.prisma.$transaction(async (tx) => {
      if (material || session.title !== null) {
        const encryptedTitle =
          !material && session.title
            ? this.encrypt(
                dek,
                Buffer.from(session.title, 'utf8'),
                this.titleAad(session, version),
              )
            : null;
        await tx.aiChatSession.update({
          where: { id: session.id },
          data: material ?? {
            title: null,
            titleCiphertext: encryptedTitle?.ciphertext ?? null,
            titleIv: encryptedTitle?.iv ?? null,
            titleAuthTag: encryptedTitle?.authTag ?? null,
          },
        });
      }
      for (const message of session.messages.filter(
        (item) => item.content !== null,
      )) {
        const encrypted = this.encrypt(
          dek,
          Buffer.from(message.content!, 'utf8'),
          this.messageAad(session, message, version),
        );
        await tx.aiChatMessage.update({
          where: { id: message.id },
          data: {
            content: null,
            contentCiphertext: encrypted.ciphertext,
            contentIv: encrypted.iv,
            contentAuthTag: encrypted.authTag,
            encryptionVersion: version,
          },
        });
      }
    });
  }

  encryptMessage(
    session: ChatEncryptionScope,
    message: { id: string; role: string; contextVersion: number },
    plaintext: string,
  ) {
    const version = this.requireEnvelope(session);
    const encrypted = this.encrypt(
      this.unwrapDek(session),
      Buffer.from(plaintext, 'utf8'),
      this.messageAad(session, message, version),
    );
    return {
      id: message.id,
      content: null,
      contentCiphertext: encrypted.ciphertext,
      contentIv: encrypted.iv,
      contentAuthTag: encrypted.authTag,
      encryptionVersion: version,
    };
  }

  decryptMessages<T extends EncryptedChatMessage>(
    session: ChatEncryptionScope,
    messages: T[],
  ): Array<
    Omit<
      T,
      | 'content'
      | 'contentCiphertext'
      | 'contentIv'
      | 'contentAuthTag'
      | 'encryptionVersion'
    > & { content: string }
  > {
    const version = this.requireEnvelope(session);
    const dek = this.unwrapDek(session);
    return messages.map((message) => {
      const {
        content: legacyContent,
        contentCiphertext,
        contentIv,
        contentAuthTag,
        encryptionVersion: _encryptionVersion,
        ...safe
      } = message;
      if (!contentCiphertext || !contentIv || !contentAuthTag) {
        if (legacyContent !== null) return { ...safe, content: legacyContent };
        throw new Error(`Encrypted chat message ${message.id} is incomplete`);
      }
      const plaintext = this.decrypt(
        dek,
        {
          ciphertext: contentCiphertext,
          iv: contentIv,
          authTag: contentAuthTag,
        },
        this.messageAad(session, message, version),
      ).toString('utf8');
      return { ...safe, content: plaintext };
    });
  }

  decryptTitle<
    T extends ChatEncryptionScope & {
      title: string | null;
      titleCiphertext: string | null;
      titleIv: string | null;
      titleAuthTag: string | null;
    },
  >(session: T): string | null {
    if (!session.titleCiphertext) return session.title;
    if (!session.titleIv || !session.titleAuthTag) {
      throw new Error(`Encrypted chat title ${session.id} is incomplete`);
    }
    const version = this.requireEnvelope(session);
    return this.decrypt(
      this.unwrapDek(session),
      {
        ciphertext: session.titleCiphertext,
        iv: session.titleIv,
        authTag: session.titleAuthTag,
      },
      this.titleAad(session, version),
    ).toString('utf8');
  }

  private unwrapDek(session: ChatEncryptionScope): Buffer {
    const version = this.requireEnvelope(session);
    return this.decrypt(
      this.masterKey(),
      {
        ciphertext: session.encryptedDek!,
        iv: session.dekIv!,
        authTag: session.dekAuthTag!,
      },
      this.dekAad(session, version),
    );
  }

  private requireEnvelope(session: ChatEncryptionScope): string {
    if (
      !session.encryptedDek ||
      !session.dekIv ||
      !session.dekAuthTag ||
      !session.encryptionVersion
    ) {
      throw new Error(`Chat session ${session.id} has no encryption envelope`);
    }
    if (session.encryptionVersion !== this.currentVersion()) {
      throw new Error(
        `Encryption key version ${session.encryptionVersion} is not configured`,
      );
    }
    return session.encryptionVersion;
  }

  private currentVersion(): string {
    return (
      this.config.get<string>('AI_DATA_ENCRYPTION_KEY_VERSION')?.trim() || 'v1'
    );
  }

  private masterKey(): Buffer {
    const encoded = this.config.get<string>('AI_DATA_ENCRYPTION_KEY')?.trim();
    if (!encoded) throw new Error('AI_DATA_ENCRYPTION_KEY is required');
    const key = Buffer.from(encoded, 'base64');
    if (key.length !== 32) {
      throw new Error(
        'AI_DATA_ENCRYPTION_KEY must be a base64-encoded 32-byte key',
      );
    }
    return key;
  }

  private encrypt(key: Buffer, plaintext: Buffer, aad: string): CipherPayload {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(aad, 'utf8'));
    const ciphertext = Buffer.concat([
      cipher.update(plaintext),
      cipher.final(),
    ]);
    return {
      ciphertext: ciphertext.toString('base64'),
      iv: iv.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
    };
  }

  private decrypt(key: Buffer, payload: CipherPayload, aad: string): Buffer {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(payload.iv, 'base64'),
    );
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(Buffer.from(payload.authTag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(payload.ciphertext, 'base64')),
      decipher.final(),
    ]);
  }

  private dekAad(
    scope: Pick<
      ChatEncryptionScope,
      'id' | 'submissionId' | 'hackathonId' | 'judgeId'
    >,
    version: string,
  ): string {
    return [
      'azync',
      'chat-dek',
      version,
      scope.judgeId,
      scope.id,
      scope.submissionId,
      scope.hackathonId,
    ].join('|');
  }

  private titleAad(
    scope: Pick<
      ChatEncryptionScope,
      'id' | 'submissionId' | 'hackathonId' | 'judgeId'
    >,
    version: string,
  ): string {
    return [
      'azync',
      'chat-title',
      version,
      scope.judgeId,
      scope.id,
      scope.submissionId,
      scope.hackathonId,
    ].join('|');
  }

  private messageAad(
    scope: Pick<ChatEncryptionScope, 'id' | 'judgeId'>,
    message: Pick<EncryptedChatMessage, 'id' | 'role' | 'contextVersion'>,
    version: string,
  ): string {
    return [
      'azync',
      'chat-message',
      version,
      scope.judgeId,
      scope.id,
      message.id,
      message.role,
      message.contextVersion,
    ].join('|');
  }
}
