import { CHAIN_IDS } from "@agora/common";
import type { Chain } from "viem";
import { base, baseSepolia, foundry } from "viem/chains";

export function resolveAgoraViemChain(chainId: number): Chain {
  if (chainId === CHAIN_IDS.localAnvil) {
    return foundry;
  }
  if (chainId === CHAIN_IDS.baseMainnet) {
    return base;
  }
  return baseSepolia;
}
