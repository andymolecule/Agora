import type { ProofBundle } from "../types/submission.js";

const proofBundle: ProofBundle = {
  inputHash: "input-hash",
  outputHash: "output-hash",
  containerImageDigest:
    "ghcr.io/hermes-science/repro-scorer@sha256:abc123",
  score: 0.75,
  scorerLog: "scorer output",
  meta: {
    challengeId: "challenge-1",
    submissionId: "submission-1",
    createdAt: "2026-03-06T00:00:00.000Z",
  },
};

if (!proofBundle.containerImageDigest.includes("@sha256:")) {
  console.error("ProofBundle should use containerImageDigest");
  process.exit(1);
}

if (proofBundle.meta?.challengeId !== "challenge-1") {
  console.error("ProofBundle meta should remain optional debug metadata");
  process.exit(1);
}

console.log("proof bundle type validation passed");
