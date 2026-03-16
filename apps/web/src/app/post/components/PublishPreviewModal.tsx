import { ArrowRight, Check, Eye, Loader2, Wallet, X } from "lucide-react";
import type { ChallengePostStatus } from "../../../lib/challenge-post";
import type { FormState } from "../post-client-model";
import type { PostingFundingState } from "../post-funding";
import {
  ChallengePreviewSection,
  FundingPreviewSection,
  RewardTimelinePreviewSection,
  ScoringPreviewSection,
} from "../post-preview-sections";
import type { PendingAction } from "../use-post-client-controller";
import { PostStatusBanner } from "./PostStatusBanner";

export function PublishPreviewModal({
  show,
  onClose,
  state,
  fundingState,
  balanceReady,
  allowanceReady,
  hasPostedOnChain,
  postedChallengeId,
  isBusy,
  pendingAction,
  status,
  onApprove,
  onCreate,
}: {
  show: boolean;
  onClose: () => void;
  state: FormState;
  fundingState: PostingFundingState;
  balanceReady: boolean;
  allowanceReady: boolean;
  hasPostedOnChain: boolean;
  postedChallengeId: string | null;
  isBusy: boolean;
  pendingAction: PendingAction;
  status: ChallengePostStatus | null;
  onApprove: () => void;
  onCreate: () => void;
}) {
  if (!show) {
    return null;
  }

  return (
    <div
      className="preview-overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          onClose();
        }
      }}
    >
      <div className="preview-card">
        <div className="preview-card-header">
          <h3>
            <Eye size={16} />
            Review Before Publish
          </h3>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--text-muted)",
              padding: "4px",
            }}
          >
            <X size={18} />
          </button>
        </div>

        <div className="preview-summary">
          <ChallengePreviewSection state={state} />
          <ScoringPreviewSection state={state} />
          <RewardTimelinePreviewSection state={state} />
          <FundingPreviewSection
            fundingState={fundingState}
            balanceReady={balanceReady}
            allowanceReady={allowanceReady}
          />
        </div>

        <PostStatusBanner
          className="preview-status"
          iconSize={15}
          status={status}
          postedChallengeId={postedChallengeId}
        />

        <div className="preview-actions">
          <button
            type="button"
            onClick={onClose}
            className="dash-btn dash-btn-secondary"
            style={{ fontSize: "0.8rem" }}
          >
            {hasPostedOnChain ? "Close" : "<- Edit"}
          </button>
          {hasPostedOnChain ? (
            <div className="preview-actions-main">
              {postedChallengeId ? (
                <a
                  href={`/challenges/${postedChallengeId}`}
                  className="dash-btn dash-btn-primary"
                  style={{ fontSize: "0.8rem" }}
                >
                  <ArrowRight size={14} />
                  View challenge
                </a>
              ) : null}
            </div>
          ) : (
            <div className="preview-actions-main">
              {fundingState.status === "ready" &&
              fundingState.method === "approve" ? (
                <button
                  type="button"
                  disabled={
                    isBusy ||
                    fundingState.status !== "ready" ||
                    allowanceReady ||
                    !balanceReady
                  }
                  onClick={onApprove}
                  className={`dash-btn ${!allowanceReady && balanceReady ? "dash-btn-primary" : ""}`}
                  style={{ fontSize: "0.8rem" }}
                >
                  {pendingAction === "approving" ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : allowanceReady ? (
                    <Check size={14} />
                  ) : (
                    <Wallet size={14} />
                  )}
                  {allowanceReady ? "USDC Approved" : "Approve USDC"}
                  <span className="preview-action-step">Step 1 of 2</span>
                </button>
              ) : null}
              <button
                type="button"
                disabled={
                  isBusy ||
                  fundingState.status !== "ready" ||
                  !balanceReady ||
                  (fundingState.method === "approve" && !allowanceReady)
                }
                onClick={onCreate}
                className={`dash-btn ${(fundingState.method === "permit" || allowanceReady) && balanceReady ? "dash-btn-primary" : "dash-btn-secondary"}`}
                style={{ fontSize: "0.8rem" }}
              >
                {isBusy ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <ArrowRight size={14} />
                )}
                {fundingState.method === "permit" && !allowanceReady
                  ? "Sign Permit & Create"
                  : "Create Challenge"}
                {fundingState.status === "ready" &&
                fundingState.method === "approve" ? (
                  <span className="preview-action-step">Step 2 of 2</span>
                ) : null}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
