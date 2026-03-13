import type { Abi } from "viem";
import type { getPublicClient } from "./client.js";

export function isMissingHistoricalBlockError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /header not found|block not found|unknown block/i.test(message);
}

type ContractReadInput = {
  publicClient: ReturnType<typeof getPublicClient>;
  address: `0x${string}`;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
  blockNumber?: bigint;
};

export async function readContractStrict<T>(
  input: ContractReadInput,
): Promise<T> {
  return input.publicClient.readContract({
    address: input.address,
    abi: input.abi,
    functionName: input.functionName as never,
    ...(input.args ? { args: input.args as never } : {}),
    ...(input.blockNumber !== undefined ? { blockNumber: input.blockNumber } : {}),
  } as never) as Promise<T>;
}

export async function readImmutableContractWithLatestFallback<T>(
  input: ContractReadInput,
): Promise<T> {
  try {
    return await readContractStrict<T>(input);
  } catch (error) {
    if (
      input.blockNumber === undefined ||
      !isMissingHistoricalBlockError(error)
    ) {
      throw error;
    }

    return readContractStrict<T>({
      ...input,
      blockNumber: undefined,
    });
  }
}
