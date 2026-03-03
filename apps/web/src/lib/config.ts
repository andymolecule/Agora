import { DEFAULT_CHAIN_ID } from "@hermes/common";

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_HERMES_API_URL ?? "http://localhost:3000";

export const FACTORY_ADDRESS = (process.env
  .NEXT_PUBLIC_HERMES_FACTORY_ADDRESS ?? "") as `0x${string}`;

export const USDC_ADDRESS = (process.env.NEXT_PUBLIC_HERMES_USDC_ADDRESS ??
  "") as `0x${string}`;

export const CHAIN_ID = Number(
  process.env.NEXT_PUBLIC_HERMES_CHAIN_ID ?? DEFAULT_CHAIN_ID,
);

export const RPC_URL =
  process.env.NEXT_PUBLIC_HERMES_RPC_URL ?? "https://sepolia.base.org";
