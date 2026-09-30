import { ConfigService } from '@nestjs/config';
import { Connection, PublicKey } from '@solana/web3.js';
import { SolanaEvidenceCollector } from './solana-evidence.collector';
import { sha256 } from './evidence.utils';

describe('SolanaEvidenceCollector', () => {
  afterEach(() => jest.restoreAllMocks());

  it('accepts the full Solana devnet genesis hash', async () => {
    const signature =
      '44kQ78Nx3TTLh1i7vfnZvdudBWpHhYukYahZMSHv55cSAg9rpc1UUNZ95B2jZW9ryF5ynxq7LF9Cr3qcSmnXrt8T';
    const walletAddress = '11111111111111111111111111111111';
    const accountKey = new PublicKey(walletAddress);

    jest
      .spyOn(Connection.prototype, 'getGenesisHash')
      .mockResolvedValue('EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG');
    jest.spyOn(Connection.prototype, 'getSignatureStatuses').mockResolvedValue({
      context: { slot: 1 },
      value: [
        {
          slot: 1,
          confirmations: null,
          err: null,
          confirmationStatus: 'finalized',
        },
      ],
    });
    jest.spyOn(Connection.prototype, 'getTransaction').mockResolvedValue({
      slot: 1,
      blockTime: 1,
      meta: {
        err: null,
        fee: 5000,
        preBalances: [],
        postBalances: [],
        preTokenBalances: null,
        postTokenBalances: null,
        logMessages: null,
        innerInstructions: null,
        loadedAddresses: { writable: [], readonly: [] },
        rewards: null,
        computeUnitsConsumed: 1,
      },
      transaction: {
        signatures: [signature],
        message: {
          staticAccountKeys: [accountKey],
          compiledInstructions: [],
        },
      },
      version: 0,
    } as never);

    const config = {
      get: jest.fn((key: string) => {
        if (key === 'SOLANA_NETWORK') return 'devnet';
        if (key === 'SOLANA_RPC_URL') return 'https://api.devnet.solana.com';
        return undefined;
      }),
    } as unknown as ConfigService;

    const evidence = await new SolanaEvidenceCollector(config).collect({
      id: 'submission-1',
      githubUrl: 'https://github.com/example/repository',
      demoUrl: 'https://example.com',
      walletAddress,
      transactionSignature: signature,
      nftAssetId: null,
      participantBlockchainEvidenceUrl: 'https://explorer.solana.com/tx/project-proof',
    });

    expect(evidence[0]).toMatchObject({
      type: 'SOLANA_TRANSACTION',
      status: 'VERIFIED',
      errorCode: null,
      facts: expect.objectContaining({
        evidenceRole: 'PLATFORM_CREDENTIAL',
        supportsProjectIntegration: false,
      }),
    });
    // Hash the exact persisted facts, including role fields added for the
    // evaluation prompt; otherwise evidence integrity checks reject it.
    expect(evidence[0].contentHash).toBe(
      sha256(JSON.stringify(evidence[0].facts)),
    );
    expect(evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({
        reference: 'https://explorer.solana.com/tx/project-proof',
        status: 'UNVERIFIED',
        errorCode: 'PROJECT_EVIDENCE_UNVERIFIED',
      }),
    ]));
  });
});
