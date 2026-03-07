import { keccak256, toBytes } from "viem";

export const PIN_SPEC_AUTH_MAX_AGE_MS = 5 * 60 * 1000;

export const PIN_SPEC_AUTH_TYPES = {
  PinSpecAuthorization: [
    { name: "wallet", type: "address" },
    { name: "specHash", type: "bytes32" },
    { name: "nonce", type: "string" },
  ],
} as const;

export function computeSpecHash(spec: unknown): `0x${string}` {
  return keccak256(toBytes(JSON.stringify(spec)));
}

export function getPinSpecAuthorizationTypedData(input: {
  chainId: number;
  wallet: `0x${string}`;
  specHash: `0x${string}`;
  nonce: string;
}) {
  return {
    domain: {
      name: "Hermes",
      version: "1",
      chainId: input.chainId,
    },
    types: PIN_SPEC_AUTH_TYPES,
    primaryType: "PinSpecAuthorization" as const,
    message: {
      wallet: input.wallet.toLowerCase() as `0x${string}`,
      specHash: input.specHash,
      nonce: input.nonce,
    },
  };
}
