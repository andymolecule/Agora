import { erc20Abi } from "@agora/common";
import { useChainModal, useConnectModal } from "@rainbow-me/rainbowkit";
import { useState } from "react";
import {
  useAccount,
  usePublicClient,
  useSignTypedData,
  useWriteContract,
} from "wagmi";
import {
  type ChallengePostStatus,
  createChallengePostStatus,
} from "../../lib/challenge-post";
import { CHAIN_ID, FACTORY_ADDRESS, USDC_ADDRESS } from "../../lib/config";
import { computeProtocolFee } from "../../lib/format";
import {
  APP_CHAIN_NAME,
  getWrongChainMessage,
  isWrongWalletChain,
} from "../../lib/wallet/network";
import {
  getErrorMessage,
  isUserRejectedError,
  simulateAndWriteContract,
  waitForTransactionReceiptWithTimeout,
} from "../../lib/wallet/tx";
import {
  assertFactoryIsSupported,
  createChallengeWithApproval,
  createChallengeWithPermit,
  finalizeChallengePost,
  prepareChallengeCreation,
  signRewardPermit,
} from "./post-create-flow";
import { usePostFormState } from "./post-form-state";
import {
  getRewardUnitsFromInput,
  isPermitUnsupportedError,
  usePostFunding,
} from "./post-funding";
import { isCustomChallengeType, validatePostForm } from "./post-validation";

export type PendingAction = "idle" | "approving" | "signingPermit" | "creating";

export function usePostClientController() {
  const form = usePostFormState();
  const [status, setStatus] = useState<ChallengePostStatus | null>(null);
  const [postedChallengeId, setPostedChallengeId] = useState<string | null>(
    null,
  );
  const [pendingAction, setPendingAction] = useState<PendingAction>("idle");

  const { isConnected, chainId, address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { signTypedDataAsync } = useSignTypedData();
  const { openConnectModal } = useConnectModal();
  const { openChainModal } = useChainModal();

  const isWrongChain = isConnected && isWrongWalletChain(chainId);
  const walletReady = isConnected && !isWrongChain;
  const isBusy = pendingAction !== "idle";
  const hasPostedOnChain = status?.postedOnChain ?? false;
  const rewardValue = Number(form.state.reward || 0);
  const { feeUsdc: protocolFeeValue, payoutUsdc: winnerPayoutValue } =
    computeProtocolFee(rewardValue);
  const isCustomType = isCustomChallengeType(form.state.type);

  const {
    fundingState,
    setFundingState,
    allowanceReady,
    balanceReady,
    refreshPostingFundingState,
    waitForAllowanceUpdate,
  } = usePostFunding({
    showPreview: form.showPreview,
    walletReady,
    publicClient,
    address: address as `0x${string}` | undefined,
    factoryAddress: FACTORY_ADDRESS,
    usdcAddress: USDC_ADDRESS,
    rewardInput: form.state.reward,
  });

  function clearPostStatus() {
    setStatus(null);
    setPostedChallengeId(null);
  }

  async function handleFileUpload(
    file: File,
    field: "train" | "test" | "hiddenLabels",
  ) {
    setStatus(null);
    await form.handleFileUpload(file, field, (message) => {
      setStatus(
        createChallengePostStatus(`Upload failed: ${message}`, {
          tone: "error",
        }),
      );
    });
  }

  async function handleApprove() {
    if (
      hasPostedOnChain ||
      !walletReady ||
      !publicClient ||
      !address ||
      !FACTORY_ADDRESS ||
      !USDC_ADDRESS
    ) {
      return;
    }

    if (isWrongChain) {
      setStatus(
        createChallengePostStatus(getWrongChainMessage(chainId), {
          tone: "error",
        }),
      );
      return;
    }

    try {
      setPendingAction("approving");
      clearPostStatus();

      const validationError = validatePostForm(form.state);
      if (validationError) {
        throw new Error(validationError);
      }

      const rewardUnits = getRewardUnitsFromInput(form.state.reward);
      const latestFunding = await refreshPostingFundingState(rewardUnits);
      if (latestFunding.balance < rewardUnits) {
        throw new Error(latestFunding.message ?? "Insufficient USDC balance.");
      }
      if (latestFunding.allowance >= rewardUnits) {
        setStatus(
          createChallengePostStatus(
            "USDC allowance already confirmed. Click Create Challenge to continue.",
          ),
        );
        return;
      }

      setStatus(createChallengePostStatus("Approve USDC in your wallet..."));
      const approveTx = await simulateAndWriteContract({
        publicClient,
        writeContractAsync,
        account: address,
        address: USDC_ADDRESS,
        abi: erc20Abi,
        functionName: "approve",
        args: [FACTORY_ADDRESS, rewardUnits],
      });
      setStatus(
        createChallengePostStatus(
          "Approval submitted. Waiting for confirmation...",
        ),
      );
      await waitForTransactionReceiptWithTimeout({
        publicClient,
        hash: approveTx,
      });

      await waitForAllowanceUpdate(rewardUnits);
      setStatus(
        createChallengePostStatus(
          "USDC approved. Click Create Challenge to post on-chain.",
        ),
      );
    } catch (error) {
      const message = isUserRejectedError(error)
        ? "Transaction cancelled."
        : getErrorMessage(error, "Approval failed.");
      setStatus(createChallengePostStatus(message, { tone: "error" }));
    } finally {
      setPendingAction("idle");
    }
  }

  async function handleCreate() {
    if (
      hasPostedOnChain ||
      !walletReady ||
      !publicClient ||
      !address ||
      !FACTORY_ADDRESS ||
      !USDC_ADDRESS
    ) {
      return;
    }

    if (isWrongChain) {
      setStatus(
        createChallengePostStatus(getWrongChainMessage(chainId), {
          tone: "error",
        }),
      );
      return;
    }

    try {
      clearPostStatus();

      const validationError = validatePostForm(form.state);
      if (validationError) {
        throw new Error(validationError);
      }

      const rewardUnits = getRewardUnitsFromInput(form.state.reward);
      const latestFunding = await refreshPostingFundingState(rewardUnits);
      if (latestFunding.balance < rewardUnits) {
        throw new Error(latestFunding.message ?? "Insufficient USDC balance.");
      }

      await assertFactoryIsSupported({
        publicClient,
        factoryAddress: FACTORY_ADDRESS,
      });

      if (
        latestFunding.method === "permit" &&
        latestFunding.allowance < rewardUnits
      ) {
        setPendingAction("signingPermit");
        setStatus(
          createChallengePostStatus(
            `Sign ${latestFunding.tokenName} permit in your wallet...`,
          ),
        );

        let permit: Awaited<ReturnType<typeof signRewardPermit>>;
        try {
          permit = await signRewardPermit({
            publicClient,
            address,
            tokenName: latestFunding.tokenName,
            permitVersion: latestFunding.permitVersion,
            chainId: CHAIN_ID,
            usdcAddress: USDC_ADDRESS,
            factoryAddress: FACTORY_ADDRESS,
            rewardUnits,
            signTypedDataAsync,
          });
        } catch (error) {
          const permitMessage = getErrorMessage(
            error,
            "Permit signature failed.",
          );
          if (isUserRejectedError(error)) {
            throw error;
          }
          if (isPermitUnsupportedError(permitMessage)) {
            setFundingState((current) => ({
              ...current,
              method: "approve",
              status: "ready",
              message:
                "Wallet cannot sign token permits. Approve USDC first, then create the challenge.",
            }));
            setStatus(
              createChallengePostStatus(
                "Wallet cannot sign token permits. Approve USDC first, then create the challenge.",
                {
                  tone: "warning",
                },
              ),
            );
            return;
          }
          throw error;
        }

        const prepared = await prepareChallengeCreation({
          state: form.state,
          address,
          chainId: CHAIN_ID,
          setStatus,
          signTypedDataAsync,
        });

        setPendingAction("creating");
        setStatus(createChallengePostStatus("Creating challenge on-chain..."));
        const createTx = await createChallengeWithPermit({
          publicClient,
          writeContractAsync,
          address,
          factoryAddress: FACTORY_ADDRESS,
          prepared,
          permit,
        });
        await finalizeChallengePost({
          createTx,
          publicClient,
          setStatus,
          setPostedChallengeId,
        });
        return;
      }

      if (latestFunding.allowance < rewardUnits) {
        throw new Error("Approve USDC before creating the challenge.");
      }

      const prepared = await prepareChallengeCreation({
        state: form.state,
        address,
        chainId: CHAIN_ID,
        setStatus,
        signTypedDataAsync,
      });
      setPendingAction("creating");
      setStatus(createChallengePostStatus("Creating challenge on-chain..."));
      const createTx = await createChallengeWithApproval({
        publicClient,
        writeContractAsync,
        address,
        factoryAddress: FACTORY_ADDRESS,
        prepared,
      });
      await finalizeChallengePost({
        createTx,
        publicClient,
        setStatus,
        setPostedChallengeId,
      });
    } catch (error) {
      const message = isUserRejectedError(error)
        ? "Transaction cancelled."
        : getErrorMessage(error, "Failed to post challenge.");
      if (
        message.includes("USDC_TRANSFER_FAILED") ||
        message.includes("TransferFromFailed")
      ) {
        setStatus(
          createChallengePostStatus(
            "createChallenge reverted during USDC transfer. Confirm the connected wallet still has enough USDC and allowance for the factory.",
            {
              tone: "error",
            },
          ),
        );
      } else {
        setStatus(createChallengePostStatus(message, { tone: "error" }));
      }
      setPostedChallengeId(null);
    } finally {
      setPendingAction("idle");
    }
  }

  function handlePrimarySubmitAction() {
    if (!isConnected) {
      openConnectModal?.();
      return;
    }
    if (isWrongChain) {
      openChainModal?.();
      return;
    }
    const validationError = validatePostForm(form.state);
    if (validationError) {
      setStatus(createChallengePostStatus(validationError, { tone: "error" }));
      return;
    }
    form.setShowPreview(true);
  }

  const postingCtaLabel = !isConnected
    ? "Connect Wallet to Deploy"
    : isWrongChain
      ? `Switch to ${APP_CHAIN_NAME}`
      : "Confirm & Publish Challenge";

  const postingCtaDisabled =
    isBusy ||
    (!isConnected && !openConnectModal) ||
    (isWrongChain && !openChainModal) ||
    (isConnected && !isWrongChain && !walletReady);

  return {
    ...form,
    status,
    postedChallengeId,
    pendingAction,
    fundingState,
    isConnected,
    chainId,
    isWrongChain,
    isBusy,
    hasPostedOnChain,
    rewardValue,
    protocolFeeValue,
    winnerPayoutValue,
    allowanceReady,
    balanceReady,
    isCustomType,
    postingCtaLabel,
    postingCtaDisabled,
    handleFileUpload,
    handleApprove,
    handleCreate,
    handlePrimarySubmitAction,
  };
}

export type PostClientController = ReturnType<typeof usePostClientController>;
