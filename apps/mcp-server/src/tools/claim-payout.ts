import { claimChallengePayout } from "./shared.js";

export async function agoraClaimPayout(
  input: { challengeId: string; privateKey?: string },
  options: { allowRemotePrivateKey: boolean },
) {
  return claimChallengePayout({
    ...input,
    allowRemotePrivateKey: options.allowRemotePrivateKey,
  });
}
