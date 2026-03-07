// Skip early if required env vars are missing — check raw process.env
// because loadConfig() will throw on missing required vars.
if (
  !process.env.AGORA_RPC_URL ||
  !process.env.AGORA_FACTORY_ADDRESS ||
  !process.env.AGORA_USDC_ADDRESS
) {
  console.log(
    "SKIP: Chain test requires AGORA_RPC_URL + AGORA_FACTORY_ADDRESS + AGORA_USDC_ADDRESS",
  );
  process.exit(0);
}

import type { Abi } from "viem";

const { loadConfig } = await import("@agora/common");
const AgoraFactoryAbiJson = (
  await import("@agora/common/abi/AgoraFactory.json")
).default;
const { createAgoraPublicClient } = await import("../client");

const config = loadConfig();
const AgoraFactoryAbi = AgoraFactoryAbiJson as unknown as Abi;
const publicClient = createAgoraPublicClient();

const count = await publicClient.readContract({
  address: config.AGORA_FACTORY_ADDRESS as `0x${string}`,
  abi: AgoraFactoryAbi,
  functionName: "challengeCount",
  args: [],
});

console.log(`PASS: Chain read ok (challengeCount=${count})`);
