export interface AuthoringDraftOwnershipError {
  status: 401 | 403;
  code: "AUTHORING_DRAFT_ADDRESS_REQUIRED" | "AUTHORING_DRAFT_ADDRESS_MISMATCH";
  message: string;
}

export function normalizePosterAddress(address?: string | null) {
  return address?.trim().toLowerCase() || null;
}

export function resolveAuthoringDraftPosterAddress(input: {
  draftPosterAddress?: string | null;
  requesterAddress?: string | null;
}) {
  return (
    normalizePosterAddress(input.requesterAddress) ??
    normalizePosterAddress(input.draftPosterAddress)
  );
}

export function getAuthoringDraftOwnershipError(input: {
  draftPosterAddress?: string | null;
  requesterAddress?: string | null;
  action: "compile" | "publish";
}): AuthoringDraftOwnershipError | null {
  const draftPosterAddress = normalizePosterAddress(input.draftPosterAddress);
  if (!draftPosterAddress) {
    return null;
  }

  const requesterAddress = normalizePosterAddress(input.requesterAddress);
  if (!requesterAddress) {
    return {
      status: 401,
      code: "AUTHORING_DRAFT_ADDRESS_REQUIRED",
      message: `This authoring draft is already bound to wallet ${draftPosterAddress}. Next step: reconnect that wallet and retry ${input.action}.`,
    };
  }

  if (requesterAddress !== draftPosterAddress) {
    return {
      status: 403,
      code: "AUTHORING_DRAFT_ADDRESS_MISMATCH",
      message: `This authoring draft belongs to wallet ${draftPosterAddress}. Next step: switch back to that wallet and retry ${input.action}.`,
    };
  }

  return null;
}
