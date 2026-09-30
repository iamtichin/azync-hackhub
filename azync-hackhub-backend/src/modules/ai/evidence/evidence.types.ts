import type { EvidenceStatus, EvidenceType } from '@prisma/client';

export type EvidenceSource = 'github_api' | 'solana_rpc' | 'http_probe';

export interface EvidenceDraft {
  type: EvidenceType;
  source: EvidenceSource;
  status: EvidenceStatus;
  reference: string;
  sourceRevision: string | null;
  locator: Record<string, unknown>;
  facts: Record<string, unknown>;
  contentHash: string | null;
  errorCode: string | null;
  expiresAt: Date | null;
}

export interface RepositoryPromptData {
  readme: { path: string; text: string; truncated: boolean } | null;
  packageManifest: unknown;
  selectedSourceExcerpts: Array<{
    path: string;
    startLine: number;
    endLine: number;
    text: string;
    truncated: boolean;
  }>;
}

export interface ArtifactDraft {
  artifactKey: string;
  type:
    'REPOSITORY_MANIFEST' | 'README' | 'PACKAGE_MANIFEST' | 'SOURCE_EXCERPT';
  source: 'github_api';
  reference: string;
  path: string | null;
  sourceRevision: string;
  content: string;
  contentHash: string;
  metadata: Record<string, unknown>;
}

export interface GitHubCollectionResult {
  records: EvidenceDraft[];
  repositoryData: RepositoryPromptData;
  artifacts: ArtifactDraft[];
}

export interface SubmissionEvidenceInput {
  id: string;
  githubUrl: string;
  demoUrl: string;
  walletAddress: string;
  transactionSignature: string | null;
  nftAssetId: string | null;
  participantBlockchainEvidenceUrl: string | null;
}
