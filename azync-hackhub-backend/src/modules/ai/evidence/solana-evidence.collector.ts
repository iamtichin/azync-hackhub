import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Connection, PublicKey } from '@solana/web3.js';
import type { EvidenceDraft, SubmissionEvidenceInput } from './evidence.types';
import { sha256, unavailableEvidence } from './evidence.utils';

const BUBBLEGUM_PROGRAM_ID = 'BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY';
const GENESIS_HASHES: Record<string, string> = {
  devnet: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',
  'mainnet-beta': '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
};

function publicKeyStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((key): key is PublicKey => key instanceof PublicKey)
    .map((key) => key.toString());
}

function programIdIndexes(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((instruction) => {
    if (!instruction || typeof instruction !== 'object') return [];
    const index = (instruction as Record<string, unknown>).programIdIndex;
    return typeof index === 'number' && Number.isInteger(index) ? [index] : [];
  });
}

@Injectable()
export class SolanaEvidenceCollector {
  constructor(private readonly config: ConfigService) {}

  /**
   * A small, bounded freshness signal used for analysis idempotency.  The
   * platform credential can progress from confirmed to finalized without a
   * GitHub commit, so its finality must participate in a refresh fingerprint.
   */
  async resolveFinalityRevision(signature: string | null): Promise<string | null> {
    if (!signature || !/^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(signature)) {
      return null;
    }
    const network = this.config.get<string>('SOLANA_NETWORK') || 'devnet';
    const rpcUrl = this.config.get<string>('SOLANA_RPC_URL');
    if (!rpcUrl || !GENESIS_HASHES[network]) return null;
    try {
      const connection = new Connection(rpcUrl, 'finalized');
      const [genesisHash, statuses] = await Promise.all([
        connection.getGenesisHash(),
        connection.getSignatureStatuses([signature], {
          searchTransactionHistory: true,
        }),
      ]);
      if (genesisHash !== GENESIS_HASHES[network]) return null;
      const status = statuses.value[0];
      return `${network}:${signature}:${status?.confirmationStatus ?? 'NOT_FOUND'}:${status?.err ? 'FAILED' : 'OK'}`;
    } catch {
      return null;
    }
  }

  async collect(submission: SubmissionEvidenceInput): Promise<EvidenceDraft[]> {
    const signature = submission.transactionSignature;
    if (!signature || !/^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(signature)) {
      return [
        unavailableEvidence(
          'SOLANA_TRANSACTION',
          'solana_rpc',
          signature ?? 'missing',
          'INVALID_REFERENCE',
        ),
        ...this.projectClaim(submission),
      ];
    }

    const network = this.config.get<string>('SOLANA_NETWORK') || 'devnet';
    const rpcUrl = this.config.get<string>('SOLANA_RPC_URL');
    if (!rpcUrl || !GENESIS_HASHES[network]) {
      return [
        unavailableEvidence(
          'SOLANA_TRANSACTION',
          'solana_rpc',
          signature,
          'SOURCE_UNAVAILABLE',
        ),
        ...this.projectClaim(submission),
      ];
    }

    try {
      const connection = new Connection(rpcUrl, 'finalized');
      const [genesisHash, statuses, transaction] = await Promise.all([
        connection.getGenesisHash(),
        connection.getSignatureStatuses([signature], {
          searchTransactionHistory: true,
        }),
        connection.getTransaction(signature, {
          commitment: 'finalized',
          maxSupportedTransactionVersion: 0,
        }),
      ]);
      const status = statuses.value[0];
      if (genesisHash !== GENESIS_HASHES[network]) {
        return [
          unavailableEvidence(
            'SOLANA_TRANSACTION',
            'solana_rpc',
            signature,
            'CLUSTER_MISMATCH',
          ),
          ...this.projectClaim(submission),
        ];
      }
      if (!status || !transaction) {
        return [
          unavailableEvidence(
            'SOLANA_TRANSACTION',
            'solana_rpc',
            signature,
            'NOT_FOUND',
          ),
          ...this.projectClaim(submission),
        ];
      }

      const message: unknown = transaction.transaction.message;
      const messageRecord = message as Record<string, unknown>;
      const loadedAddresses = transaction.meta?.loadedAddresses;
      const accountKeys = [
        ...publicKeyStrings(
          messageRecord.staticAccountKeys ?? messageRecord.accountKeys,
        ),
        ...publicKeyStrings(loadedAddresses?.writable),
        ...publicKeyStrings(loadedAddresses?.readonly),
      ];
      const programIds = new Set<string>();
      for (const programIdIndex of programIdIndexes(
        messageRecord.compiledInstructions ?? messageRecord.instructions,
      )) {
        const key = accountKeys[programIdIndex];
        if (key) programIds.add(key);
      }

      const expectedTree =
        this.config.get<string>('SOLANA_MERKLE_TREE_ADDRESS') ?? '';
      const expectedAuthority =
        this.config.get<string>('SOLANA_AUTHORITY_PUBLIC_KEY') ?? '';
      const finalized = status.confirmationStatus === 'finalized';
      const succeeded =
        finalized && status.err === null && transaction.meta?.err === null;
      const facts = {
        cluster: network,
        genesisHash,
        signature,
        confirmationStatus: status.confirmationStatus ?? null,
        finalized,
        succeeded,
        slot: transaction.slot,
        blockTime: transaction.blockTime ?? null,
        feeLamports: transaction.meta?.fee ?? null,
        feePayer: accountKeys[0] ?? null,
        accountKeys,
        programIds: [...programIds],
        expectedBubblegumProgramPresent: programIds.has(BUBBLEGUM_PROGRAM_ID),
        expectedMerkleTreePresent: expectedTree
          ? accountKeys.includes(expectedTree)
          : false,
        expectedAuthorityPresent: expectedAuthority
          ? accountKeys.includes(expectedAuthority)
          : null,
        expectedRecipientPresent: accountKeys.includes(
          submission.walletAddress,
        ),
        evidenceRole: 'PLATFORM_CREDENTIAL',
        supportsProjectIntegration: false,
      };
      const transactionEvidence: EvidenceDraft = {
        type: 'SOLANA_TRANSACTION',
        source: 'solana_rpc',
        status: succeeded ? 'VERIFIED' : 'UNVERIFIED',
        reference: signature,
        sourceRevision: `${genesisHash}:${signature}:finalized`,
        locator: { network, signature, slot: transaction.slot },
        facts,
        contentHash: sha256(JSON.stringify(facts)),
        errorCode: succeeded
          ? null
          : status.err !== null || transaction.meta?.err !== null
            ? 'TRANSACTION_FAILED'
            : 'SOURCE_UNAVAILABLE',
        expiresAt: null,
      };

      const assetEvidence = unavailableEvidence(
        'SOLANA_ACCOUNT',
        'solana_rpc',
        submission.nftAssetId ?? signature,
        'ASSET_ID_NOT_DERIVED',
      );
      // This transaction is the credential minted by Azync, not proof that a
      // participant's project integrates Solana. Keep the roles explicit so a
      // model and a human cannot accidentally substitute one for the other.
      assetEvidence.facts = {
        evidenceRole: 'PLATFORM_CREDENTIAL_ASSET',
        supportsProjectIntegration: false,
      };
      return [transactionEvidence, assetEvidence, ...this.projectClaim(submission)];
    } catch {
      return [
        unavailableEvidence(
          'SOLANA_TRANSACTION',
          'solana_rpc',
          signature,
          'SOURCE_UNAVAILABLE',
        ),
        ...this.projectClaim(submission),
      ];
    }
  }

  private projectClaim(submission: SubmissionEvidenceInput): EvidenceDraft[] {
    if (!submission.participantBlockchainEvidenceUrl) return [];
    return [
      {
        ...unavailableEvidence(
          'SOLANA_ACCOUNT',
          'solana_rpc',
          submission.participantBlockchainEvidenceUrl,
          'PROJECT_EVIDENCE_UNVERIFIED',
        ),
        status: 'UNVERIFIED',
        locator: { participantProvided: true },
        facts: {
          evidenceRole: 'PARTICIPANT_PROJECT_CLAIM',
          supportsProjectIntegration: false,
          verificationNote:
            'Participant-provided URL is a claim until a project-specific verifier is configured.',
        },
      },
    ];
  }
}
