import {
  SUBMISSION_RESULT_FORMAT,
  importSubmissionOpenPrivateKey,
  openSubmission,
  parseSealedSubmissionEnvelope,
} from "@agora/common";
import { getText } from "@agora/ipfs";
import type { ScoringInputSource } from "./pipeline.js";

export class SealedSubmissionError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "SealedSubmissionError";
    this.code = code;
  }
}

export async function resolveSubmissionSource(input: {
  resultCid: string;
  resultFormat?: string | null;
  challengeId: string;
  solverAddress: string;
  privateKeyPem?: string;
  privateKeyPemsByKid?: Record<string, string>;
}): Promise<ScoringInputSource> {
  if (
    !input.resultFormat ||
    input.resultFormat === SUBMISSION_RESULT_FORMAT.plainV0
  ) {
    return { cid: input.resultCid };
  }

  if (input.resultFormat !== SUBMISSION_RESULT_FORMAT.sealedSubmissionV2) {
    throw new SealedSubmissionError(
      "unsupported_result_format",
      `Unsupported submission result_format: ${input.resultFormat}`,
    );
  }

  if (!input.privateKeyPem && !input.privateKeyPemsByKid) {
    throw new SealedSubmissionError(
      "missing_decryption_key",
      "Submission decryption key is not configured.",
    );
  }

  const envelopeText = await getText(input.resultCid);
  const envelope = (() => {
    try {
      return parseSealedSubmissionEnvelope(envelopeText);
    } catch (error) {
      throw new SealedSubmissionError(
        "invalid_envelope_schema",
        error instanceof Error
          ? error.message
          : "Invalid sealed submission envelope.",
      );
    }
  })();
  const privateKeyPem =
    input.privateKeyPemsByKid?.[envelope.kid] ?? input.privateKeyPem;
  if (!privateKeyPem) {
    throw new SealedSubmissionError(
      "missing_decryption_key",
      `Submission decryption key for kid ${envelope.kid} is not configured.`,
    );
  }
  const privateKey = await importSubmissionOpenPrivateKey(privateKeyPem);
  const opened = await (async () => {
    try {
      return await openSubmission({
        envelope,
        privateKey,
      });
    } catch (error) {
      throw new SealedSubmissionError(
        "decrypt_failed",
        error instanceof Error
          ? error.message
          : "Failed to decrypt sealed submission.",
      );
    }
  })();

  if (opened.envelope.challengeId !== input.challengeId) {
    throw new SealedSubmissionError(
      "challenge_id_mismatch",
      "Sealed submission challengeId does not match submission row.",
    );
  }
  if (
    opened.envelope.solverAddress.toLowerCase() !==
    input.solverAddress.toLowerCase()
  ) {
    throw new SealedSubmissionError(
      "solver_address_mismatch",
      "Sealed submission solverAddress does not match submission row.",
    );
  }

  return { bytes: opened.bytes };
}
