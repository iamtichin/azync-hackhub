import { createHash } from 'crypto';
import { EVIDENCE_COLLECTOR_VERSION } from '../constants/ai.constants';
import type { EvidenceDraft } from './evidence.types';

export function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`;
}

export function createEvidenceSnapshotKey(
  submissionId: string,
  evidence: EvidenceDraft,
): string {
  return sha256(
    [
      submissionId,
      evidence.type,
      evidence.reference,
      evidence.sourceRevision ?? 'none',
      EVIDENCE_COLLECTOR_VERSION,
    ].join('|'),
  );
}

export function unavailableEvidence(
  type: EvidenceDraft['type'],
  source: EvidenceDraft['source'],
  reference: string,
  errorCode: string,
): EvidenceDraft {
  return {
    type,
    source,
    status: 'UNAVAILABLE',
    reference,
    sourceRevision: null,
    locator: {},
    facts: {},
    contentHash: null,
    errorCode,
    expiresAt: null,
  };
}
