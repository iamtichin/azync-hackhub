export interface SubmissionMetadata {
  hackathonName: string;
  teamName: string;
  projectName: string;
  githubUrl: string;
  demoUrl: string;
  submittedAt: Date;
  /** Immutable receipt captured at finalization; never rebuild this from a draft. */
  finalSnapshot: Record<string, unknown>;
}

export interface NFTAttribute {
  trait_type: string;
  value: string;
}

export interface NFTMetadata {
  name: string;
  symbol: string;
  attributes: NFTAttribute[];
}
