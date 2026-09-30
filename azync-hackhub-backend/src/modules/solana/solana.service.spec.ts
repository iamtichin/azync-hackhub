import { BadRequestException, NotFoundException } from '@nestjs/common';
jest.mock('@metaplex-foundation/mpl-bubblegum', () => ({
  ...jest.requireActual('@metaplex-foundation/mpl-bubblegum'),
  findLeafAssetIdPda: jest.fn(),
  hashMetadataDataV2: jest.fn(),
  mintV2: jest.fn(),
  parseLeafFromMintV2Transaction: jest.fn(),
}));
import {
  BUBBLEGUM_METADATA_LIMITS,
  assertPublicCredentialMetadataBaseUrl,
  canonicalJson,
  hashFinalSubmissionSnapshot,
  hashWinnerDecisionSnapshot,
  truncateUtf8,
  validateBubblegumMetadata,
  SolanaService,
} from './solana.service';

describe('Solana metadata safeguards', () => {
  it('refuses a local or non-HTTPS metadata base before a real mint', () => {
    expect(() =>
      assertPublicCredentialMetadataBaseUrl(
        'http://localhost:3001/solana/credentials/v1',
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      assertPublicCredentialMetadataBaseUrl('https://127.0.0.1/credentials'),
    ).toThrow(BadRequestException);
    expect(() =>
      assertPublicCredentialMetadataBaseUrl('https://0.0.0.0/credentials'),
    ).toThrow(BadRequestException);
    expect(() =>
      assertPublicCredentialMetadataBaseUrl('https://[::1]/credentials'),
    ).toThrow(BadRequestException);
    expect(() =>
      assertPublicCredentialMetadataBaseUrl('https://[fd00::1]/credentials'),
    ).toThrow(BadRequestException);
    expect(() =>
      assertPublicCredentialMetadataBaseUrl('https://169.254.1.1/credentials'),
    ).toThrow(BadRequestException);
    expect(() =>
      assertPublicCredentialMetadataBaseUrl(
        'https://[::ffff:192.168.1.1]/credentials',
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      assertPublicCredentialMetadataBaseUrl(
        'https://metadata.local/credentials',
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      assertPublicCredentialMetadataBaseUrl(
        'https://proof.example/credentials/v1',
      ),
    ).not.toThrow();
  });
  const receipt = {
    schemaVersion: 1,
    receiptVersion: 1,
    teamId: 'team',
    hackathonId: 'hack',
    trackId: 'track',
    acceptedAt: '2030-01-01T00:00:00.000Z',
    projectName: 'Project',
  };
  const mintedReceipt = { ...receipt, receiptVersion: 2 };

  it('uses a versioned canonical receipt hash independent of key insertion order', () => {
    const reordered = {
      projectName: 'Project',
      acceptedAt: receipt.acceptedAt,
      trackId: 'track',
      hackathonId: 'hack',
      teamId: 'team',
      receiptVersion: 1,
      schemaVersion: 1,
    };
    expect(canonicalJson(receipt)).toBe(canonicalJson(reordered));
    expect(hashFinalSubmissionSnapshot(receipt)).toBe(
      hashFinalSubmissionSnapshot(reordered),
    );
  });

  it('detects a tampered final receipt and rejects unsupported versions', () => {
    expect(
      hashFinalSubmissionSnapshot({ ...receipt, projectName: 'Tampered' }),
    ).not.toBe(hashFinalSubmissionSnapshot(receipt));
    expect(() =>
      hashFinalSubmissionSnapshot({ ...receipt, schemaVersion: 2 }),
    ).toThrow(BadRequestException);
  });

  it('uses a canonical, versioned hash for the human winner decision', () => {
    const decision = {
      schemaVersion: 1,
      awardVersion: 1,
      awardType: 'HACKATHON_WINNER',
      hackathonId: 'hack',
      submissionId: 'submission',
      recipientAddress: 'recipient',
      selectedAt: '2030-01-02T00:00:00.000Z',
    };
    const reordered = {
      selectedAt: decision.selectedAt,
      recipientAddress: 'recipient',
      submissionId: 'submission',
      hackathonId: 'hack',
      awardType: 'HACKATHON_WINNER',
      awardVersion: 1,
      schemaVersion: 1,
    };
    expect(hashWinnerDecisionSnapshot(decision)).toBe(
      hashWinnerDecisionSnapshot(reordered),
    );
    expect(
      hashWinnerDecisionSnapshot({ ...decision, submissionId: 'tampered' }),
    ).not.toBe(hashWinnerDecisionSnapshot(decision));
    expect(() =>
      hashWinnerDecisionSnapshot({ ...decision, awardVersion: 2 }),
    ).toThrow(BadRequestException);
  });
  it('keeps V2 hash stable when optional fields disappear in JSON storage', () => {
    const snapshot = {
      ...receipt,
      receiptVersion: 2,
      videoUrl: undefined,
      slidesUrl: null,
    };
    expect(hashFinalSubmissionSnapshot(snapshot)).toBe(
      hashFinalSubmissionSnapshot(JSON.parse(JSON.stringify(snapshot))),
    );
    expect(hashFinalSubmissionSnapshot(snapshot)).not.toBe(
      hashFinalSubmissionSnapshot({ ...snapshot, slidesUrl: 'changed' }),
    );
    expect(() =>
      hashFinalSubmissionSnapshot({ ...snapshot, score: Number.NaN }),
    ).toThrow(BadRequestException);
  });
  it('Bubblegum V2 data hash is 32 bytes and commits the metadata URI', () => {
    const { hashMetadataDataV2, hashMetadataV2 } = jest.requireActual(
      '@metaplex-foundation/mpl-bubblegum',
    );
    const metadata = {
      name: 'Azync HackHub Credential',
      symbol: 'AHSUB',
      uri: `https://proof.example/credentials/v1/${hashFinalSubmissionSnapshot({ ...receipt, receiptVersion: 2 })}.json`,
      sellerFeeBasisPoints: 0,
      collection: null,
      creators: [
        {
          address: '7EqQdEUwTCgDiseM8LxrfZgq8Y8pT8h1C3L2tK9X8t3s',
          verified: true,
          share: 100,
        },
      ],
    };
    const hash = hashMetadataDataV2(metadata);
    expect(hash).toHaveLength(32);
    // The pre-fix implementation persisted hashMetadataV2 (data + creator
    // hashes, 64 bytes) and compared it to a leaf's 32-byte dataHash.
    expect(hashMetadataV2(metadata)).toHaveLength(64);
    expect(
      Buffer.from(hash).equals(
        Buffer.from(
          hashMetadataDataV2({
            ...metadata,
            uri: metadata.uri.replace('/v1/', '/v2/'),
          }),
        ),
      ),
    ).toBe(false);
  });
  it('truncates names by UTF-8 bytes without splitting a character', () => {
    const value = truncateUtf8('Cuộc thi rất dài - dự án siêu dài', 32);
    expect(Buffer.byteLength(value, 'utf8')).toBeLessThanOrEqual(32);
    expect(value.endsWith('...')).toBe(true);
    expect(value).not.toContain('\uFFFD');
  });

  it('rejects fields beyond Bubblegum byte limits before minting', () => {
    expect(() =>
      validateBubblegumMetadata({
        name: 'a'.repeat(BUBBLEGUM_METADATA_LIMITS.name + 1),
        symbol: 'AHSUB',
        uri: '',
      }),
    ).toThrow(BadRequestException);
  });

  it('reconciles an observed signature instead of minting again', async () => {
    const solanaUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const submissionUpdate = jest.fn().mockResolvedValue({});
    const tx = {
      solanaTransaction: { updateMany: solanaUpdateMany },
      submission: { update: submissionUpdate },
    };
    const service = Object.create(SolanaService.prototype) as SolanaService;
    Object.assign(service, {
      prisma: {
        solanaTransaction: {
          findUnique: jest.fn().mockResolvedValue({
            status: 'reconciliation_required',
            signature: '2NEpo7TZRRrLZSi2U',
            nftAssetId: 'asset-1',
            merkleTree: '7EqQdEUwTCgDiseM8LxrfZgq8Y8pT8h1C3L2tK9X8t3s',
            leafIndex: 7n,
            walletAddress: 'recipient',
            credentialHash: 'hash-1',
            metadataDataHash: 'aabb',
          }),
        },
        $transaction: jest.fn(async (callback) => callback(tx)),
      },
      connection: {
        getTransaction: jest
          .fn()
          .mockResolvedValue({ slot: 123, meta: { err: null } }),
      },
      umi: {},
      merkleTreeAddress: '7EqQdEUwTCgDiseM8LxrfZgq8Y8pT8h1C3L2tK9X8t3s',
    });
    const bubblegum = jest.requireMock('@metaplex-foundation/mpl-bubblegum');
    bubblegum.findLeafAssetIdPda.mockReturnValue([
      { toString: () => 'asset-1' },
    ]);
    bubblegum.parseLeafFromMintV2Transaction.mockResolvedValue({
      id: { toString: () => 'asset-1' },
      owner: { toString: () => 'recipient' },
      nonce: 7n,
      dataHash: Buffer.from('aabb', 'hex'),
    });

    await expect(
      service.reconcileSubmissionCredential('submission-1'),
    ).resolves.toEqual({ signature: '2NEpo7TZRRrLZSi2U', assetId: 'asset-1' });
    const prisma = (service as any).prisma;
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(solanaUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          submissionId: 'submission-1',
          signature: '2NEpo7TZRRrLZSi2U',
          status: { in: ['submitted', 'reconciliation_required'] },
        }),
        data: expect.objectContaining({ status: 'confirmed', slot: 123n }),
      }),
    );
    expect(submissionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          transactionSignature: '2NEpo7TZRRrLZSi2U',
        }),
      }),
    );
  });

  it('keeps a confirmed on-chain signature recoverable when the DB commit fails', async () => {
    const bubblegum = jest.requireMock('@metaplex-foundation/mpl-bubblegum');
    const signedSignature = Uint8Array.from([1, 2, 3, 4]);
    const walletAddress = '7EqQdEUwTCgDiseM8LxrfZgq8Y8pT8h1C3L2tK9X8t3s';
    const builder = {
      setBlockhash: jest.fn(),
      buildAndSign: jest
        .fn()
        .mockResolvedValue({ signatures: [signedSignature] }),
      confirm: jest.fn().mockResolvedValue({ context: { slot: 123 } }),
    };
    bubblegum.hashMetadataDataV2.mockReturnValue(Uint8Array.from([0xaa, 0xbb]));
    bubblegum.mintV2.mockReturnValue(builder);
    bubblegum.findLeafAssetIdPda.mockReturnValue([
      { toString: () => 'asset-1' },
    ]);
    bubblegum.parseLeafFromMintV2Transaction.mockResolvedValue({
      id: { toString: () => 'asset-1' },
      owner: { toString: () => walletAddress },
      nonce: 7n,
      dataHash: Buffer.from('aabb', 'hex'),
    });
    const updateMany = jest
      .fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });
    const service = Object.create(SolanaService.prototype) as SolanaService;
    Object.assign(service, {
      logger: { log: jest.fn(), error: jest.fn() },
      credentialMetadataBaseUrl: 'https://proof.example/credentials/v1',
      authorityPublicKey: walletAddress,
      merkleTreeAddress: walletAddress,
      network: 'devnet',
      umi: {
        rpc: {
          getLatestBlockhash: jest
            .fn()
            .mockResolvedValue({
              blockhash: 'blockhash',
              lastValidBlockHeight: 99,
            }),
          sendTransaction: jest.fn().mockResolvedValue(signedSignature),
        },
      },
      prisma: {
        solanaTransaction: { updateMany },
        $transaction: jest
          .fn()
          .mockRejectedValue(new Error('db commit failed')),
      },
    });
    jest
      .spyOn(service as any, 'claimMintAttempt')
      .mockResolvedValue('attempt-1');

    await expect(
      service.mintSubmissionCredential('submission-1', walletAddress, {
        hackathonName: 'Hackathon',
        teamName: 'Team',
        projectName: 'Project',
        githubUrl: 'https://github.com/example/project',
        demoUrl: 'https://example.com',
        submittedAt: new Date('2030-01-01T00:00:00.000Z'),
        finalSnapshot: receipt,
      } as any),
    ).rejects.toThrow('db commit failed');

    expect(updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          submissionId: 'submission-1',
          mintAttemptId: 'attempt-1',
          signature: expect.any(String),
          status: { in: ['submitted', 'reconciliation_required'] },
        }),
        data: expect.objectContaining({ status: 'reconciliation_required' }),
      }),
    );
  });

  it('never aliases a transaction signature as a cNFT asset during reconciliation', async () => {
    const service = Object.create(SolanaService.prototype) as SolanaService;
    Object.assign(service, {
      prisma: {
        solanaTransaction: {
          findUnique: jest
            .fn()
            .mockResolvedValue({
              status: 'reconciliation_required',
              signature: 'signature-1',
              nftAssetId: null,
              merkleTree: null,
              leafIndex: null,
            }),
        },
        connection: {
          getTransaction: jest
            .fn()
            .mockResolvedValue({ slot: 1, meta: { err: null } }),
        },
      },
      connection: {
        getTransaction: jest
          .fn()
          .mockResolvedValue({ slot: 1, meta: { err: null } }),
      },
    });
    await expect(
      service.reconcileSubmissionCredential('submission-1'),
    ).rejects.toThrow();
  });

  it('does not let a stale reconciler confirm over a newer mint attempt', async () => {
    const bubblegum = jest.requireMock('@metaplex-foundation/mpl-bubblegum');
    bubblegum.findLeafAssetIdPda.mockReturnValue([
      { toString: () => 'asset-old' },
    ]);
    bubblegum.parseLeafFromMintV2Transaction.mockResolvedValue({
      id: { toString: () => 'asset-old' },
      owner: { toString: () => 'recipient' },
      nonce: 7n,
      dataHash: Buffer.from('aabb', 'hex'),
    });
    const submissionUpdate = jest.fn();
    const tx = {
      solanaTransaction: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      submission: { update: submissionUpdate },
    };
    const findUnique = jest
      .fn()
      .mockResolvedValueOnce({
        status: 'reconciliation_required',
        signature: '2NEpo7TZRRrLZSi2U',
        walletAddress: 'recipient',
        credentialHash: 'hash-old',
        metadataDataHash: 'aabb',
      })
      .mockResolvedValueOnce({
        status: 'minting',
        signature: null,
        nftAssetId: null,
      });
    const service = Object.create(SolanaService.prototype) as SolanaService;
    Object.assign(service, {
      umi: {},
      merkleTreeAddress: '7EqQdEUwTCgDiseM8LxrfZgq8Y8pT8h1C3L2tK9X8t3s',
      prisma: {
        solanaTransaction: { findUnique },
        $transaction: jest.fn(async (callback) => callback(tx)),
      },
      connection: {
        getTransaction: jest
          .fn()
          .mockResolvedValue({ slot: 123, meta: { err: null } }),
      },
    });

    await expect(
      service.reconcileSubmissionCredential('submission-1'),
    ).rejects.toThrow(
      'Transaction is not yet available from the configured RPC',
    );
    expect(tx.solanaTransaction.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          signature: '2NEpo7TZRRrLZSi2U',
          status: { in: ['submitted', 'reconciliation_required'] },
        }),
      }),
    );
    expect(submissionUpdate).not.toHaveBeenCalled();
  });

  it('claims only one concurrent retry and preserves a submitted transaction for reconciliation', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const service = Object.create(SolanaService.prototype) as SolanaService;
    Object.assign(service, {
      network: 'devnet',
      prisma: {
        solanaTransaction: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ status: 'failed', retryCount: 1 }),
          updateMany,
        },
      },
    });
    const input = {
      submissionId: 'submission-1',
      walletAddress: 'recipient',
      credentialHash: 'hash',
      metadataUri: 'https://proof.example/hash.json',
      metadataDataHash: 'data',
    };
    await (service as any).claimMintAttempt(input);
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ['pending', 'failed'] },
          retryCount: { lt: 3 },
        }),
        data: expect.objectContaining({ status: 'minting' }),
      }),
    );
    (service as any).prisma.solanaTransaction.findUnique.mockResolvedValueOnce({
      status: 'submitted',
      retryCount: 1,
    });
    await expect((service as any).claimMintAttempt(input)).rejects.toThrow(
      'existing mint attempt',
    );
  });

  it('atomically reclaims a pre-lease signing row after a process restart', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const service = Object.create(SolanaService.prototype) as SolanaService;
    Object.assign(service, {
      network: 'devnet',
      prisma: {
        solanaTransaction: {
          findUnique: jest
            .fn()
            .mockResolvedValue({
              status: 'minting',
              signature: null,
              retryCount: 1,
              mintLeaseExpiresAt: null,
            }),
          updateMany,
        },
      },
    });
    await (service as any).claimMintAttempt({
      submissionId: 'restart-row',
      walletAddress: 'recipient',
      credentialHash: 'hash',
      metadataUri: 'https://proof.example/hash.json',
      metadataDataHash: 'data',
    });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'minting',
          signature: null,
          OR: expect.any(Array),
        }),
        data: expect.objectContaining({
          status: 'minting',
          mintAttemptId: expect.any(String),
        }),
      }),
    );
  });

  it('clears a proven-failed signature so its replacement lease remains restart-recoverable', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const findUnique = jest
      .fn()
      .mockResolvedValueOnce({
        status: 'failed',
        signature: 'expired-signature',
        lastValidBlockHeight: 5n,
        retryCount: 1,
      })
      .mockResolvedValueOnce({
        status: 'minting',
        signature: null,
        retryCount: 2,
        mintLeaseExpiresAt: new Date(0),
      });
    const service = Object.create(SolanaService.prototype) as SolanaService;
    Object.assign(service, {
      network: 'devnet',
      prisma: { solanaTransaction: { findUnique, updateMany } },
    });
    const input = {
      submissionId: 'failed-then-restart',
      walletAddress: 'recipient',
      credentialHash: 'hash',
      metadataUri: 'https://proof.example/hash.json',
      metadataDataHash: 'data',
    };
    await (service as any).claimMintAttempt(input);
    expect(updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          signature: null,
          lastValidBlockHeight: null,
        }),
      }),
    );
    await (service as any).claimMintAttempt(input);
    expect(updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'minting', signature: null }),
      }),
    );
  });

  it('refuses reconciliation when the on-chain metadata data hash differs', async () => {
    const bubblegum = jest.requireMock('@metaplex-foundation/mpl-bubblegum');
    bubblegum.findLeafAssetIdPda.mockReturnValue([
      { toString: () => 'asset-1' },
    ]);
    bubblegum.parseLeafFromMintV2Transaction.mockResolvedValue({
      id: { toString: () => 'asset-1' },
      owner: { toString: () => 'recipient' },
      nonce: 7n,
      dataHash: Buffer.from('different', 'utf8'),
    });
    const service = Object.create(SolanaService.prototype) as SolanaService;
    Object.assign(service, {
      umi: {},
      merkleTreeAddress: '7EqQdEUwTCgDiseM8LxrfZgq8Y8pT8h1C3L2tK9X8t3s',
      prisma: {
        solanaTransaction: {
          findUnique: jest
            .fn()
            .mockResolvedValue({
              status: 'submitted',
              signature: '2NEpo7TZRRrLZSi2U',
              walletAddress: 'recipient',
              metadataDataHash: 'aabb',
            }),
        },
      },
      connection: {
        getTransaction: jest
          .fn()
          .mockResolvedValue({ slot: 1, meta: { err: null } }),
      },
    });
    await expect(
      service.reconcileSubmissionCredential('submission-1'),
    ).rejects.toThrow('unexpected Bubblegum credential identity');
  });

  it('keeps an expired signature in reconciliation when transaction history is null', async () => {
    const updateMany = jest.fn();
    const findUnique = jest.fn().mockResolvedValue({
      status: 'submitted',
      signature: '2NEpo7TZRRrLZSi2U',
      lastValidBlockHeight: 4n,
      retryCount: 1,
    });
    const service = Object.create(SolanaService.prototype) as SolanaService;
    Object.assign(service, {
      network: 'devnet',
      prisma: { solanaTransaction: { findUnique, updateMany } },
      connection: {
        getTransaction: jest.fn().mockResolvedValue(null),
        getBlockHeight: jest.fn().mockResolvedValue(5),
        getSignatureStatuses: jest.fn().mockResolvedValue({ value: [null] }),
      },
    });

    await expect(
      service.reconcileSubmissionCredential('submission-1'),
    ).rejects.toThrow(
      'Transaction is not yet available from the configured RPC',
    );
    expect(updateMany).not.toHaveBeenCalled();
    await expect(
      (service as any).claimMintAttempt({
        submissionId: 'submission-1',
        walletAddress: 'recipient',
        credentialHash: 'hash',
        metadataUri: 'https://proof.example/hash.json',
        metadataDataHash: 'data',
      }),
    ).rejects.toThrow('existing mint attempt');
  });

  it('keeps reconciliation pending when transaction lookup or history RPC fails', async () => {
    const updateMany = jest.fn();
    const record = {
      status: 'submitted',
      signature: '2NEpo7TZRRrLZSi2U',
      lastValidBlockHeight: 4n,
    };
    const service = Object.create(SolanaService.prototype) as SolanaService;
    Object.assign(service, {
      prisma: {
        solanaTransaction: {
          findUnique: jest.fn().mockResolvedValue(record),
          updateMany,
        },
      },
      connection: {
        getTransaction: jest
          .fn()
          .mockRejectedValue(new Error('rpc unavailable')),
        getBlockHeight: jest.fn(),
        getSignatureStatuses: jest.fn(),
      },
    });

    await expect(
      service.reconcileSubmissionCredential('submission-1'),
    ).rejects.toThrow(
      'Transaction is not yet available from the configured RPC',
    );
    expect(updateMany).not.toHaveBeenCalled();

    (service as any).connection.getTransaction.mockResolvedValueOnce(null);
    (service as any).connection.getBlockHeight.mockResolvedValueOnce(5);
    (service as any).connection.getSignatureStatuses.mockRejectedValueOnce(
      new Error('history unavailable'),
    );
    await expect(
      service.reconcileSubmissionCredential('submission-1'),
    ).rejects.toThrow(
      'Transaction is not yet available from the configured RPC',
    );
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('marks only a finalized on-chain error failed after expiry', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const service = Object.create(SolanaService.prototype) as SolanaService;
    Object.assign(service, {
      prisma: {
        solanaTransaction: {
          findUnique: jest.fn().mockResolvedValue({
            status: 'submitted',
            signature: '2NEpo7TZRRrLZSi2U',
            lastValidBlockHeight: 4n,
          }),
          updateMany,
        },
      },
      connection: {
        getTransaction: jest.fn().mockResolvedValue(null),
        getBlockHeight: jest.fn().mockResolvedValue(5),
        getSignatureStatuses: jest.fn().mockResolvedValue({
          value: [
            {
              err: { InstructionError: [0, 'Custom'] },
              confirmationStatus: 'finalized',
            },
          ],
        }),
      },
    });

    await expect(
      service.reconcileSubmissionCredential('submission-1'),
    ).resolves.toBeNull();
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          submissionId: 'submission-1',
          signature: '2NEpo7TZRRrLZSi2U',
          status: { in: ['submitted', 'reconciliation_required'] },
        },
        data: expect.objectContaining({ status: 'failed' }),
      }),
    );
  });

  it('returns a concurrent confirmed proof instead of overwriting it as failed', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 0 });
    const findUnique = jest
      .fn()
      .mockResolvedValueOnce({
        status: 'submitted',
        signature: '2NEpo7TZRRrLZSi2U',
        lastValidBlockHeight: 4n,
      })
      .mockResolvedValueOnce({
        status: 'confirmed',
        signature: '2NEpo7TZRRrLZSi2U',
        nftAssetId: 'asset-confirmed',
      });
    const service = Object.create(SolanaService.prototype) as SolanaService;
    Object.assign(service, {
      prisma: { solanaTransaction: { findUnique, updateMany } },
      connection: {
        getTransaction: jest.fn().mockResolvedValue(null),
        getBlockHeight: jest.fn().mockResolvedValue(5),
        getSignatureStatuses: jest.fn().mockResolvedValue({
          value: [
            {
              err: { InstructionError: [0, 'Custom'] },
              confirmationStatus: 'finalized',
            },
          ],
        }),
      },
    });

    await expect(
      service.reconcileSubmissionCredential('submission-1'),
    ).resolves.toEqual({
      signature: '2NEpo7TZRRrLZSi2U',
      assetId: 'asset-confirmed',
    });
    expect(updateMany).toHaveBeenCalledTimes(1);
  });

  it('does not reconcile a transaction whose Bubblegum leaf owner differs from the stored recipient', async () => {
    const bubblegum = jest.requireMock('@metaplex-foundation/mpl-bubblegum');
    bubblegum.findLeafAssetIdPda.mockReturnValue([
      { toString: () => 'asset-1' },
    ]);
    bubblegum.parseLeafFromMintV2Transaction.mockResolvedValue({
      id: { toString: () => 'asset-1' },
      owner: { toString: () => 'unexpected-owner' },
      nonce: 7n,
    });
    const service = Object.create(SolanaService.prototype) as SolanaService;
    Object.assign(service, {
      umi: {},
      merkleTreeAddress: '7EqQdEUwTCgDiseM8LxrfZgq8Y8pT8h1C3L2tK9X8t3s',
      prisma: {
        solanaTransaction: {
          findUnique: jest
            .fn()
            .mockResolvedValue({
              status: 'submitted',
              signature: '2NEpo7TZRRrLZSi2U',
              walletAddress: 'recipient',
            }),
        },
      },
      connection: {
        getTransaction: jest
          .fn()
          .mockResolvedValue({ slot: 1, meta: { err: null } }),
      },
    });
    await expect(
      service.reconcileSubmissionCredential('submission-1'),
    ).rejects.toThrow('unexpected Bubblegum credential identity');
  });

  it('serves a minimal URI-matched public projection from mint claim through confirmation', async () => {
    const hash = hashFinalSubmissionSnapshot(mintedReceipt);
    const service = Object.create(SolanaService.prototype) as SolanaService;
    const proof = {
      credentialHash: hash,
      status: 'minting',
      metadataUri: `https://proof.example/credentials/v1/${hash}.json`,
      submission: { finalSnapshot: mintedReceipt },
    };
    Object.assign(service, {
      credentialMetadataBaseUrl: 'https://proof.example/credentials/v1',
      prisma: { solanaTransaction: { findFirst: jest.fn() } },
    });
    for (const status of [
      'minting',
      'submitted',
      'reconciliation_required',
      'confirmed',
    ]) {
      (service as any).prisma.solanaTransaction.findFirst.mockResolvedValueOnce(
        { ...proof, status },
      );
      const metadata = await service.getCredentialMetadata(hash);
      expect(metadata).toEqual(
        expect.objectContaining({
          symbol: 'AHSUB',
          properties: expect.objectContaining({
            credentialHash: `sha256:${hash}`,
            receiptVersion: 2,
          }),
        }),
      );
      expect(JSON.stringify(metadata)).not.toContain('team');
      expect(JSON.stringify(metadata)).not.toContain('Project');
    }
  });

  it('does not serve absent, failed, pending, or tampered metadata', async () => {
    const service = Object.create(SolanaService.prototype) as SolanaService;
    Object.assign(service, {
      credentialMetadataBaseUrl: 'https://proof.example/credentials/v1',
      prisma: {
        solanaTransaction: { findFirst: jest.fn().mockResolvedValue(null) },
      },
    });
    const hash = hashFinalSubmissionSnapshot(mintedReceipt);
    const proof = {
      credentialHash: hash,
      status: 'minting',
      metadataUri: `https://proof.example/credentials/v1/${hash}.json`,
      submission: { finalSnapshot: mintedReceipt },
    };
    await expect(service.getCredentialMetadata(hash)).rejects.toThrow(
      NotFoundException,
    );
    await expect(service.getCredentialMetadata('not-a-hash')).rejects.toThrow(
      NotFoundException,
    );
    for (const status of ['pending', 'failed']) {
      (service as any).prisma.solanaTransaction.findFirst.mockResolvedValueOnce(
        { ...proof, status },
      );
      await expect(service.getCredentialMetadata(hash)).rejects.toThrow(
        NotFoundException,
      );
    }
    (service as any).prisma.solanaTransaction.findFirst.mockResolvedValueOnce({
      ...proof,
      credentialHash: '0'.repeat(64),
    });
    await expect(service.getCredentialMetadata(hash)).rejects.toThrow(
      NotFoundException,
    );
    (service as any).prisma.solanaTransaction.findFirst.mockResolvedValueOnce({
      ...proof,
      submission: {
        finalSnapshot: { ...mintedReceipt, projectName: 'Tampered' },
      },
    });
    await expect(service.getCredentialMetadata(hash)).rejects.toThrow(
      BadRequestException,
    );
    (service as any).prisma.solanaTransaction.findFirst.mockResolvedValueOnce({
      ...proof,
      metadataUri: 'https://proof.example/credentials/v1/other.json',
    });
    await expect(service.getCredentialMetadata(hash)).rejects.toThrow(
      NotFoundException,
    );
  });
  it('reports an old metadata host as unavailable without changing proof validity', async () => {
    const hash = hashFinalSubmissionSnapshot(mintedReceipt);
    const service = Object.create(SolanaService.prototype) as SolanaService;
    Object.assign(service, {
      credentialMetadataBaseUrl: 'https://new.example/credentials/v1',
      prisma: {
        solanaTransaction: {
          findFirst: jest
            .fn()
            .mockResolvedValue({
              credentialHash: hash,
              status: 'confirmed',
              metadataUri: `https://old.example/credentials/v1/${hash}.json`,
              submission: { finalSnapshot: mintedReceipt },
            }),
        },
      },
    });
    await expect(service.getCredentialMetadata(hash)).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'CREDENTIAL_METADATA_HOST_UNAVAILABLE',
      }),
    });
    (service as any).prisma.solanaTransaction.findFirst.mockResolvedValueOnce({
      credentialHash: hash,
      status: 'confirmed',
      metadataUri: `http://127.0.0.1/credentials/v1/${hash}.json`,
      submission: { finalSnapshot: mintedReceipt },
    });
    await expect(service.getCredentialMetadata(hash)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('verifies actual confirmed Bubblegum leaf identity and rejects tampered DB proof fields', async () => {
    const hash = hashFinalSubmissionSnapshot(mintedReceipt);
    const bubblegum = jest.requireMock('@metaplex-foundation/mpl-bubblegum');
    bubblegum.hashMetadataDataV2.mockReturnValue(Buffer.from('aabb', 'hex'));
    bubblegum.findLeafAssetIdPda.mockReturnValue([
      { toString: () => 'asset-onchain' },
    ]);
    bubblegum.parseLeafFromMintV2Transaction.mockResolvedValue({
      id: { toString: () => 'asset-onchain' },
      owner: { toString: () => 'recipient' },
      nonce: 9n,
      dataHash: Buffer.from('aabb', 'hex'),
    });
    const record = {
      status: 'confirmed',
      signature: 'tx',
      nftAssetId: 'asset-onchain',
      merkleTree: '7EqQdEUwTCgDiseM8LxrfZgq8Y8pT8h1C3L2tK9X8t3s',
      leafIndex: 9n,
      credentialHash: hash,
      metadataDataHash: 'aabb',
      metadataCreator: '7EqQdEUwTCgDiseM8LxrfZgq8Y8pT8h1C3L2tK9X8t3s',
      metadataUri: `https://proof.example/credentials/v1/${hash}.json`,
      assetOwner: 'recipient',
      walletAddress: 'recipient',
      network: 'devnet',
      submission: { finalSnapshot: mintedReceipt },
    };
    const service = Object.create(SolanaService.prototype) as SolanaService;
    Object.assign(service, {
      credentialMetadataBaseUrl: 'https://proof.example/credentials/v1',
      network: 'devnet',
      authorityPublicKey: '7EqQdEUwTCgDiseM8LxrfZgq8Y8pT8h1C3L2tK9X8t3s',
      merkleTreeAddress: record.merkleTree,
      umi: {},
      connection: {
        getTransaction: jest.fn().mockResolvedValue({ meta: { err: null } }),
      },
      prisma: {
        solanaTransaction: { findUnique: jest.fn().mockResolvedValue(record) },
      },
    });
    await expect(service.verifyCredential('submission')).resolves.toEqual(
      expect.objectContaining({ verified: true, assetId: 'asset-onchain' }),
    );
    for (const patch of [
      {
        submission: {
          finalSnapshot: {
            ...mintedReceipt,
            projectName: 'Changed after finalization',
          },
        },
      },
      { credentialHash: '0'.repeat(64) },
      { nftAssetId: 'asset-db-tampered' },
      { assetOwner: 'other' },
      { metadataUri: 'https://bad.example/metadata.json' },
      { metadataDataHash: 'ffff' },
      { status: 'failed' },
    ]) {
      (
        service as any
      ).prisma.solanaTransaction.findUnique.mockResolvedValueOnce({
        ...record,
        ...patch,
      });
      await expect(service.verifyCredential('submission')).resolves.toEqual(
        expect.objectContaining({ verified: false }),
      );
    }
    bubblegum.parseLeafFromMintV2Transaction.mockResolvedValueOnce({
      id: { toString: () => 'asset-onchain' },
      owner: { toString: () => 'recipient' },
      nonce: 9n,
      dataHash: Buffer.from('ffff', 'hex'),
    });
    (service as any).prisma.solanaTransaction.findUnique.mockResolvedValueOnce({
      ...record,
      metadataDataHash: 'ffff',
    });
    await expect(service.verifyCredential('submission')).resolves.toEqual(
      expect.objectContaining({ verified: false }),
    );
    Object.assign(service, {
      credentialMetadataBaseUrl: 'https://new.example/credentials/v1',
      merkleTreeAddress: 'new-tree',
      authorityPublicKey: 'new-authority',
    });
    await expect(service.verifyCredential('submission')).resolves.toEqual(
      expect.objectContaining({
        verified: true,
        tree: record.merkleTree,
        metadataUri: record.metadataUri,
      }),
    );
    expect(bubblegum.hashMetadataDataV2).toHaveBeenLastCalledWith(
      expect.objectContaining({
        uri: record.metadataUri,
        creators: [
          expect.objectContaining({ address: record.metadataCreator }),
        ],
      }),
    );
    Object.assign(service, { network: 'mainnet-beta' });
    const callsBeforeClusterMismatch = (service as any).connection
      .getTransaction.mock.calls.length;
    await expect(service.verifyCredential('submission')).resolves.toEqual({
      verified: null,
      status: 'unavailable',
      reason: 'rpc_cluster_mismatch',
      proofCluster: 'devnet',
      configuredCluster: 'mainnet-beta',
    });
    expect((service as any).connection.getTransaction).toHaveBeenCalledTimes(
      callsBeforeClusterMismatch,
    );
    Object.assign(service, { network: 'devnet' });
    (service as any).connection.getTransaction.mockResolvedValueOnce(null);
    await expect(service.verifyCredential('submission')).resolves.toEqual({
      verified: null,
      status: 'unavailable',
      reason: 'transaction_unavailable',
      proofCluster: 'devnet',
    });
  });
});
