import { normalizeOptionalAddress } from "@agora/common";

export const normalizeSessionAddress = normalizeOptionalAddress;

export function getMatchingOptionalSessionAddress(
  sessionAddress: string | null | undefined,
  expectedAddress: string,
) {
  const normalizedSession = normalizeSessionAddress(sessionAddress);
  const normalizedExpected = expectedAddress.toLowerCase();
  return normalizedSession === normalizedExpected ? normalizedSession : null;
}
