import { getPublicClient } from "@agora/chain";
import { AGORA_ERROR_CODES, AgoraError, CHAIN_IDS } from "@agora/common";
import { formatEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  applyConfigToEnv,
  getEnvReferenceName,
  loadCliConfig,
  requireConfigValues,
  resolveConfigValue,
} from "./config-store";

export function deriveWalletAddress(privateKey: string): `0x${string}` {
  return privateKeyToAccount(privateKey as `0x${string}`).address;
}

export function resolveConfiguredPrivateKeyOptional() {
  const config = loadCliConfig();
  return resolveConfigValue(config.private_key);
}

export function resolveOptionalSolverAddress(addressArg?: string) {
  if (addressArg) {
    if (!/^0x[a-fA-F0-9]{40}$/.test(addressArg)) {
      throw new AgoraError(
        "Solver address must be a 0x-prefixed wallet address.",
        {
          code: AGORA_ERROR_CODES.invalidSolverAddress,
          nextAction: "Pass --address 0x... and retry.",
        },
      );
    }
    return addressArg.toLowerCase() as `0x${string}`;
  }

  const privateKey = resolveConfiguredPrivateKeyOptional();
  if (!privateKey) {
    return null;
  }

  return deriveWalletAddress(privateKey).toLowerCase() as `0x${string}`;
}

export function resolvePrivateKeyFromArg(keyArg?: string): string | undefined {
  if (!keyArg) return undefined;
  const envName = getEnvReferenceName(keyArg);
  if (!envName) {
    throw new AgoraError("Private key must be provided via env:VAR_NAME.", {
      code: AGORA_ERROR_CODES.invalidPrivateKeyReference,
      nextAction:
        "Pass --key env:AGORA_PRIVATE_KEY or export AGORA_PRIVATE_KEY and retry.",
    });
  }
  const value = process.env[envName];
  if (!value) {
    throw new AgoraError(`Environment variable ${envName} is not set.`, {
      code: AGORA_ERROR_CODES.missingPrivateKeyEnv,
      nextAction: `Export ${envName}=0x... and retry.`,
      details: { envName },
    });
  }
  return value;
}

export function prepareAgoraEnv(
  requiredKeys: (keyof ReturnType<typeof loadCliConfig>)[],
) {
  const config = loadCliConfig();
  applyConfigToEnv(config);
  requireConfigValues(config, requiredKeys);
  return config;
}

export function ensurePrivateKey(keyArg?: string) {
  const config = loadCliConfig();
  const resolved =
    resolvePrivateKeyFromArg(keyArg) ?? resolveConfigValue(config.private_key);
  if (resolved) {
    process.env.AGORA_PRIVATE_KEY = resolved;
    return resolved;
  }
  const configEnvName = getEnvReferenceName(config.private_key);
  if (configEnvName) {
    throw new AgoraError(`Environment variable ${configEnvName} is not set.`, {
      code: AGORA_ERROR_CODES.missingPrivateKeyEnv,
      nextAction: `Export ${configEnvName}=0x... and retry.`,
      details: { envName: configEnvName },
    });
  }
  throw new AgoraError("No private key available.", {
    code: AGORA_ERROR_CODES.missingPrivateKeyEnv,
    nextAction: "Set AGORA_PRIVATE_KEY or use --key env:AGORA_PRIVATE_KEY.",
  });
}

export function getGasTopUpHint(chainId: number | undefined) {
  if (chainId === CHAIN_IDS.baseSepolia) {
    return "https://docs.base.org/tools/network-faucets";
  }
  return null;
}

export async function readWalletGasBalance(address: `0x${string}`) {
  return getPublicClient().getBalance({ address });
}

export function formatWalletGasBalance(balance: bigint) {
  return `${formatEther(balance)} ETH`;
}

export async function assertWalletHasGasBalance(input: {
  address: `0x${string}`;
  chainId?: number;
  actionLabel: string;
}) {
  const balance = await readWalletGasBalance(input.address);
  if (balance > 0n) {
    return balance;
  }

  const faucet = getGasTopUpHint(input.chainId);
  const faucetHint = faucet ? ` via ${faucet}` : "";
  throw new AgoraError(
    `Wallet ${input.address} has 0 ETH for ${input.actionLabel} gas.`,
    {
      code: AGORA_ERROR_CODES.insufficientGas,
      nextAction: `Fund it with native gas${faucetHint} and retry.`,
      details: {
        address: input.address,
        action: input.actionLabel,
        faucetUrl: faucet,
      },
    },
  );
}
