import { erc20Abi } from "@agora/common";
import { useEffect, useState } from "react";
import { parseUnits } from "viem";
import type { usePublicClient } from "wagmi";
import { formatUsdcUnits } from "../../lib/format";

export const DEFAULT_PERMIT_VERSION = "1";
export const APPROVAL_REFRESH_ATTEMPTS = 6;
export const APPROVAL_REFRESH_DELAY_MS = 750;

export type FundingMethod = "permit" | "approve";
export type FundingStatus = "idle" | "checking" | "ready" | "error";
export type PostingFundingState = {
  status: FundingStatus;
  method: FundingMethod;
  tokenName: string;
  permitVersion: string;
  allowance: bigint;
  balance: bigint;
  message?: string;
};

type WalletPublicClient = Pick<
  NonNullable<ReturnType<typeof usePublicClient>>,
  "readContract"
>;

const initialPostingFundingState: PostingFundingState = {
  status: "idle",
  method: "approve",
  tokenName: "USDC",
  permitVersion: DEFAULT_PERMIT_VERSION,
  allowance: 0n,
  balance: 0n,
};

export function getRewardUnitsFromInput(reward: string) {
  return parseUnits(reward.trim() || "0", 6);
}

export async function loadPostingFundingState({
  publicClient,
  address,
  usdcAddress,
  factoryAddress,
  rewardUnits,
}: {
  publicClient: WalletPublicClient;
  address: `0x${string}`;
  usdcAddress: `0x${string}`;
  factoryAddress: `0x${string}`;
  rewardUnits: bigint;
}): Promise<PostingFundingState> {
  const [
    balanceResult,
    allowanceResult,
    nameResult,
    noncesResult,
    domainSeparatorResult,
    versionResult,
  ] = await Promise.allSettled([
    publicClient.readContract({
      address: usdcAddress,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [address],
    }),
    publicClient.readContract({
      address: usdcAddress,
      abi: erc20Abi,
      functionName: "allowance",
      args: [address, factoryAddress],
    }),
    publicClient.readContract({
      address: usdcAddress,
      abi: erc20Abi,
      functionName: "name",
    }),
    publicClient.readContract({
      address: usdcAddress,
      abi: erc20Abi,
      functionName: "nonces",
      args: [address],
    }),
    publicClient.readContract({
      address: usdcAddress,
      abi: erc20Abi,
      functionName: "DOMAIN_SEPARATOR",
    }),
    publicClient.readContract({
      address: usdcAddress,
      abi: erc20Abi,
      functionName: "version",
    }),
  ]);

  if (
    balanceResult.status !== "fulfilled" ||
    allowanceResult.status !== "fulfilled"
  ) {
    return {
      ...initialPostingFundingState,
      status: "error",
      message: "Unable to read token balance or allowance.",
    };
  }

  const tokenName =
    nameResult.status === "fulfilled" ? String(nameResult.value) : "USDC";
  const permitSupported =
    nameResult.status === "fulfilled" &&
    noncesResult.status === "fulfilled" &&
    domainSeparatorResult.status === "fulfilled";

  const balance = balanceResult.value as bigint;
  const allowance = allowanceResult.value as bigint;

  if (balance < rewardUnits) {
    return {
      status: "ready",
      method: permitSupported ? "permit" : "approve",
      tokenName,
      permitVersion:
        versionResult.status === "fulfilled"
          ? String(versionResult.value)
          : DEFAULT_PERMIT_VERSION,
      allowance,
      balance,
      message: `Wallet needs ${formatUsdcUnits(rewardUnits - balance)} more USDC.`,
    };
  }

  return {
    status: "ready",
    method: permitSupported ? "permit" : "approve",
    tokenName,
    permitVersion:
      versionResult.status === "fulfilled"
        ? String(versionResult.value)
        : DEFAULT_PERMIT_VERSION,
    allowance,
    balance,
  };
}

export function isPermitUnsupportedError(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("typed data") ||
    normalized.includes("sign typed data") ||
    normalized.includes("eth_signtypeddata") ||
    normalized.includes("method not supported") ||
    normalized.includes("unsupported method") ||
    normalized.includes("not implemented") ||
    normalized.includes("does not support")
  );
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getFundingSummaryMessage({
  fundingState,
  balanceReady,
  allowanceReady,
}: {
  fundingState: PostingFundingState;
  balanceReady: boolean;
  allowanceReady: boolean;
}) {
  if (fundingState.status === "checking") {
    return "Checking token support and allowance...";
  }
  if (fundingState.status === "error") {
    return fundingState.message ?? "Unable to determine posting flow.";
  }
  if (!balanceReady) {
    return fundingState.message ?? "Wallet balance is too low for this reward.";
  }
  if (fundingState.method === "permit" && !allowanceReady) {
    return `${fundingState.tokenName} supports permit. Sign once, then submit the challenge in one transaction.`;
  }
  if (allowanceReady) {
    return "Allowance already covers this reward. You can create the challenge now.";
  }
  return "This token requires approval before challenge creation.";
}

export function usePostFunding({
  showPreview,
  walletReady,
  publicClient,
  address,
  factoryAddress,
  usdcAddress,
  rewardInput,
}: {
  showPreview: boolean;
  walletReady: boolean;
  publicClient: NonNullable<ReturnType<typeof usePublicClient>> | undefined;
  address: `0x${string}` | undefined;
  factoryAddress: `0x${string}` | undefined;
  usdcAddress: `0x${string}` | undefined;
  rewardInput: string;
}) {
  const [fundingState, setFundingState] = useState<PostingFundingState>(
    initialPostingFundingState,
  );
  const previewRewardUnits = (() => {
    try {
      return getRewardUnitsFromInput(rewardInput);
    } catch {
      return 0n;
    }
  })();
  const allowanceReady = fundingState.allowance >= previewRewardUnits;
  const balanceReady = fundingState.balance >= previewRewardUnits;

  useEffect(() => {
    if (!showPreview) {
      setFundingState(initialPostingFundingState);
      return;
    }
    if (
      !walletReady ||
      !publicClient ||
      !address ||
      !factoryAddress ||
      !usdcAddress
    ) {
      setFundingState(initialPostingFundingState);
      return;
    }
    const checkedPublicClient = publicClient;
    const checkedAddress = address;
    const checkedFactoryAddress = factoryAddress;
    const checkedUsdcAddress = usdcAddress;

    let cancelled = false;

    async function checkFundingPath() {
      setFundingState((current) => ({
        ...current,
        status: "checking",
        message: undefined,
      }));

      try {
        const nextState = await loadPostingFundingState({
          publicClient: checkedPublicClient,
          address: checkedAddress,
          usdcAddress: checkedUsdcAddress,
          factoryAddress: checkedFactoryAddress,
          rewardUnits: previewRewardUnits,
        });
        if (!cancelled) {
          setFundingState(nextState);
        }
      } catch {
        if (!cancelled) {
          setFundingState({
            ...initialPostingFundingState,
            status: "error",
            message: "Unable to determine the posting flow for this token.",
          });
        }
      }
    }

    void checkFundingPath();

    return () => {
      cancelled = true;
    };
  }, [
    address,
    factoryAddress,
    previewRewardUnits,
    publicClient,
    showPreview,
    usdcAddress,
    walletReady,
  ]);

  async function refreshPostingFundingState(rewardUnits: bigint) {
    if (
      !walletReady ||
      !publicClient ||
      !address ||
      !factoryAddress ||
      !usdcAddress
    ) {
      setFundingState(initialPostingFundingState);
      return initialPostingFundingState;
    }
    const checkedPublicClient = publicClient;
    const checkedAddress = address;
    const checkedFactoryAddress = factoryAddress;
    const checkedUsdcAddress = usdcAddress;

    const nextState = await loadPostingFundingState({
      publicClient: checkedPublicClient,
      address: checkedAddress,
      usdcAddress: checkedUsdcAddress,
      factoryAddress: checkedFactoryAddress,
      rewardUnits,
    });
    setFundingState(nextState);
    return nextState;
  }

  async function waitForAllowanceUpdate(rewardUnits: bigint) {
    let latestFunding = await refreshPostingFundingState(rewardUnits);
    if (latestFunding.allowance >= rewardUnits) {
      return latestFunding;
    }

    for (let attempt = 1; attempt < APPROVAL_REFRESH_ATTEMPTS; attempt += 1) {
      await wait(APPROVAL_REFRESH_DELAY_MS);
      latestFunding = await refreshPostingFundingState(rewardUnits);
      if (latestFunding.allowance >= rewardUnits) {
        return latestFunding;
      }
    }

    throw new Error(
      "Allowance confirmation is still catching up on-chain. Wait a moment, then retry Create Challenge.",
    );
  }

  return {
    fundingState,
    setFundingState,
    previewRewardUnits,
    allowanceReady,
    balanceReady,
    refreshPostingFundingState,
    waitForAllowanceUpdate,
  };
}
