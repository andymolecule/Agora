"use client";

import { AlertCircle, ArrowRight, Loader2, Wallet } from "lucide-react";
import { ChallengeMaterialsSection } from "./components/ChallengeMaterialsSection";
import { JudgingSection } from "./components/JudgingSection";
import { PostStatusBanner } from "./components/PostStatusBanner";
import { PostTypeSection } from "./components/PostTypeSection";
import { PublishPreviewModal } from "./components/PublishPreviewModal";
import { ReviewSummarySection } from "./components/ReviewSummarySection";
import { RewardTimelineSection } from "./components/RewardTimelineSection";
import { ScientificBriefSection } from "./components/ScientificBriefSection";
import { SolverArtifactSection } from "./components/SolverArtifactSection";
import { usePostClientController } from "./use-post-client-controller";

export function PostClient() {
  const {
    state,
    setState,
    status,
    postedChallengeId,
    pendingAction,
    fundingState,
    showAdvanced,
    setShowAdvanced,
    showPreview,
    setShowPreview,
    uploadingField,
    fileNames,
    tagInput,
    setTagInput,
    isConnected,
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
    handleUploadValueChange,
    addTag,
    removeTag,
    selectType,
    handleApprove,
    handleCreate,
    handlePrimarySubmitAction,
  } = usePostClientController();

  return (
    <div className="post-form">
      <div className="post-header">
        <div className="post-header-left">
          <h1 className="page-title">Post Bounty</h1>
          <p className="page-subtitle">
            Post a reproducibility benchmark or prediction challenge and fund it
            with USDC.
          </p>
        </div>
      </div>

      <PostTypeSection type={state.type} onSelectType={selectType} />

      <ScientificBriefSection
        state={state}
        setState={setState}
        tagInput={tagInput}
        setTagInput={setTagInput}
        addTag={addTag}
        removeTag={removeTag}
      />

      <ChallengeMaterialsSection
        state={state}
        uploadingField={uploadingField}
        fileNames={fileNames}
        onUpload={handleFileUpload}
        onUploadValueChange={handleUploadValueChange}
      />

      <SolverArtifactSection
        state={state}
        setState={setState}
        fileNames={fileNames}
        isCustomType={isCustomType}
      />

      <RewardTimelineSection state={state} setState={setState} />

      <JudgingSection
        state={state}
        setState={setState}
        isCustomType={isCustomType}
        showAdvanced={showAdvanced}
        setShowAdvanced={setShowAdvanced}
      />

      <ReviewSummarySection
        state={state}
        rewardValue={rewardValue}
        protocolFeeValue={protocolFeeValue}
        winnerPayoutValue={winnerPayoutValue}
        isCustomType={isCustomType}
      />

      <div className="post-submit-row">
        <button
          type="button"
          disabled={postingCtaDisabled}
          onClick={handlePrimarySubmitAction}
          className="post-submit-btn"
        >
          {isBusy ? (
            <Loader2 size={16} className="animate-spin" />
          ) : !isConnected ? (
            <Wallet size={16} />
          ) : isWrongChain ? (
            <AlertCircle size={16} />
          ) : (
            <ArrowRight size={16} />
          )}
          {isBusy ? "Waiting for wallet..." : postingCtaLabel}
        </button>
      </div>

      <PostStatusBanner
        className="post-status"
        iconSize={16}
        status={status}
        postedChallengeId={postedChallengeId}
      />

      <PublishPreviewModal
        show={showPreview}
        onClose={() => setShowPreview(false)}
        state={state}
        fundingState={fundingState}
        balanceReady={balanceReady}
        allowanceReady={allowanceReady}
        hasPostedOnChain={hasPostedOnChain}
        postedChallengeId={postedChallengeId}
        isBusy={isBusy}
        pendingAction={pendingAction}
        status={status}
        onApprove={() => {
          void handleApprove();
        }}
        onCreate={() => {
          void handleCreate();
        }}
      />
    </div>
  );
}
