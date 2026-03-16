import { PROTOCOL_FEE_PERCENT } from "@agora/common";
import { formatUsdc } from "../../../lib/format";
import type { FormState } from "../post-client-model";
import { SectionHeader } from "../post-form-primitives";
import {
  getChallengeTypeLabel,
  getDistributionSummaryLabel,
  getLifecycleSteps,
  getOfficialScoringSummary,
} from "../post-summary";

export function ReviewSummarySection({
  state,
  rewardValue,
  protocolFeeValue,
  winnerPayoutValue,
  isCustomType,
}: {
  state: FormState;
  rewardValue: number;
  protocolFeeValue: number;
  winnerPayoutValue: number;
  isCustomType: boolean;
}) {
  return (
    <div className="form-section">
      <SectionHeader step={6} title="Review & Publish" />
      <div className="form-section-body">
        <div className="challenge-summary-layout">
          <div className="summary-column">
            <div className="summary-panel summary-receipt">
              <p className="summary-panel-eyebrow">Escrow & payout</p>
              <div className="receipt-row">
                <span className="receipt-label">Deposit</span>
                <span className="receipt-value">
                  <span>{formatUsdc(rewardValue)}</span>
                  <span className="receipt-unit">USDC</span>
                </span>
              </div>
              <div className="receipt-row">
                <span className="receipt-label">
                  {`Protocol fee (${PROTOCOL_FEE_PERCENT}%)`}
                </span>
                <span className="receipt-value receipt-value-muted">
                  <span>- {formatUsdc(protocolFeeValue)}</span>
                  <span className="receipt-unit">USDC</span>
                </span>
              </div>
              <div className="receipt-divider" />
              <div className="receipt-row receipt-row-total">
                <span className="receipt-label receipt-label-strong">
                  Net payout
                </span>
                <span className="receipt-total">
                  <span className="receipt-total-amount">
                    {formatUsdc(winnerPayoutValue)}
                  </span>
                  <span className="receipt-total-unit">USDC</span>
                </span>
              </div>
            </div>

            <div className="summary-panel summary-parameters">
              <p className="summary-panel-eyebrow">Challenge setup</p>
              <div className="summary-kv-list">
                <div className="summary-kv-row">
                  <span className="summary-kv-label">Type</span>
                  <span className="summary-kv-value">
                    <span className="summary-rule-badge">
                      {getChallengeTypeLabel(state)}
                    </span>
                  </span>
                </div>
                <div className="summary-kv-row">
                  <span className="summary-kv-label">Payout rule</span>
                  <span className="summary-kv-value">
                    {getDistributionSummaryLabel(state.distribution)}
                  </span>
                </div>
                <div className="summary-kv-row">
                  <span className="summary-kv-label">
                    Official scoring rule
                  </span>
                  <span className="summary-kv-value">
                    {getOfficialScoringSummary(state, isCustomType)}
                  </span>
                </div>
              </div>
            </div>

            <div className="summary-panel summary-trust">
              <p className="summary-panel-eyebrow">Scoring trust</p>
              <div className="summary-trust-copy">
                <span className="summary-trust-icon" aria-hidden="true">
                  {"\uD83D\uDD12"}
                </span>
                <div>
                  <p className="summary-trust-title">Checkable Scoring</p>
                  <p className="summary-trust-text">
                    Agora operates scoring first, but the scorer image, posted
                    inputs, and published outputs are designed to be replayable
                    and independently checked.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="summary-column">
            <div className="summary-panel summary-timeline">
              <p className="summary-panel-eyebrow">Lifecycle</p>
              <div className="timeline-list">
                {getLifecycleSteps(state).map((step) => (
                  <div
                    key={step.label}
                    className={`timeline-item ${step.active ? "active" : ""}`}
                  >
                    <div className="timeline-marker" aria-hidden="true" />
                    <div className="timeline-copy">
                      <span className="timeline-label">{step.label}</span>
                      <span className="timeline-detail">{step.detail}</span>
                      <span className="timeline-note">{step.note}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
