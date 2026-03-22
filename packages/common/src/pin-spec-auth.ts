import { keccak256, toBytes } from "viem";

export const PIN_SPEC_AUTH_MAX_AGE_MS = 5 * 60 * 1000;

export const PIN_SPEC_AUTH_TYPES = {
  PinSpecAuthorization: [
    { name: "wallet", type: "address" },
    { name: "specHash", type: "bytes32" },
    { name: "nonce", type: "string" },
  ],
} as const;

function normalizeJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeJsonValue(entry));
  }

  if (
    value &&
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, normalizeJsonValue(entry)]),
    );
  }

  return value;
}

export function computeSpecHash(spec: unknown): `0x${string}` {
  return keccak256(toBytes(JSON.stringify(normalizeJsonValue(spec))));
}

export function getPinSpecAuthorizationTypedData(input: {
  chainId: number;
  wallet: `0x${string}`;
  specHash: `0x${string}`;
  nonce: string;
}) {
  return {
    domain: {
      name: "Agora",
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
