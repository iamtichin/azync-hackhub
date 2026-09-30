/* Jest's ESM module mock and bs58 are not resolved by the lint type project. */
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import { jest } from '@jest/globals';
import bs58 from 'bs58';
import type * as Bubblegum from '@metaplex-foundation/mpl-bubblegum';
import { PrismaService } from '../../src/modules/prisma/prisma.service';
import type { SolanaService as SolanaServiceType } from '../../src/modules/solana/solana.service';
import { e2eFixtureId } from '../support/e2e-environment';

const bubblegum = jest.requireActual<typeof Bubblegum>(
  '@metaplex-foundation/mpl-bubblegum',
);
const signedSignature = Uint8Array.from(
  { length: 64 },
  (_, index) => index + 1,
);
const signature = bs58.encode(signedSignature);
const walletAddress = '7EqQdEUwTCgDiseM8LxrfZgq8Y8pT8h1C3L2tK9X8t3s';
const tree = '11111111111111111111111111111111';
const creator = '4zvwRjXUKGfvwnParsHAS3HuSVzV5cA4McphgmoCtajS';
const assetId = '9xQeWvG816bUx9EPfYbZWGdY7FQZq8pJPbY1hp4A7Kp';
const leafIndex = 7n;
let mintedDataHash: Uint8Array<ArrayBufferLike> = new Uint8Array();

const builder = {
  setBlockhash: jest.fn(),
  buildAndSign: jest.fn(() =>
    Promise.resolve({ signatures: [signedSignature] }),
  ),
  confirm: jest.fn(() => Promise.resolve({ context: { slot: 123n } })),
};
const mintV2 = jest.fn(
  (
    _: unknown,
    input: { metadata: Parameters<typeof bubblegum.hashMetadataDataV2>[0] },
  ) => {
    mintedDataHash = bubblegum.hashMetadataDataV2(input.metadata);
    return builder;
  },
);
const parseLeaf = jest.fn(() =>
  Promise.resolve({
    id: { toString: () => assetId },
    owner: { toString: () => walletAddress },
    nonce: leafIndex,
    dataHash: mintedDataHash,
  }),
);
const findAsset = jest.fn(() => [{ toString: () => assetId }]);

jest.unstable_mockModule('@metaplex-foundation/mpl-bubblegum', () => ({
  ...bubblegum,
  mintV2,
  parseLeafFromMintV2Transaction: parseLeaf,
  findLeafAssetIdPda: findAsset,
}));

const { SolanaService, hashFinalSubmissionSnapshot } =
  await import('../../src/modules/solana/solana.service');

describe('credential migration and mint persistence (isolated E2E)', () => {
  let prisma: PrismaService;
  const hackathonId = e2eFixtureId('hack-credential');
  const teamId = e2eFixtureId('team-credential');
  const submissionId = e2eFixtureId('submission-credential');

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await prisma.hackathon.create({
      data: {
        id: hackathonId,
        name: 'Credential E2E',
        startDate: new Date('2026-09-01'),
        endDate: new Date('2026-09-30'),
      },
    });
    await prisma.team.create({
      data: { id: teamId, name: 'Credential Team', hackathonId },
    });
  });

  afterAll(async () => {
    if (!prisma) return;
    try {
      await prisma.solanaTransaction.deleteMany({ where: { submissionId } });
      await prisma.submission.deleteMany({ where: { id: submissionId } });
      await prisma.team.deleteMany({ where: { id: teamId } });
      await prisma.hackathon.deleteMany({ where: { id: hackathonId } });
    } finally {
      await prisma.$disconnect();
    }
  });

  it('migrates metadataCreator and reads the receipt, tree, leaf, asset, signature and hashes after mint', async () => {
    const columns = await prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'SolanaTransaction'
        AND column_name = 'metadataCreator'
    `;
    expect(columns).toEqual([{ column_name: 'metadataCreator' }]);

    const snapshot = {
      schemaVersion: 1,
      receiptVersion: 2,
      teamId,
      hackathonId,
      acceptedAt: '2026-09-23T15:00:00.000Z',
      projectName: 'Credential E2E',
    };
    await prisma.submission.create({
      data: {
        id: submissionId,
        teamId,
        hackathonId,
        projectName: 'Credential E2E',
        description: 'Isolated mint persistence fixture',
        githubUrl: 'https://github.com/example/credential-e2e',
        demoUrl: 'https://example.com/credential-e2e',
        walletAddress,
        finalSnapshot: snapshot,
        receiptVersion: 2,
      },
    });

    const service = Object.create(SolanaService.prototype) as SolanaServiceType;
    Object.assign(service, {
      prisma,
      logger: { log: jest.fn(), error: jest.fn() },
      authorityPublicKey: creator,
      merkleTreeAddress: tree,
      credentialMetadataBaseUrl: 'https://proof.example/solana/credentials/v1',
      network: 'devnet',
      umi: {
        rpc: {
          getLatestBlockhash: jest.fn(() =>
            Promise.resolve({
              blockhash: 'fixture-blockhash',
              lastValidBlockHeight: 999,
            }),
          ),
          sendTransaction: jest.fn(() => Promise.resolve(signedSignature)),
        },
      },
      connection: {
        getTransaction: jest.fn(() => Promise.resolve({ meta: { err: null } })),
      },
    });

    const result = await service.mintSubmissionCredential(
      submissionId,
      walletAddress,
      {
        hackathonName: 'Credential E2E',
        teamName: 'Credential Team',
        projectName: 'Credential E2E',
        githubUrl: 'https://github.com/example/credential-e2e',
        demoUrl: 'https://example.com/credential-e2e',
        submittedAt: new Date(snapshot.acceptedAt),
        finalSnapshot: snapshot,
      },
    );

    const stored = await prisma.submission.findUnique({
      where: { id: submissionId },
      include: { solanaTransaction: true },
    });
    const proof = stored?.solanaTransaction;
    const expectedHash = hashFinalSubmissionSnapshot(snapshot);
    const expectedUri = `https://proof.example/solana/credentials/v1/${expectedHash}.json`;
    expect(result).toEqual({
      signature,
      assetId,
      leafIndex,
      credentialHash: expectedHash,
    });
    expect(stored?.finalSnapshot).toEqual(snapshot);
    expect(stored).toMatchObject({
      receiptVersion: 2,
      transactionSignature: signature,
      nftAssetId: assetId,
      metadataHash: expectedHash,
      mintStatus: 'CONFIRMED',
      status: 'confirmed',
    });
    expect(proof).toMatchObject({
      signature,
      nftAssetId: assetId,
      merkleTree: tree,
      leafIndex,
      credentialHash: expectedHash,
      metadataUri: expectedUri,
      metadataDataHash: Buffer.from(mintedDataHash).toString('hex'),
      metadataCreator: creator,
      assetOwner: walletAddress,
      walletAddress,
      network: 'devnet',
      status: 'confirmed',
      slot: 123n,
    });
    expect(proof?.metadataCreator).toBe(creator);
    expect(proof?.metadataDataHash).toMatch(/^[0-9a-f]{64}$/);
    expect(proof?.confirmedAt).toBeInstanceOf(Date);
    expect(mintV2).toHaveBeenCalledTimes(1);
    expect(parseLeaf).toHaveBeenCalledTimes(1);
    expect(findAsset).toHaveBeenCalledWith(expect.anything(), {
      merkleTree: tree,
      leafIndex,
    });

    await expect(
      service.getCredentialMetadata(expectedHash),
    ).resolves.toMatchObject({
      properties: {
        credentialHash: `sha256:${expectedHash}`,
        receiptVersion: 2,
      },
    });
    await expect(service.verifyCredential(submissionId)).resolves.toMatchObject(
      {
        verified: true,
        signature,
        assetId,
        tree,
        leafIndex: '7',
        credentialHash: expectedHash,
        receiptVersion: 2,
        metadataUri: expectedUri,
      },
    );
  });
});
