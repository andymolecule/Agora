export interface PostingSessionOwnershipError {
  status: 401 | 403;
  code: "POSTING_SESSION_ADDRESS_REQUIRED" | "POSTING_SESSION_ADDRESS_MISMATCH";
  message: string;
}

export function normalizePosterAddress(address?: string | null) {
  return address?.trim().toLowerCase() || null;
}

export function resolvePostingSessionPosterAddress(input: {
  sessionPosterAddress?: string | null;
  requesterAddress?: string | null;
}) {
  return (
    normalizePosterAddress(input.requesterAddress) ??
    normalizePosterAddress(input.sessionPosterAddress)
  );
}

export function getPostingSessionOwnershipError(input: {
  sessionPosterAddress?: string | null;
  requesterAddress?: string | null;
  action: "compile" | "publish";
}): PostingSessionOwnershipError | null {
  const sessionPosterAddress = normalizePosterAddress(input.sessionPosterAddress);
  if (!sessionPosterAddress) {
    return null;
  }

  const requesterAddress = normalizePosterAddress(input.requesterAddress);
  if (!requesterAddress) {
    return {
      status: 401,
      code: "POSTING_SESSION_ADDRESS_REQUIRED",
      message: `This posting session is already bound to wallet ${sessionPosterAddress}. Next step: reconnect that wallet and retry ${input.action}.`,
    };
  }

  if (requesterAddress !== sessionPosterAddress) {
    return {
      status: 403,
      code: "POSTING_SESSION_ADDRESS_MISMATCH",
      message: `This posting session belongs to wallet ${sessionPosterAddress}. Next step: switch back to that wallet and retry ${input.action}.`,
    };
  }

  return null;
}
