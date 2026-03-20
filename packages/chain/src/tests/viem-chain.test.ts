import assert from "node:assert/strict";
import test from "node:test";
import { CHAIN_IDS } from "@agora/common";
import { resolveAgoraViemChain } from "../viem-chain.js";

test("resolveAgoraViemChain returns foundry for local Anvil", () => {
  const chain = resolveAgoraViemChain(CHAIN_IDS.localAnvil);
  assert.equal(chain.id, CHAIN_IDS.localAnvil);
  assert.equal(chain.name, "Foundry");
});

test("resolveAgoraViemChain returns Base for mainnet", () => {
  const chain = resolveAgoraViemChain(CHAIN_IDS.baseMainnet);
  assert.equal(chain.id, CHAIN_IDS.baseMainnet);
  assert.equal(chain.name, "Base");
});

test("resolveAgoraViemChain defaults to Base Sepolia for supported testnets", () => {
  const chain = resolveAgoraViemChain(CHAIN_IDS.baseSepolia);
  assert.equal(chain.id, CHAIN_IDS.baseSepolia);
  assert.equal(chain.name, "Base Sepolia");
});
