function normalizeCursorAddress(address: string) {
  return address.toLowerCase();
}

export function buildFactoryCursorKey(chainId: number, factoryAddress: string) {
  return `factory:${chainId}:${normalizeCursorAddress(factoryAddress)}`;
}

export function buildFactoryHighWaterCursorKey(
  chainId: number,
  factoryAddress: string,
) {
  return `factory-head:${chainId}:${normalizeCursorAddress(factoryAddress)}`;
}

export function buildChallengeCursorKey(
  chainId: number,
  challengeAddress: string,
) {
  return `challenge:${chainId}:${normalizeCursorAddress(challengeAddress)}`;
}
