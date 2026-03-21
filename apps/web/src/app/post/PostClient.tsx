"use client";

import { useChainModal, useConnectModal } from "@rainbow-me/rainbowkit";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import {
  useAccount,
  usePublicClient,
  useSignTypedData,
  useWriteContract,
} from "wagmi";
import { CHAIN_ID, FACTORY_ADDRESS, USDC_ADDRESS } from "../../lib/config";
import { computeProtocolFee } from "../../lib/format";
import { getSubmissionDeadlineWindowState } from "../../lib/post-submission-window";
import {
  APP_CHAIN_NAME,
  getWrongChainMessage,
  isWrongWalletChain,
} from "../../lib/wallet/network";
import {
  getErrorMessage,
  isUserRejectedError,
  waitForTransactionReceiptWithTimeout,
} from "../../lib/wallet/tx";
import { GuidedComposer } from "./GuidedComposer";
import {
  ExpertModePanel,
  PostNotice,
  PostStepIndicator,
  PostingActionBar,
  PostingModeSection,
  PublishStep,
  ReviewStep,
} from "./PostSections";
import type { PostStep } from "./PostSections";
import {
  approveUsdc,
  assertFactoryIsSupported,
  createChallengeWithApproval,
  createChallengeWithPermit,
  finalizeManagedChallengePost,
  publishManagedAuthoringDraft,
  signRewardPermit,
} from "./managed-post-flow";
import {
  getFundingSummaryMessage,
  getRewardUnitsFromInput,
  isPermitUnsupportedError,
  usePostFunding,
} from "./post-funding";
import { usePostAuthoringWorkflow } from "./use-post-authoring";

type Step = PostStep;
type DeadlineWindowState = ReturnType<typeof getSubmissionDeadlineWindowState>;

function getDeadlineWindowMessage(state: DeadlineWindowState) {
  switch (state) {
    case "expired":
      return "This compiled submission deadline has already passed. Next step: regenerate the contract to lock a fresh submission window.";
    case "too_close":
      return "This compiled submission deadline is too close to publish safely. Next step: regenerate the contract to refresh the submission window.";
    case "invalid":
      return "This compiled deadline is invalid. Next step: regenerate the contract before publishing.";
    case "ok":
      return null;
  }
}

function buildHostReturnUrl(input: {
  baseUrl: string | null;
  draftId: string;
  challengeId: string;
  specCid: string;
}) {
  if (!input.baseUrl) {
    return null;
  }

  const url = new URL(input.baseUrl);
  url.searchParams.set("agora_event", "challenge_live");
  url.searchParams.set("agora_draft_id", input.draftId);
  url.searchParams.set("agora_challenge_id", input.challengeId);
  url.searchParams.set("agora_spec_cid", input.specCid);
  if (typeof window !== "undefined") {
    url.searchParams.set(
      "agora_challenge_url",
      `${window.location.origin}/challenges/${input.challengeId}`,
    );
  }
  return url.toString();
}

/* ── Main component ────────────────────────────────────── */

export function PostClient() {
  const searchParams = useSearchParams();
  const [isPublishing, setIsPublishing] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [postedChallengeId, setPostedChallengeId] = useState<string | null>(
    null,
  );
  const [hostReturnUrl, setHostReturnUrl] = useState<string | null>(null);
  const [hostReturnSource, setHostReturnSource] = useState<
    "requested" | "origin_external_url" | null
  >(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [expertMode, setExpertMode] = useState(false);

  const { isConnected, chainId, address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { signTypedDataAsync } = useSignTypedData();
  const { openConnectModal } = useConnectModal();
  const { openChainModal } = useChainModal();

  const hostedDraftId = searchParams.get("draft")?.trim() || null;
  const requestedReturnTo = searchParams.get("return_to")?.trim() || null;
  const {
    step,
    setStep,
    guidedState,
    managedIntent,
    session,
    compilation,
    clarificationQuestions,
    compileReady,
    isCompiling,
    statusMessage,
    setStatusMessage,
    errorMessage,
    setErrorMessage,
    isHostedDraftFlow,
    handlePromptAnswer,
    handleSkipOptionalPrompt,
    handleEditPrompt,
    handleTitleChange,
    handleFilesSelected,
    handleRenameUpload,
    handleRemoveUpload,
    handleConfirmUploads,
    handleCompile,
    handleRefreshCompiledDeadline,
    clearPersistedDraft,
  } = usePostAuthoringWorkflow({
    hostedDraftId,
    posterAddress: address as `0x${string}` | undefined,
    persistDraft: !expertMode,
    onRemoteDraftCleared: () => {
      setHostReturnUrl(null);
      setHostReturnSource(null);
    },
  });
  const rewardInput =
    compilation?.challenge_spec.reward.total ?? managedIntent.rewardTotal;
  const deadlineWindowState =
    compilation?.challenge_spec.deadline != null
      ? getSubmissionDeadlineWindowState(compilation.challenge_spec.deadline)
      : null;
  const deadlineWindowMessage =
    deadlineWindowState != null
      ? getDeadlineWindowMessage(deadlineWindowState)
      : null;
  const needsDeadlineRefresh =
    deadlineWindowState === "expired" ||
    deadlineWindowState === "too_close" ||
    deadlineWindowState === "invalid";
  const { feeUsdc, payoutUsdc } = computeProtocolFee(Number(rewardInput || 0));
  const isWrongChain = isConnected && isWrongWalletChain(chainId);
  const publicArtifacts =
    compilation?.resolved_artifacts.filter(
      (artifact) => artifact.visibility === "public",
    ) ?? [];
  const privateArtifacts =
    compilation?.resolved_artifacts.filter(
      (artifact) => artifact.visibility === "private",
    ) ?? [];
  const {
    fundingState,
    allowanceReady,
    balanceReady,
    refreshPostingFundingState,
    waitForAllowanceUpdate,
    setFundingState,
  } = usePostFunding({
    showPreview: step === 3,
    walletReady: isConnected && !isWrongChain,
    publicClient,
    address: address as `0x${string}` | undefined,
    factoryAddress: FACTORY_ADDRESS,
    usdcAddress: USDC_ADDRESS,
    rewardInput,
  });
  const fundingSummary = getFundingSummaryMessage({
    fundingState,
    balanceReady,
    allowanceReady,
  });
  const requiresApproval = fundingState.method === "approve" && !allowanceReady;

  function handleSetPostingMode(nextMode: "managed" | "expert") {
    const nextExpertMode = nextMode === "expert";
    if (nextExpertMode === expertMode) {
      return;
    }

    setExpertMode(nextExpertMode);
    setStatusMessage(null);
    setErrorMessage(null);
    setEditingTitle(false);
  }

  async function handleApprove() {
    if (!publicClient || !writeContractAsync || !address) {
      return;
    }

    try {
      setIsApproving(true);
      setErrorMessage(null);
      const rewardUnits = getRewardUnitsFromInput(rewardInput);
      const latestFunding = await refreshPostingFundingState(rewardUnits);
      if (latestFunding.balance < rewardUnits) {
        throw new Error(latestFunding.message ?? "Insufficient USDC balance.");
      }
      if (latestFunding.allowance >= rewardUnits) {
        setStatusMessage("Allowance already covers this reward.");
        return;
      }

      setStatusMessage("Approve USDC in your wallet...");
      const approveTx = await approveUsdc({
        publicClient,
        writeContractAsync,
        address,
        usdcAddress: USDC_ADDRESS,
        factoryAddress: FACTORY_ADDRESS,
        rewardUnits,
      });
      setStatusMessage("Approval submitted. Waiting for confirmation...");
      await waitForTransactionReceiptWithTimeout({
        publicClient,
        hash: approveTx,
      });
      await waitForAllowanceUpdate(rewardUnits);
      setStatusMessage("USDC approved. You can publish the challenge now.");
    } catch (error) {
      setErrorMessage(
        isUserRejectedError(error)
          ? "Approval cancelled."
          : getErrorMessage(error, "Approval failed."),
      );
    } finally {
      setIsApproving(false);
    }
  }

  async function handlePublish() {
    if (!compilation || !publicClient || !writeContractAsync || !address) {
      return;
    }
    if (!session) {
      setErrorMessage("No authoring draft found. Recompile the draft first.");
      return;
    }
    if (needsDeadlineRefresh) {
      setErrorMessage(
        deadlineWindowMessage ??
          "This compiled contract needs a fresh submission window before publish.",
      );
      return;
    }

    try {
      setIsPublishing(true);
      setErrorMessage(null);
      setHostReturnUrl(null);
      setHostReturnSource(null);
      const rewardUnits = getRewardUnitsFromInput(
        compilation.challenge_spec.reward.total,
      );
      const latestFunding = await refreshPostingFundingState(rewardUnits);
      if (latestFunding.balance < rewardUnits) {
        throw new Error(latestFunding.message ?? "Insufficient USDC balance.");
      }
      if (
        latestFunding.method === "approve" &&
        latestFunding.allowance < rewardUnits
      ) {
        throw new Error("Approve USDC before publishing this challenge.");
      }

      await assertFactoryIsSupported({
        publicClient,
        factoryAddress: FACTORY_ADDRESS,
      });

      setStatusMessage("Pinning the compiled challenge spec...");
      const prepared = await publishManagedAuthoringDraft({
        draftId: session.id,
        spec: compilation.challenge_spec,
        address,
        chainId: CHAIN_ID,
        signTypedDataAsync,
        returnTo: requestedReturnTo ?? undefined,
      });

      let createTx: `0x${string}`;
      if (
        latestFunding.method === "permit" &&
        latestFunding.allowance < rewardUnits
      ) {
        setStatusMessage(
          `Sign ${latestFunding.tokenName} permit in your wallet...`,
        );
        try {
          const permit = await signRewardPermit({
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
          setStatusMessage("Creating the challenge on-chain...");
          createTx = await createChallengeWithPermit({
            publicClient,
            writeContractAsync,
            address,
            factoryAddress: FACTORY_ADDRESS,
            prepared,
            permit,
          });
        } catch (error) {
          const permitMessage = getErrorMessage(
            error,
            "Permit signature failed.",
          );
          if (
            !isUserRejectedError(error) &&
            isPermitUnsupportedError(permitMessage)
          ) {
            setFundingState((current) => ({ ...current, method: "approve" }));
          }
          throw error;
        }
      } else {
        setStatusMessage("Creating the challenge on-chain...");
        createTx = await createChallengeWithApproval({
          publicClient,
          writeContractAsync,
          address,
          factoryAddress: FACTORY_ADDRESS,
          prepared,
        });
      }

      setStatusMessage("Waiting for chain confirmation...");
      const registration = await finalizeManagedChallengePost({
        createTx,
        publicClient,
      });
      clearPersistedDraft();
      setPostedChallengeId(registration.challengeId);
      const nextHostReturnUrl = buildHostReturnUrl({
        baseUrl: prepared.returnTo,
        draftId: session.id,
        challengeId: registration.challengeId,
        specCid: prepared.specCid,
      });
      setHostReturnUrl(nextHostReturnUrl);
      setHostReturnSource(prepared.returnToSource);
      if (
        nextHostReturnUrl &&
        prepared.returnToSource === "requested" &&
        requestedReturnTo
      ) {
        setStatusMessage(
          "Challenge published successfully. Redirecting back to the host workflow...",
        );
        window.setTimeout(() => {
          window.location.assign(nextHostReturnUrl);
        }, 2_500);
      } else if (nextHostReturnUrl) {
        setStatusMessage(
          "Challenge published successfully. Use the return link to go back to the host workflow.",
        );
      } else {
        setStatusMessage("Challenge published successfully.");
      }
    } catch (error) {
      setErrorMessage(
        isUserRejectedError(error)
          ? "Publish cancelled."
          : getErrorMessage(error, "Publish failed."),
      );
    } finally {
      setIsPublishing(false);
    }
  }

  const managedReviewTitle = session?.intent?.title ?? managedIntent.title;

  /* ── Render ───────────────────────────────────────────── */

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 pb-24">
      {/* Header */}
      <header className="rounded-[2px] border-2 border-warm-900 bg-white p-6 shadow-[4px_4px_0px_var(--color-warm-900)]">
        <div className="font-mono text-[10px] font-bold uppercase tracking-widest text-warm-500">
          Agora · Post
        </div>
        <h1 className="mt-3 font-display text-[2.25rem] font-bold leading-[0.95] tracking-[-0.03em] text-warm-900 sm:text-[2.75rem]">
          Create a science bounty
        </h1>
        <p className="mt-3 max-w-lg text-[15px] leading-6 text-warm-600">
          Describe your problem, upload data, and Agora compiles a deterministic
          scoring contract.
        </p>
      </header>

      <PostingModeSection
        expertMode={expertMode}
        onSetPostingMode={handleSetPostingMode}
      />

      {/* Notices */}
      {statusMessage ? (
        <PostNotice tone="info">{statusMessage}</PostNotice>
      ) : null}
      {errorMessage ? (
        <PostNotice tone="error">{errorMessage}</PostNotice>
      ) : null}
      {postedChallengeId ? (
        <PostNotice tone="success">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              Challenge published. ID:{" "}
              <span className="font-mono">{postedChallengeId}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {hostReturnUrl ? (
                <a
                  href={hostReturnUrl}
                  className="btn-secondary inline-flex items-center gap-2 rounded-[2px] px-4 py-2 text-xs font-mono font-semibold uppercase tracking-wider"
                >
                  {hostReturnSource === "requested"
                    ? "Return to host"
                    : "Open host thread"}
                  <ArrowRight className="h-3.5 w-3.5" />
                </a>
              ) : null}
              <Link
                href={`/challenges/${postedChallengeId}`}
                className="btn-secondary inline-flex items-center gap-2 rounded-[2px] px-4 py-2 text-xs font-mono font-semibold uppercase tracking-wider"
              >
                View challenge
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>
        </PostNotice>
      ) : null}

      {expertMode ? <ExpertModePanel /> : null}

      {!expertMode ? <PostStepIndicator step={step} /> : null}

      {/* ── Step 1: Describe ───────────────────────────── */}
      {!expertMode && step === 1 ? (
        <GuidedComposer
          state={guidedState}
          clarificationQuestions={clarificationQuestions}
          isCompiling={isCompiling}
          onEditPrompt={handleEditPrompt}
          onAnswerPrompt={handlePromptAnswer}
          onSkipOptionalPrompt={handleSkipOptionalPrompt}
          onFilesSelected={handleFilesSelected}
          onRenameUpload={handleRenameUpload}
          onRemoveUpload={handleRemoveUpload}
          onConfirmUploads={handleConfirmUploads}
        />
      ) : null}

      {/* ── Step 2: Review ─────────────────────────────── */}
      {!expertMode && step === 2 && compilation ? (
        <ReviewStep
          compilation={compilation}
          managedTitle={managedReviewTitle}
          editingTitle={editingTitle}
          titleDraft={titleDraft}
          onTitleDraftChange={setTitleDraft}
          onSaveTitle={() => {
            handleTitleChange(titleDraft);
            setEditingTitle(false);
          }}
          onBeginTitleEdit={() => {
            setTitleDraft(managedIntent.title);
            setEditingTitle(true);
          }}
          deadlineWindowMessage={deadlineWindowMessage}
          onRefreshCompiledDeadline={handleRefreshCompiledDeadline}
          publicArtifacts={publicArtifacts}
          privateArtifacts={privateArtifacts}
        />
      ) : null}

      {/* ── Step 3: Publish ────────────────────────────── */}
      {!expertMode && step === 3 && compilation ? (
        <PublishStep
          compilation={compilation}
          rewardInput={rewardInput}
          feeUsdc={feeUsdc}
          payoutUsdc={payoutUsdc}
          isConnected={isConnected}
          isWrongChain={isWrongChain}
          wrongChainMessage={getWrongChainMessage(chainId)}
          fundingState={fundingState}
          allowanceReady={allowanceReady}
          balanceReady={balanceReady}
          fundingSummary={fundingSummary}
          deadlineWindowMessage={deadlineWindowMessage}
          onRefreshCompiledDeadline={handleRefreshCompiledDeadline}
        />
      ) : null}

      {/* ── Action bar ─────────────────────────────────── */}
      {!expertMode ? (
        <PostingActionBar
          step={step}
          isCompiling={isCompiling}
          compileReady={compileReady}
          needsDeadlineRefresh={needsDeadlineRefresh}
          isConnected={isConnected}
          isWrongChain={isWrongChain}
          requiresApproval={requiresApproval}
          isApproving={isApproving}
          isPublishing={isPublishing}
          chainName={APP_CHAIN_NAME}
          onBack={() => setStep((current) => (current === 3 ? 2 : 1) as Step)}
          onCompile={() => {
            void handleCompile();
          }}
          onContinueToPublish={() => setStep(3)}
          onOpenConnect={() => openConnectModal?.()}
          onOpenChain={() => openChainModal?.()}
          onRefreshContract={handleRefreshCompiledDeadline}
          onApprove={() => {
            void handleApprove();
          }}
          onPublish={() => {
            void handlePublish();
          }}
        />
      ) : null}

      {/* Footer */}
      <div className="text-center text-xs text-warm-500">
        Need a custom scorer?{" "}
        <span className="font-mono text-warm-700">
          agora post ./challenge.yaml
        </span>{" "}
        supports advanced configuration from the CLI.
      </div>
    </div>
  );
}
