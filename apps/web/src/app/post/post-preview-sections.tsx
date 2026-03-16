import type { ReactNode } from "react";
import {
  formatFinalizationCheckDate,
  formatSubmissionWindowLabel,
} from "../../lib/post-submission-window";
import {
  AVAILABLE_TYPE_OPTIONS,
  type FormState,
  getMetricDisplaySummary,
  scoringRuleLabel,
} from "./post-client-model";
import {
  type PostingFundingState,
  getFundingSummaryMessage,
} from "./post-funding";
import {
  getChallengeTypeLabel,
  getDistributionSummaryLabel,
} from "./post-summary";

function PreviewSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="preview-section">
      <h4 className="preview-section-title">{title}</h4>
      <div className="preview-section-body">{children}</div>
    </div>
  );
}

function PreviewRow({
  label,
  value,
  spanFull = false,
  mono = false,
  small = false,
}: {
  label: string;
  value: ReactNode;
  spanFull?: boolean;
  mono?: boolean;
  small?: boolean;
}) {
  return (
    <div className={`preview-row ${spanFull ? "span-full" : ""}`}>
      <span className="preview-label">{label}</span>
      <span
        className="preview-value"
        style={{
          ...(mono ? { fontFamily: "var(--font-mono)" } : {}),
          ...(small ? { fontSize: "0.72rem" } : {}),
        }}
      >
        {value}
      </span>
    </div>
  );
}

export function ChallengePreviewSection({ state }: { state: FormState }) {
  return (
    <PreviewSection title="Challenge">
      <PreviewRow label="Title" value={state.title || "-"} />
      <PreviewRow label="Category" value={state.domain} />
      <PreviewRow label="Type" value={getChallengeTypeLabel(state)} />
      {state.tags.length > 0 ? (
        <PreviewRow label="Keywords" value={state.tags.join(", ")} />
      ) : null}
      {state.description ? (
        <PreviewRow label="Brief" value={state.description} spanFull />
      ) : null}
      {state.referenceLink ? (
        <PreviewRow label="Reference" value={state.referenceLink} spanFull />
      ) : null}
    </PreviewSection>
  );
}

export function ScoringPreviewSection({ state }: { state: FormState }) {
  return (
    <PreviewSection title="Scoring">
      {!AVAILABLE_TYPE_OPTIONS.includes(state.type) ? (
        <PreviewRow label="Container" value={state.container || "-"} mono />
      ) : null}
      {state.type === "reproducibility" ? (
        <PreviewRow label="Scoring rule" value={scoringRuleLabel(state)} />
      ) : null}
      {state.type === "reproducibility" && state.tolerance ? (
        <PreviewRow label="Allowed drift" value={state.tolerance} mono />
      ) : null}
      {state.type === "prediction" && state.metric ? (
        <PreviewRow
          label="Metric"
          value={getMetricDisplaySummary(state.metric)}
        />
      ) : null}
      {state.type === "prediction" && state.idColumn ? (
        <PreviewRow label="ID column" value={state.idColumn} mono />
      ) : null}
      {state.type === "prediction" && state.labelColumn ? (
        <PreviewRow label="Prediction column" value={state.labelColumn} mono />
      ) : null}
      {state.type === "prediction" && state.hiddenLabels ? (
        <PreviewRow
          label="Scoring targets"
          value={
            state.hiddenLabels.length > 40
              ? `${state.hiddenLabels.slice(0, 40)}...`
              : state.hiddenLabels
          }
          mono
          small
        />
      ) : null}
      {state.successDefinition ? (
        <PreviewRow
          label="Success criteria"
          value={state.successDefinition}
          spanFull
        />
      ) : null}
      {state.evaluationCriteria ? (
        <PreviewRow
          label="Evaluation"
          value={state.evaluationCriteria}
          spanFull
        />
      ) : null}
    </PreviewSection>
  );
}

export function RewardTimelinePreviewSection({
  state,
}: {
  state: FormState;
}) {
  return (
    <PreviewSection title="Reward & Timeline">
      <PreviewRow label="Reward pool" value={`${state.reward} USDC`} />
      <PreviewRow
        label="Payout rule"
        value={getDistributionSummaryLabel(state.distribution)}
      />
      <PreviewRow
        label="Submission window"
        value={formatSubmissionWindowLabel(state.deadlineDays)}
      />
      <PreviewRow
        label="Review window"
        value={state.disputeWindow === "0" ? "none" : `${state.disputeWindow}h`}
      />
      <PreviewRow
        label="Earliest finalization"
        value={formatFinalizationCheckDate(
          state.deadlineDays,
          state.disputeWindow,
        )}
      />
    </PreviewSection>
  );
}

export function FundingPreviewSection({
  fundingState,
  balanceReady,
  allowanceReady,
}: {
  fundingState: PostingFundingState;
  balanceReady: boolean;
  allowanceReady: boolean;
}) {
  return (
    <PreviewSection title="Funding">
      <PreviewRow
        label="Status"
        value={getFundingSummaryMessage({
          fundingState,
          balanceReady,
          allowanceReady,
        })}
        spanFull
      />
    </PreviewSection>
  );
}
