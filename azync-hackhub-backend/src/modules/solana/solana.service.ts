import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Connection, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import {
  keypairIdentity,
  publicKey as umiPublicKey,
} from '@metaplex-foundation/umi';
import {
  findLeafAssetIdPda,
  hashMetadataDataV2,
  mintV2,
  mplBubblegum,
  parseLeafFromMintV2Transaction,
} from '@metaplex-foundation/mpl-bubblegum';
import bs58 from 'bs58';
import { PrismaService } from '../prisma/prisma.service';
import * as crypto from 'crypto';
import { isIP } from 'net';
import { isBlockedIp } from '../ai/evidence/safe-url.policy';
import type { SubmissionMetadata } from './types/nft-metadata.types';

export const BUBBLEGUM_METADATA_LIMITS = {
  name: 32,
  symbol: 10,
  uri: 200,
} as const;
const CREDENTIAL_NAME = 'Azync HackHub Credential';
const CREDENTIAL_SYMBOL = 'AHSUB';
const WINNER_CREDENTIAL_NAME = 'Azync HackHub Winner';
const WINNER_CREDENTIAL_SYMBOL = 'AHWIN';

const MAX_MINT_ATTEMPTS = 3;
const MINT_CLAIM_LEASE_MS = 2 * 60 * 1000;

export function truncateUtf8(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) return value;
  const suffix = '...';
  const target = Math.max(0, maxBytes - Buffer.byteLength(suffix, 'utf8'));
  let result = '';
  for (const character of value) {
    if (Buffer.byteLength(result + character, 'utf8') > target) break;
    result += character;
  }
  return result + suffix;
}

export function validateBubblegumMetadata(metadata: {
  name: string;
  symbol: string;
  uri: string;
}): void {
  const errors = Object.entries(BUBBLEGUM_METADATA_LIMITS)
    .filter(
      ([field, limit]) =>
        Buffer.byteLength(metadata[field as keyof typeof metadata], 'utf8') >
        limit,
    )
    .map(([field, limit]) => `${field} exceeds ${limit} UTF-8 bytes`);
  if (errors.length) {
    throw new BadRequestException({
      code: 'INVALID_NFT_METADATA',
      message: 'NFT metadata validation failed',
      errors,
    });
  }
}

/** Stable JSON encoding: the receipt hash never depends on JavaScript key order. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      throw new BadRequestException(
        'Final submission contains a non-finite number',
      );
    return JSON.stringify(value);
  }
  if (Array.isArray(value))
    return `[${value.map((item) => (item === undefined ? 'null' : canonicalJson(item))).join(',')}]`;
  if (
    !value ||
    typeof value !== 'object' ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new BadRequestException('Final submission must contain JSON values');
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`;
}

export function hashFinalSubmissionSnapshot(
  snapshot: Record<string, unknown>,
): string {
  if (
    snapshot.schemaVersion !== 1 ||
    ![1, 2].includes(snapshot.receiptVersion as number)
  ) {
    throw new BadRequestException(
      'Unsupported final submission receipt version',
    );
  }
  // V1 is retained byte-for-byte for receipts minted before the V2 JSON fix.
  const legacyJson = (value: unknown): string => {
    if (value === null || typeof value !== 'object')
      return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(legacyJson).join(',')}]`;
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${legacyJson(record[key])}`)
      .join(',')}}`;
  };
  const encoded =
    snapshot.receiptVersion === 1
      ? legacyJson(snapshot)
      : canonicalJson(snapshot);
  return crypto.createHash('sha256').update(encoded, 'utf8').digest('hex');
}

export function hashWinnerDecisionSnapshot(
  snapshot: Record<string, unknown>,
): string {
  if (snapshot.schemaVersion !== 1 || snapshot.awardVersion !== 1) {
    throw new BadRequestException('Unsupported winner award version');
  }
  return crypto
    .createHash('sha256')
    .update(canonicalJson(snapshot), 'utf8')
    .digest('hex');
}

export function assertPublicCredentialMetadataBaseUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new BadRequestException(
      'CREDENTIAL_METADATA_BASE_URL must be a public HTTPS URL before minting',
    );
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    host === 'localhost' ||
    host.endsWith('.local') ||
    (isIP(host) !== 0 && isBlockedIp(host))
  ) {
    throw new BadRequestException(
      'CREDENTIAL_METADATA_BASE_URL must be a public HTTPS URL before minting',
    );
  }
}

function isValidCredentialMetadataUri(
  uri: string | null,
  hash: string,
): uri is string {
  if (!uri || !/^[0-9a-f]{64}$/.test(hash)) return false;
  try {
    assertPublicCredentialMetadataBaseUrl(uri);
    return (
      new URL(uri).pathname.endsWith(`/${hash}.json`) &&
      Buffer.byteLength(uri, 'utf8') <= BUBBLEGUM_METADATA_LIMITS.uri
    );
  } catch {
    return false;
  }
}

@Injectable()
export class SolanaService {
  private readonly logger = new Logger(SolanaService.name);
  private umi: ReturnType<typeof createUmi>;
  private authorityPublicKey: string;
  private merkleTreeAddress: string;
  private readonly connection: Connection;
  private readonly network: string;
  private readonly credentialMetadataBaseUrl: string;
  private readonly winnerCredentialMetadataBaseUrl: string;

  constructor(private readonly prisma: PrismaService) {
    const rpcUrl =
      process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
    this.network = process.env.SOLANA_NETWORK || 'devnet';
    this.credentialMetadataBaseUrl = (
      process.env.CREDENTIAL_METADATA_BASE_URL ||
      'http://localhost:3001/solana/credentials/v1'
    ).replace(/\/$/, '');
    this.winnerCredentialMetadataBaseUrl = (
      process.env.WINNER_CREDENTIAL_METADATA_BASE_URL ||
      this.credentialMetadataBaseUrl.replace(
        /\/credentials\/v1$/,
        '/winner-credentials/v1',
      )
    ).replace(/\/$/, '');
    this.connection = new Connection(rpcUrl, 'confirmed');

    // Initialize Umi with Bubblegum plugin
    this.umi = createUmi(rpcUrl).use(mplBubblegum());

    // Load authority keypair from .env
    const secretKeyArray = JSON.parse(
      process.env.SOLANA_AUTHORITY_SECRET_KEY || '[]',
    );
    if (secretKeyArray.length !== 64) {
      throw new Error('SOLANA_AUTHORITY_SECRET_KEY not set or invalid in .env');
    }

    const secretKey = Uint8Array.from(secretKeyArray);
    const keypair = this.umi.eddsa.createKeypairFromSecretKey(secretKey);
    this.umi.use(keypairIdentity(keypair));

    this.authorityPublicKey = keypair.publicKey.toString();

    // Load Merkle tree address
    const treeAddress = process.env.SOLANA_MERKLE_TREE_ADDRESS;
    if (!treeAddress) {
      throw new Error('SOLANA_MERKLE_TREE_ADDRESS not set in .env');
    }
    this.merkleTreeAddress = treeAddress;

    this.logger.log(
      `Solana initialized (${process.env.SOLANA_NETWORK || 'devnet'})`,
    );
    this.logger.log(`Authority: ${this.authorityPublicKey}`);
    this.logger.log(`Merkle Tree: ${this.merkleTreeAddress}`);
  }

  async mintSubmissionCredential(
    submissionId: string,
    walletAddress: string,
    metadata: SubmissionMetadata,
  ): Promise<{
    signature: string;
    assetId: string;
    leafIndex: bigint;
    credentialHash: string;
  }> {
    // A localhost/default URI would be permanently committed to the cNFT.
    // Fail before the pending DB row or on-chain send if deployment is not ready.
    assertPublicCredentialMetadataBaseUrl(this.credentialMetadataBaseUrl);
    const metadataHash = hashFinalSubmissionSnapshot(metadata.finalSnapshot);
    const nftMetadata = this.buildNFTMetadata(metadata, metadataHash);
    validateBubblegumMetadata({
      name: nftMetadata.name,
      symbol: nftMetadata.symbol,
      uri: nftMetadata.uri,
    });

    const bubblegumMetadata = this.buildBubblegumMetadata(nftMetadata);
    const metadataDataHash = Buffer.from(
      hashMetadataDataV2(bubblegumMetadata),
    ).toString('hex');
    const mintAttemptId = await this.claimMintAttempt({
      submissionId,
      walletAddress,
      credentialHash: metadataHash,
      metadataUri: nftMetadata.uri,
      metadataDataHash,
      metadataCreator: this.authorityPublicKey,
    });
    let observedSignature: string | null = null;

    try {
      this.logger.log(
        `Minting NFT for submission ${submissionId} to ${walletAddress}`,
      );

      // Mint compressed NFT using Bubblegum V2
      const builder = mintV2(this.umi, {
        leafOwner: umiPublicKey(walletAddress),
        merkleTree: umiPublicKey(this.merkleTreeAddress),
        metadata: bubblegumMetadata,
      });

      // Sign first so its deterministic transaction identifier is persisted
      // before any network I/O. If send/confirm times out, a restart can query
      // this exact signature instead of minting a second credential.
      const latestBlockhash = await this.umi.rpc.getLatestBlockhash({
        commitment: 'confirmed',
      });
      builder.setBlockhash(latestBlockhash);
      const signedTransaction = await builder.buildAndSign(this.umi);
      const signature = bs58.encode(signedTransaction.signatures[0]);
      const persistedSignature = await this.prisma.solanaTransaction.updateMany(
        {
          where: { submissionId, mintAttemptId },
          data: {
            signature,
            status: 'submitted',
            lastValidBlockHeight: BigInt(latestBlockhash.lastValidBlockHeight),
            errorMessage: null,
          },
        },
      );
      if (persistedSignature.count !== 1) {
        throw new ServiceUnavailableException(
          'Mint claim expired before its signed transaction could be persisted',
        );
      }
      observedSignature = signature;
      const sentSignature = await this.umi.rpc.sendTransaction(
        signedTransaction,
        { skipPreflight: false },
      );
      if (bs58.encode(sentSignature) !== signature) {
        throw new ServiceUnavailableException(
          'RPC returned a signature different from the signed mint transaction',
        );
      }
      const confirmation = await builder.confirm(this.umi, sentSignature, {
        commitment: 'confirmed',
      });

      // Bubblegum V2 emits the leaf in the confirmed transaction. Its nonce is
      // the leaf index; derive the cNFT PDA rather than ever aliasing a tx id.
      const leaf = await parseLeafFromMintV2Transaction(
        this.umi,
        sentSignature,
      );
      const leafIndex = BigInt(leaf.nonce);
      const [assetId] = findLeafAssetIdPda(this.umi, {
        merkleTree: umiPublicKey(this.merkleTreeAddress),
        leafIndex,
      });
      if (assetId.toString() !== leaf.id.toString()) {
        throw new ServiceUnavailableException(
          'Bubblegum leaf asset identity did not match its tree/index derivation',
        );
      }
      if (
        leaf.owner.toString() !== walletAddress ||
        Buffer.from(leaf.dataHash).toString('hex') !== metadataDataHash
      ) {
        throw new ServiceUnavailableException(
          'Confirmed Bubblegum leaf owner or metadata data hash did not match the mint request',
        );
      }

      const slot = confirmation.context.slot;
      const committed = await this.prisma.$transaction(async (tx) => {
        const transition = await tx.solanaTransaction.updateMany({
          where: {
            submissionId,
            mintAttemptId,
            signature,
            status: { in: ['submitted', 'reconciliation_required'] },
          },
          data: {
            signature,
            nftAssetId: assetId.toString(),
            merkleTree: this.merkleTreeAddress,
            leafIndex,
            credentialHash: metadataHash,
            metadataUri: nftMetadata.uri,
            metadataDataHash,
            metadataCreator: this.authorityPublicKey,
            assetOwner: walletAddress,
            status: 'confirmed',
            confirmations: 1,
            slot,
            errorMessage: null,
            confirmedAt: new Date(),
            mintLeaseExpiresAt: null,
          },
        });
        if (transition.count !== 1) return false;
        await tx.submission.update({
          where: { id: submissionId },
          data: {
            transactionSignature: signature,
            nftAssetId: assetId.toString(),
            metadataHash,
            status: 'confirmed',
            mintStatus: 'CONFIRMED',
          },
        });
        return true;
      });

      if (!committed) {
        const current = await this.prisma.solanaTransaction.findUnique({
          where: { submissionId },
          select: {
            status: true,
            signature: true,
            nftAssetId: true,
            leafIndex: true,
            credentialHash: true,
          },
        });
        if (
          current?.status === 'confirmed' &&
          current.signature &&
          current.nftAssetId &&
          current.leafIndex != null &&
          current.credentialHash
        ) {
          return {
            signature: current.signature,
            assetId: current.nftAssetId,
            leafIndex: current.leafIndex,
            credentialHash: current.credentialHash,
          };
        }
        throw this.reconciliationPending();
      }

      this.logger.log(`✅ NFT minted successfully: ${signature}`);
      return {
        signature,
        assetId: assetId.toString(),
        leafIndex,
        credentialHash: metadataHash,
      };
    } catch (error) {
      this.logger.error(`❌ Mint failed: ${error.message}`, error.stack);

      await this.prisma.solanaTransaction.updateMany({
        where: observedSignature
          ? {
              submissionId,
              mintAttemptId,
              signature: observedSignature,
              status: { in: ['submitted', 'reconciliation_required'] },
            }
          : { submissionId, mintAttemptId, signature: null, status: 'minting' },
        data: {
          ...(observedSignature ? { signature: observedSignature } : {}),
          status: observedSignature ? 'reconciliation_required' : 'failed',
          errorMessage: String(error?.message ?? error).slice(0, 2000),
          ...(observedSignature ? {} : { mintLeaseExpiresAt: null }),
        },
      });

      throw error;
    }
  }

  async mintWinnerCredential(
    awardId: string,
  ): Promise<{
    signature: string;
    assetId: string;
    leafIndex: bigint;
    credentialHash: string;
  }> {
    const existing = await this.prisma.winnerAward.findUnique({
      where: { id: awardId },
    });
    if (!existing) throw new NotFoundException('Winner award not found');
    if (
      existing.status === 'confirmed' &&
      existing.signature &&
      existing.nftAssetId &&
      existing.leafIndex != null &&
      existing.credentialHash
    ) {
      return {
        signature: existing.signature,
        assetId: existing.nftAssetId,
        leafIndex: existing.leafIndex,
        credentialHash: existing.credentialHash,
      };
    }
    if (['submitted', 'reconciliation_required'].includes(existing.status)) {
      const reconciled = await this.reconcileWinnerCredential(awardId);
      if (reconciled) return reconciled;
    }

    assertPublicCredentialMetadataBaseUrl(this.winnerCredentialMetadataBaseUrl);
    const snapshot = existing.decisionSnapshot as Record<string, unknown>;
    const credentialHash = hashWinnerDecisionSnapshot(snapshot);
    const metadata = {
      name: WINNER_CREDENTIAL_NAME,
      symbol: WINNER_CREDENTIAL_SYMBOL,
      uri: `${this.winnerCredentialMetadataBaseUrl}/${credentialHash}.json`,
    };
    validateBubblegumMetadata(metadata);
    const bubblegumMetadata = this.buildBubblegumMetadata(metadata);
    const metadataDataHash = Buffer.from(
      hashMetadataDataV2(bubblegumMetadata),
    ).toString('hex');
    const mintAttemptId = crypto.randomUUID();
    const claimTime = new Date();
    const lease = new Date(Date.now() + MINT_CLAIM_LEASE_MS);
    const staleMinting =
      existing.status === 'minting' &&
      !existing.signature &&
      (!existing.mintLeaseExpiresAt ||
        existing.mintLeaseExpiresAt <= claimTime);
    const claimed = await this.prisma.winnerAward.updateMany({
      where: {
        id: awardId,
        retryCount: { lt: MAX_MINT_ATTEMPTS },
        ...(staleMinting
          ? {
              status: 'minting',
              signature: null,
              OR: [
                { mintLeaseExpiresAt: { lte: claimTime } },
                { mintLeaseExpiresAt: null },
              ],
            }
          : { status: { in: ['selected', 'failed'] } }),
      },
      data: {
        status: 'minting',
        signature: null,
        nftAssetId: null,
        credentialHash,
        metadataUri: metadata.uri,
        metadataDataHash,
        metadataCreator: this.authorityPublicKey,
        assetOwner: existing.recipientAddress,
        network: this.network,
        retryCount: { increment: 1 },
        mintAttemptId,
        mintLeaseExpiresAt: lease,
        lastValidBlockHeight: null,
        errorMessage: null,
      },
    });
    if (claimed.count !== 1) {
      throw new ServiceUnavailableException({
        code: 'WINNER_CERTIFICATE_MINT_BUSY',
        message:
          'Winner certificate mint is already running or reached its retry limit',
        retryable: true,
      });
    }

    let observedSignature: string | null = null;
    try {
      const builder = mintV2(this.umi, {
        leafOwner: umiPublicKey(existing.recipientAddress),
        merkleTree: umiPublicKey(this.merkleTreeAddress),
        metadata: bubblegumMetadata,
      });
      const latestBlockhash = await this.umi.rpc.getLatestBlockhash({
        commitment: 'confirmed',
      });
      builder.setBlockhash(latestBlockhash);
      const signedTransaction = await builder.buildAndSign(this.umi);
      const signature = bs58.encode(signedTransaction.signatures[0]);
      const persisted = await this.prisma.winnerAward.updateMany({
        where: { id: awardId, mintAttemptId, status: 'minting' },
        data: {
          signature,
          status: 'submitted',
          lastValidBlockHeight: BigInt(latestBlockhash.lastValidBlockHeight),
          errorMessage: null,
        },
      });
      if (persisted.count !== 1)
        throw new ServiceUnavailableException(
          'Winner certificate mint claim expired before send',
        );
      observedSignature = signature;
      const sentSignature = await this.umi.rpc.sendTransaction(
        signedTransaction,
        { skipPreflight: false },
      );
      if (bs58.encode(sentSignature) !== signature)
        throw new ServiceUnavailableException(
          'RPC returned a different winner certificate signature',
        );
      const confirmation = await builder.confirm(this.umi, sentSignature, {
        commitment: 'confirmed',
      });
      const leaf = await parseLeafFromMintV2Transaction(
        this.umi,
        sentSignature,
      );
      const leafIndex = BigInt(leaf.nonce);
      const [assetId] = findLeafAssetIdPda(this.umi, {
        merkleTree: umiPublicKey(this.merkleTreeAddress),
        leafIndex,
      });
      if (
        assetId.toString() !== leaf.id.toString() ||
        leaf.owner.toString() !== existing.recipientAddress ||
        Buffer.from(leaf.dataHash).toString('hex') !== metadataDataHash
      )
        throw new ServiceUnavailableException(
          'Winner certificate leaf did not match its request',
        );

      const committed = await this.prisma.winnerAward.updateMany({
        where: {
          id: awardId,
          mintAttemptId,
          signature,
          status: { in: ['submitted', 'reconciliation_required'] },
        },
        data: {
          status: 'confirmed',
          nftAssetId: assetId.toString(),
          merkleTree: this.merkleTreeAddress,
          leafIndex,
          slot: BigInt(confirmation.context.slot),
          confirmedAt: new Date(),
          mintLeaseExpiresAt: null,
          errorMessage: null,
        },
      });
      if (committed.count !== 1) throw this.reconciliationPending();
      return {
        signature,
        assetId: assetId.toString(),
        leafIndex,
        credentialHash,
      };
    } catch (error) {
      await this.prisma.winnerAward.updateMany({
        where: observedSignature
          ? {
              id: awardId,
              mintAttemptId,
              signature: observedSignature,
              status: { in: ['submitted', 'reconciliation_required'] },
            }
          : { id: awardId, mintAttemptId, signature: null, status: 'minting' },
        data: {
          status: observedSignature ? 'reconciliation_required' : 'failed',
          errorMessage: String((error as Error)?.message ?? error).slice(
            0,
            2000,
          ),
          ...(observedSignature ? {} : { mintLeaseExpiresAt: null }),
        },
      });
      throw error;
    }
  }

  async reconcileWinnerCredential(
    awardId: string,
  ): Promise<{
    signature: string;
    assetId: string;
    leafIndex: bigint;
    credentialHash: string;
  } | null> {
    const award = await this.prisma.winnerAward.findUnique({
      where: { id: awardId },
    });
    if (!award) throw new NotFoundException('Winner award not found');
    if (
      award.status === 'confirmed' &&
      award.signature &&
      award.nftAssetId &&
      award.leafIndex != null &&
      award.credentialHash
    ) {
      return {
        signature: award.signature,
        assetId: award.nftAssetId,
        leafIndex: award.leafIndex,
        credentialHash: award.credentialHash,
      };
    }
    if (
      !['submitted', 'reconciliation_required'].includes(award.status) ||
      !award.signature
    )
      return null;
    let transaction;
    try {
      transaction = await this.connection.getTransaction(award.signature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      });
    } catch {
      throw this.reconciliationPending();
    }
    if (!transaction) throw this.reconciliationPending();
    if (transaction.meta?.err) {
      await this.prisma.winnerAward.updateMany({
        where: {
          id: awardId,
          signature: award.signature,
          status: { in: ['submitted', 'reconciliation_required'] },
        },
        data: {
          status: 'failed',
          errorMessage: JSON.stringify(transaction.meta.err).slice(0, 2000),
          mintLeaseExpiresAt: null,
        },
      });
      return null;
    }
    const leaf = await parseLeafFromMintV2Transaction(
      this.umi,
      bs58.decode(award.signature),
    );
    const leafIndex = BigInt(leaf.nonce);
    const [assetId] = findLeafAssetIdPda(this.umi, {
      merkleTree: umiPublicKey(this.merkleTreeAddress),
      leafIndex,
    });
    if (
      assetId.toString() !== leaf.id.toString() ||
      leaf.owner.toString() !== award.recipientAddress ||
      !award.metadataDataHash ||
      Buffer.from(leaf.dataHash).toString('hex') !== award.metadataDataHash ||
      !award.credentialHash
    )
      throw new ServiceUnavailableException(
        'Winner certificate transaction has an unexpected identity',
      );
    const committed = await this.prisma.winnerAward.updateMany({
      where: {
        id: awardId,
        signature: award.signature,
        status: { in: ['submitted', 'reconciliation_required'] },
      },
      data: {
        status: 'confirmed',
        nftAssetId: assetId.toString(),
        merkleTree: this.merkleTreeAddress,
        leafIndex,
        slot: BigInt(transaction.slot),
        confirmedAt: new Date(),
        mintLeaseExpiresAt: null,
        errorMessage: null,
      },
    });
    if (committed.count !== 1) throw this.reconciliationPending();
    return {
      signature: award.signature,
      assetId: assetId.toString(),
      leafIndex,
      credentialHash: award.credentialHash,
    };
  }

  async getWinnerCredentialMetadata(hash: string) {
    if (!/^[0-9a-f]{64}$/.test(hash))
      throw new NotFoundException('Winner credential metadata not found');
    const award = await this.prisma.winnerAward.findFirst({
      where: { credentialHash: hash },
    });
    const available = [
      'minting',
      'submitted',
      'reconciliation_required',
      'confirmed',
    ].includes(award?.status ?? '');
    if (
      !award ||
      !available ||
      hashWinnerDecisionSnapshot(
        award.decisionSnapshot as Record<string, unknown>,
      ) !== hash ||
      award.metadataUri !==
        `${this.winnerCredentialMetadataBaseUrl}/${hash}.json`
    ) {
      throw new NotFoundException('Winner credential metadata not found');
    }
    return {
      name: WINNER_CREDENTIAL_NAME,
      symbol: WINNER_CREDENTIAL_SYMBOL,
      description: 'Azync HackHub organizer-selected winner certificate.',
      properties: {
        category: 'image',
        files: [],
        awardType: 'HACKATHON_WINNER',
        credentialHash: `sha256:${hash}`,
        schemaVersion: 1,
        awardVersion: 1,
        hashAlgorithm: 'sha256-canonical-json',
      },
    };
  }

  async verifyWinnerCredential(awardId: string) {
    const award = await this.prisma.winnerAward.findUnique({
      where: { id: awardId },
    });
    if (
      !award ||
      award.status !== 'confirmed' ||
      !award.signature ||
      !award.nftAssetId ||
      award.leafIndex == null ||
      !award.merkleTree ||
      !award.credentialHash ||
      !award.metadataCreator ||
      !award.metadataUri
    ) {
      return { verified: false, reason: 'incomplete_winner_credential_proof' };
    }
    const snapshotHash = hashWinnerDecisionSnapshot(
      award.decisionSnapshot as Record<string, unknown>,
    );
    const expectedDataHash = Buffer.from(
      hashMetadataDataV2(
        this.buildBubblegumMetadata(
          {
            name: WINNER_CREDENTIAL_NAME,
            symbol: WINNER_CREDENTIAL_SYMBOL,
            uri: award.metadataUri,
          },
          award.metadataCreator,
        ),
      ),
    ).toString('hex');
    const [derivedAsset] = findLeafAssetIdPda(this.umi, {
      merkleTree: umiPublicKey(award.merkleTree),
      leafIndex: award.leafIndex,
    });
    if (award.network !== this.network)
      return {
        verified: null,
        status: 'unavailable',
        reason: 'rpc_cluster_mismatch',
      };
    let transaction;
    let leaf;
    try {
      transaction = await this.connection.getTransaction(award.signature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      });
      if (!transaction)
        return {
          verified: null,
          status: 'unavailable',
          reason: 'transaction_unavailable',
        };
      if (transaction.meta?.err)
        return { verified: false, reason: 'transaction_failed' };
      leaf = await parseLeafFromMintV2Transaction(
        this.umi,
        bs58.decode(award.signature),
      );
    } catch {
      return {
        verified: null,
        status: 'unavailable',
        reason: 'transaction_parse_unavailable',
      };
    }
    const verified =
      snapshotHash === award.credentialHash &&
      derivedAsset.toString() === award.nftAssetId &&
      leaf.id.toString() === award.nftAssetId &&
      leaf.owner.toString() === award.recipientAddress &&
      BigInt(leaf.nonce) === award.leafIndex &&
      expectedDataHash === award.metadataDataHash &&
      Buffer.from(leaf.dataHash).toString('hex') === expectedDataHash &&
      award.assetOwner === award.recipientAddress;
    return {
      verified,
      awardId,
      hackathonId: award.hackathonId,
      submissionId: award.submissionId,
      cluster: award.network,
      recipient: award.recipientAddress,
      signature: award.signature,
      assetId: award.nftAssetId,
      tree: award.merkleTree,
      leafIndex: award.leafIndex.toString(),
      credentialHash: award.credentialHash,
      awardVersion: 1,
      metadataUri: award.metadataUri,
      reason: verified ? null : 'winner_credential_proof_mismatch',
    };
  }

  getExplorerUrl(signature: string): string {
    const cluster =
      this.network === 'mainnet-beta' ? '' : `?cluster=${this.network}`;
    return `https://explorer.solana.com/tx/${signature}${cluster}`;
  }

  async getCredentialMetadata(hash: string) {
    if (!/^[0-9a-f]{64}$/.test(hash))
      throw new NotFoundException('Credential metadata not found');
    const proof = await this.prisma.solanaTransaction.findFirst({
      where: { credentialHash: hash },
      include: { submission: true },
    });
    // The URI can be fetched as soon as the mint claim is persisted, before
    // the transaction is sent or the confirmed proof is committed.
    const metadataAvailable = [
      'minting',
      'submitted',
      'reconciliation_required',
      'confirmed',
    ].includes(proof?.status ?? '');
    if (
      !proof?.submission?.finalSnapshot ||
      proof.credentialHash !== hash ||
      !metadataAvailable ||
      !isValidCredentialMetadataUri(proof.metadataUri, hash)
    ) {
      throw new NotFoundException('Credential metadata not found');
    }
    const snapshot = proof.submission.finalSnapshot as Record<string, unknown>;
    if (hashFinalSubmissionSnapshot(snapshot) !== hash)
      throw new BadRequestException(
        'Credential metadata integrity check failed',
      );
    // This endpoint cannot serve a URI committed to a previous host. Report
    // deployment availability separately from the credential's integrity.
    if (
      proof.metadataUri !== `${this.credentialMetadataBaseUrl}/${hash}.json`
    ) {
      throw new ServiceUnavailableException({
        code: 'CREDENTIAL_METADATA_HOST_UNAVAILABLE',
        metadataUri: proof.metadataUri,
      });
    }
    return {
      name: 'Azync HackHub Credential',
      symbol: 'AHSUB',
      description: 'Azync HackHub final-submission credential.',
      properties: {
        category: 'image',
        files: [],
        credentialHash: `sha256:${hash}`,
        schemaVersion: 1,
        receiptVersion: snapshot.receiptVersion,
        hashAlgorithm: 'sha256-canonical-json',
      },
    };
  }

  async verifyCredential(submissionId: string) {
    const proof = await this.prisma.solanaTransaction.findUnique({
      where: { submissionId },
      include: { submission: true },
    });
    if (
      !proof?.submission?.finalSnapshot ||
      proof.status !== 'confirmed' ||
      !proof.signature ||
      !proof.nftAssetId ||
      proof.leafIndex == null ||
      !proof.merkleTree ||
      !proof.credentialHash ||
      !proof.metadataCreator
    ) {
      return { verified: false, reason: 'incomplete_credential_proof' };
    }
    const snapshotHash = hashFinalSubmissionSnapshot(
      proof.submission.finalSnapshot as Record<string, unknown>,
    );
    if (!isValidCredentialMetadataUri(proof.metadataUri, snapshotHash)) {
      return { verified: false, reason: 'invalid_credential_metadata_uri' };
    }
    const expectedUri = proof.metadataUri;
    const expectedDataHash = Buffer.from(
      hashMetadataDataV2(
        this.buildBubblegumMetadata(
          {
            name: CREDENTIAL_NAME,
            symbol: CREDENTIAL_SYMBOL,
            uri: expectedUri,
          },
          proof.metadataCreator,
        ),
      ),
    ).toString('hex');
    const [derivedAsset] = findLeafAssetIdPda(this.umi, {
      merkleTree: umiPublicKey(proof.merkleTree),
      leafIndex: proof.leafIndex,
    });
    if (proof.network !== this.network) {
      return {
        verified: null,
        status: 'unavailable',
        reason: 'rpc_cluster_mismatch',
        proofCluster: proof.network,
        configuredCluster: this.network,
      };
    }
    let transaction;
    let leaf;
    try {
      transaction = await this.connection.getTransaction(proof.signature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      });
      if (!transaction)
        return {
          verified: null,
          status: 'unavailable',
          reason: 'transaction_unavailable',
          proofCluster: proof.network,
        };
      if (transaction.meta?.err)
        return { verified: false, reason: 'transaction_failed' };
      leaf = await parseLeafFromMintV2Transaction(
        this.umi,
        bs58.decode(proof.signature),
      );
    } catch {
      return {
        verified: null,
        status: 'unavailable',
        reason: 'transaction_parse_unavailable',
        proofCluster: proof.network,
      };
    }
    const verified =
      snapshotHash === proof.credentialHash &&
      derivedAsset.toString() === proof.nftAssetId &&
      leaf.id.toString() === proof.nftAssetId &&
      leaf.owner.toString() === proof.walletAddress &&
      BigInt(leaf.nonce) === proof.leafIndex &&
      expectedDataHash === proof.metadataDataHash &&
      Buffer.from(leaf.dataHash).toString('hex') === expectedDataHash &&
      proof.assetOwner === proof.walletAddress;
    return {
      verified,
      submissionId,
      cluster: proof.network,
      recipient: proof.walletAddress,
      signature: proof.signature,
      assetId: proof.nftAssetId,
      tree: proof.merkleTree,
      leafIndex: proof.leafIndex.toString(),
      credentialHash: proof.credentialHash,
      receiptVersion: (
        proof.submission.finalSnapshot as Record<string, unknown>
      ).receiptVersion,
      metadataUri: proof.metadataUri,
      reason: verified ? null : 'credential_proof_mismatch',
    };
  }

  async getHealth() {
    const checkedAt = new Date().toISOString();
    try {
      const authority = new PublicKey(this.authorityPublicKey);
      const tree = new PublicKey(this.merkleTreeAddress);
      const [version, balance, treeAccount] = await Promise.all([
        this.connection.getVersion(),
        this.connection.getBalance(authority),
        this.connection.getAccountInfo(tree),
      ]);
      return {
        status: treeAccount ? 'ok' : 'degraded',
        network: this.network,
        rpc: { reachable: true, version: version['solana-core'] },
        authority: {
          publicKey: this.authorityPublicKey,
          balanceSol: balance / LAMPORTS_PER_SOL,
          sufficientForFees: balance >= 0.01 * LAMPORTS_PER_SOL,
        },
        merkleTree: {
          address: this.merkleTreeAddress,
          exists: Boolean(treeAccount),
          executable: treeAccount?.executable ?? false,
        },
        checkedAt,
      };
    } catch (error) {
      return {
        status: 'unavailable',
        network: this.network,
        rpc: { reachable: false },
        error: String(error?.message ?? error).slice(0, 500),
        checkedAt,
      };
    }
  }

  async reconcileSubmissionCredential(
    submissionId: string,
  ): Promise<{ signature: string; assetId: string } | null> {
    const record = await this.prisma.solanaTransaction.findUnique({
      where: { submissionId },
    });
    if (!record) {
      return null;
    }
    if (record.status === 'confirmed') {
      if (record.signature && record.nftAssetId) {
        return { signature: record.signature, assetId: record.nftAssetId };
      }
      throw this.reconciliationPending();
    }
    if (
      !['submitted', 'reconciliation_required'].includes(record.status) ||
      !record.signature
    ) {
      return null;
    }

    let transaction;
    try {
      transaction = await this.connection.getTransaction(record.signature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      });
    } catch {
      throw this.reconciliationPending();
    }
    if (!transaction) {
      // A signed transaction that has not passed its blockhash expiry remains
      // ambiguous. Never mint again during that window.
      let blockHeight: number;
      try {
        blockHeight = await this.connection.getBlockHeight('confirmed');
      } catch {
        throw this.reconciliationPending();
      }
      if (
        record.lastValidBlockHeight != null &&
        BigInt(blockHeight) > record.lastValidBlockHeight
      ) {
        // getTransaction can be absent on a lagging/pruned RPC even after a
        // signature landed. A null history result is still ambiguous: it may
        // mean "never landed" or "this RPC no longer has the history".
        const signatureStatus = await this.getHistoricalSignatureStatus(
          record.signature,
        );
        if (
          signatureStatus?.err &&
          signatureStatus.confirmationStatus === 'finalized'
        ) {
          return this.markAttemptFailedIfCurrent(
            submissionId,
            record.signature,
            JSON.stringify(signatureStatus.err).slice(0, 2000),
          );
        }
      }
      throw this.reconciliationPending();
    }
    if (transaction.meta?.err) {
      const signatureStatus = await this.getHistoricalSignatureStatus(
        record.signature,
      );
      if (
        signatureStatus?.err &&
        signatureStatus.confirmationStatus === 'finalized'
      ) {
        return this.markAttemptFailedIfCurrent(
          submissionId,
          record.signature,
          JSON.stringify(signatureStatus.err).slice(0, 2000),
        );
      }
      throw this.reconciliationPending();
    }
    const leaf = await parseLeafFromMintV2Transaction(
      this.umi,
      bs58.decode(record.signature),
    );
    const leafIndex = BigInt(leaf.nonce);
    const [derivedAsset] = findLeafAssetIdPda(this.umi, {
      merkleTree: umiPublicKey(this.merkleTreeAddress),
      leafIndex,
    });
    const assetId = derivedAsset.toString();
    if (
      assetId !== leaf.id.toString() ||
      leaf.owner.toString() !== record.walletAddress ||
      !record.metadataDataHash ||
      Buffer.from(leaf.dataHash).toString('hex') !== record.metadataDataHash
    ) {
      throw new ServiceUnavailableException(
        'Confirmed transaction has an unexpected Bubblegum credential identity',
      );
    }
    const committed = await this.prisma.$transaction(async (tx) => {
      const transition = await tx.solanaTransaction.updateMany({
        where: {
          submissionId,
          signature: record.signature,
          status: { in: ['submitted', 'reconciliation_required'] },
        },
        data: {
          status: 'confirmed',
          confirmations: 1,
          slot: BigInt(transaction.slot),
          nftAssetId: assetId,
          merkleTree: this.merkleTreeAddress,
          leafIndex,
          errorMessage: null,
          confirmedAt: new Date(),
          mintLeaseExpiresAt: null,
        },
      });
      if (transition.count !== 1) return false;
      await tx.submission.update({
        where: { id: submissionId },
        data: {
          status: 'confirmed',
          transactionSignature: record.signature,
          nftAssetId: assetId,
          metadataHash: record.credentialHash,
          mintStatus: 'CONFIRMED',
        },
      });
      return true;
    });
    if (!committed) {
      const current = await this.prisma.solanaTransaction.findUnique({
        where: { submissionId },
        select: { status: true, signature: true, nftAssetId: true },
      });
      if (
        current?.status === 'confirmed' &&
        current.signature &&
        current.nftAssetId
      ) {
        return { signature: current.signature, assetId: current.nftAssetId };
      }
      throw this.reconciliationPending();
    }
    return { signature: record.signature, assetId };
  }

  async getMintRecoveryState(submissionId: string) {
    return this.prisma.solanaTransaction.findUnique({
      where: { submissionId },
      select: { status: true, signature: true, nftAssetId: true },
    });
  }

  private reconciliationPending(): ServiceUnavailableException {
    return new ServiceUnavailableException({
      code: 'SOLANA_RECONCILIATION_PENDING',
      message: 'Transaction is not yet available from the configured RPC',
      retryable: true,
    });
  }

  private async getHistoricalSignatureStatus(signature: string) {
    try {
      const statuses = await this.connection.getSignatureStatuses([signature], {
        searchTransactionHistory: true,
      });
      return statuses.value[0];
    } catch {
      throw this.reconciliationPending();
    }
  }

  /** Only the observed signed attempt may move itself to failed. */
  private async markAttemptFailedIfCurrent(
    submissionId: string,
    signature: string,
    errorMessage: string,
  ): Promise<{ signature: string; assetId: string } | null> {
    const transition = await this.prisma.solanaTransaction.updateMany({
      where: {
        submissionId,
        signature,
        status: { in: ['submitted', 'reconciliation_required'] },
      },
      data: { status: 'failed', errorMessage },
    });
    if (transition.count === 1) return null;

    // A concurrent reconciler may have confirmed while this RPC lookup was in
    // flight. Return that durable proof instead of overwriting or retrying it.
    const current = await this.prisma.solanaTransaction.findUnique({
      where: { submissionId },
      select: { status: true, signature: true, nftAssetId: true },
    });
    if (
      current?.status === 'confirmed' &&
      current.signature &&
      current.nftAssetId
    ) {
      return { signature: current.signature, assetId: current.nftAssetId };
    }
    if (current?.status === 'failed' && current.signature === signature)
      return null;
    throw this.reconciliationPending();
  }

  private async claimMintAttempt(input: {
    submissionId: string;
    walletAddress: string;
    credentialHash: string;
    metadataUri: string;
    metadataDataHash: string;
    metadataCreator?: string;
  }): Promise<string> {
    const mintAttemptId = crypto.randomUUID();
    const mintLeaseExpiresAt = new Date(Date.now() + MINT_CLAIM_LEASE_MS);
    const data = {
      walletAddress: input.walletAddress,
      network: this.network,
      credentialHash: input.credentialHash,
      metadataUri: input.metadataUri,
      metadataDataHash: input.metadataDataHash,
      metadataCreator: input.metadataCreator,
      assetOwner: input.walletAddress,
    };
    const existing = await this.prisma.solanaTransaction.findUnique({
      where: { submissionId: input.submissionId },
    });
    if (!existing) {
      try {
        await this.prisma.solanaTransaction.create({
          data: {
            submissionId: input.submissionId,
            ...data,
            status: 'minting',
            retryCount: 1,
            mintAttemptId,
            mintLeaseExpiresAt,
          },
        });
        return mintAttemptId;
      } catch (error) {
        if ((error as { code?: string }).code !== 'P2002') throw error;
        return this.claimMintAttempt(input);
      }
    }
    if (existing.status === 'confirmed')
      throw new BadRequestException('Credential already minted successfully');
    if (['submitted', 'reconciliation_required'].includes(existing.status)) {
      throw new ServiceUnavailableException({
        code: 'SOLANA_MINT_RECONCILIATION_PENDING',
        message: 'An existing mint attempt must be reconciled before retrying',
        retryable: true,
      });
    }
    const claimTime = new Date();
    const staleMinting =
      existing.status === 'minting' &&
      !existing.signature &&
      (!existing.mintLeaseExpiresAt ||
        existing.mintLeaseExpiresAt <= claimTime);
    if (existing.status === 'minting' && !staleMinting) {
      throw new ServiceUnavailableException({
        code: 'SOLANA_MINT_RECONCILIATION_PENDING',
        message: 'An existing mint attempt is still signing',
        retryable: true,
      });
    }
    const claim = await this.prisma.solanaTransaction.updateMany({
      where: {
        submissionId: input.submissionId,
        retryCount: { lt: MAX_MINT_ATTEMPTS },
        ...(staleMinting
          ? {
              status: 'minting',
              signature: null,
              // Older rows have no lease. They are recoverable after a restart,
              // but the update remains a single atomic compare-and-claim.
              OR: [
                { mintLeaseExpiresAt: { lte: claimTime } },
                { mintLeaseExpiresAt: null },
              ],
            }
          : { status: { in: ['pending', 'failed'] } }),
      },
      // A failed signed transaction is proven failed/expired, so a replacement
      // attempt must not inherit its signature. Otherwise a crash before the
      // new signature is persisted would leave an unreclaimable minting row.
      data: {
        ...data,
        status: 'minting',
        signature: null,
        lastValidBlockHeight: null,
        errorMessage: null,
        retryCount: { increment: 1 },
        mintAttemptId,
        mintLeaseExpiresAt,
      },
    });
    if (claim.count !== 1) {
      throw new BadRequestException(
        `Mint retry limit (${MAX_MINT_ATTEMPTS}) reached or another request owns this mint attempt`,
      );
    }
    return mintAttemptId;
  }

  private buildNFTMetadata(metadata: SubmissionMetadata, hash: string) {
    return {
      name: CREDENTIAL_NAME,
      symbol: CREDENTIAL_SYMBOL,
      // URI is public, valid, and commits the receipt hash in Bubblegum's
      // metadata data hash. It deliberately contains no repo/demo/team PII.
      uri: `${this.credentialMetadataBaseUrl}/${hash}.json`,
      attributes: [
        { trait_type: 'Hackathon', value: metadata.hackathonName },
        { trait_type: 'Team', value: metadata.teamName },
        { trait_type: 'Project', value: metadata.projectName },
        {
          trait_type: 'Submission Time',
          value: metadata.submittedAt.toISOString(),
        },
        { trait_type: 'Metadata Hash', value: `sha256:${hash}` },
        { trait_type: 'Credential Hash', value: `sha256:${hash}` },
      ],
    };
  }

  private buildBubblegumMetadata(
    metadata: { name: string; symbol: string; uri: string },
    creator = this.authorityPublicKey,
  ) {
    return {
      name: metadata.name,
      symbol: metadata.symbol,
      uri: metadata.uri,
      sellerFeeBasisPoints: 0,
      collection: null,
      creators: [
        { address: umiPublicKey(creator), verified: true, share: 100 },
      ],
    };
  }
}
