export interface SubmissionMetadata {
  challengeId: string;
  solverAddress: string;
  resultCid: string;
  resultHash: string;
  submittedAt: string;
}

export interface ProofBundle {
  inputHash: string;
  outputHash: string;
  containerImageDigest: string;
  score: number;
  scorerLog?: string;
  meta?: {
    challengeId?: string;
    submissionId?: string;
    createdAt?: string;
  };
}

export interface VerificationRecord {
  proofBundleId: string;
  verifierAddress: string;
  computedScore: number;
  matchesOriginal: boolean;
  logCid?: string;
  verifiedAt: string;
}
