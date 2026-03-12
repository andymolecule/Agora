export function getChallengePostSuccessStatus(txHash: `0x${string}`) {
  return `success: Challenge posted. tx=${txHash}. Indexed immediately.`;
}

export function getChallengePostIndexingFailureStatus(
  txHash: `0x${string}`,
  message: string,
) {
  const detail =
    message.trim().length > 0 ? message : "Unknown registration error.";
  return `Challenge confirmed on-chain (tx=${txHash}), but Agora could not register it immediately: ${detail} Next step: wait for the indexer to catch up and refresh the challenge list, or retry /api/challenges with this tx hash if you operate the API.`;
}
