import {
  CHALLENGE_LIMITS,
  PROTOCOL_FEE_PERCENT,
  isTestnetChain,
} from "@agora/common";
import { AlertCircle } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { CHAIN_ID } from "../../../lib/config";
import {
  type FormState,
  PAYOUT_RULE_OPTIONS,
  SUBMISSION_WINDOW_OPTIONS,
} from "../post-client-model";
import { ChoiceField, FormField, SectionHeader } from "../post-form-primitives";

export function RewardTimelineSection({
  state,
  setState,
}: {
  state: FormState;
  setState: Dispatch<SetStateAction<FormState>>;
}) {
  return (
    <div className="form-section">
      <SectionHeader step={4} title="Reward & Timeline" />
      <div className="form-section-body">
        <div className="poster-step-intro">
          <p className="poster-step-intro-title">
            What are you paying, and when does it close?
          </p>
          <p className="poster-step-intro-copy">
            Set the reward pool that gets escrowed on-chain, choose how
            it&apos;s distributed, and define the operating window for this
            bounty.
          </p>
        </div>
        <div className="form-grid">
          <div
            className="span-full"
            style={{
              border: "1px solid rgba(74,107,77,0.2)",
              borderRadius: "12px",
              background: "linear-gradient(135deg, #F4F7F2 0%, #FAFAF8 100%)",
              padding: "1.5rem",
              display: "flex",
              flexDirection: "column",
              gap: "0.75rem",
            }}
          >
            <div
              style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}
            >
              <span
                style={{
                  fontSize: "0.7rem",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  color: "#4A6B4D",
                  fontFamily: "var(--font-mono)",
                }}
              >
                Reward Pool
              </span>
              <span
                style={{
                  fontSize: "0.65rem",
                  color: "var(--text-tertiary)",
                  fontFamily: "var(--font-mono)",
                }}
              >
                {CHALLENGE_LIMITS.rewardMinUsdc}-
                {CHALLENGE_LIMITS.rewardMaxUsdc} USDC
              </span>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: "0.5rem",
              }}
            >
              <input
                className="form-input form-input-mono"
                type="number"
                min={CHALLENGE_LIMITS.rewardMinUsdc}
                max={CHALLENGE_LIMITS.rewardMaxUsdc}
                value={state.reward}
                onChange={(event) =>
                  setState((current) => ({
                    ...current,
                    reward: event.target.value,
                  }))
                }
                style={{
                  fontSize: "2rem",
                  fontWeight: 700,
                  padding: "0.5rem 0.75rem",
                  maxWidth: "220px",
                  borderColor: "rgba(74,107,77,0.25)",
                  background: "white",
                }}
              />
              <span
                style={{
                  fontSize: "1.1rem",
                  fontWeight: 700,
                  color: "#4A6B4D",
                  fontFamily: "var(--font-mono)",
                  letterSpacing: "0.04em",
                }}
              >
                USDC
              </span>
            </div>
            <span
              style={{ fontSize: "0.72rem", color: "var(--text-tertiary)" }}
            >
              Escrowed on-chain when you publish. {PROTOCOL_FEE_PERCENT}%
              protocol fee applies.
            </span>
          </div>

          <div
            className="span-full"
            style={{
              borderTop: "1px solid var(--border-default)",
              paddingTop: "1.5rem",
              marginTop: "0.5rem",
            }}
          >
            <h4
              style={{
                fontSize: "0.8rem",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                color: "var(--text-secondary)",
                fontFamily: "var(--font-mono)",
                marginBottom: "1rem",
              }}
            >
              Payout Rule
            </h4>
          </div>
          <ChoiceField
            label=""
            hint="Choose how the reward pool is distributed after protocol fees."
            value={state.distribution}
            options={PAYOUT_RULE_OPTIONS}
            onChange={(next) =>
              setState((current) => ({ ...current, distribution: next }))
            }
            className="span-full"
          />

          <div
            className="span-full"
            style={{
              borderTop: "1px solid var(--border-default)",
              paddingTop: "1.5rem",
              marginTop: "0.5rem",
            }}
          >
            <h4
              style={{
                fontSize: "0.8rem",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                color: "var(--text-secondary)",
                fontFamily: "var(--font-mono)",
                marginBottom: "0.25rem",
              }}
            >
              Operating Windows
            </h4>
            <p
              style={{
                fontSize: "0.75rem",
                color: "var(--text-tertiary)",
                marginBottom: "0.5rem",
              }}
            >
              Define how long solvers can submit and how long the review period
              lasts before settlement.
            </p>
          </div>
          <FormField
            label="Submission window"
            hint="How long solvers have to submit before scoring begins"
          >
            <select
              className="form-select"
              value={state.deadlineDays}
              onChange={(event) =>
                setState((current) => ({
                  ...current,
                  deadlineDays: event.target.value,
                }))
              }
            >
              {SUBMISSION_WINDOW_OPTIONS.filter(
                (option) => !option.testnetOnly || isTestnetChain(CHAIN_ID),
              ).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </FormField>
          <FormField
            label="Review window before settlement"
            hint="Time for anyone to challenge scores before finalization can proceed"
          >
            <select
              className="form-select"
              value={state.disputeWindow}
              onChange={(event) =>
                setState((current) => ({
                  ...current,
                  disputeWindow: event.target.value,
                }))
              }
            >
              {isTestnetChain(CHAIN_ID) ? (
                <option value="0">No dispute window (testnet only)</option>
              ) : null}
              {isTestnetChain(CHAIN_ID) ? (
                <option value="1">1 hour - Testing</option>
              ) : null}
              <option
                value={String(CHALLENGE_LIMITS.defaultDisputeWindowHours)}
              >
                7 days - Standard
              </option>
              <option value="336">14 days</option>
              <option value="720">30 days</option>
              <option value="1440">60 days</option>
              <option value={String(CHALLENGE_LIMITS.disputeWindowMaxHours)}>
                90 days - Maximum
              </option>
            </select>
          </FormField>
          {state.disputeWindow === "0" ? (
            <div
              className="span-full"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                padding: "0.5rem 0.75rem",
                background: "#fff3cd",
                borderRadius: "6px",
                fontSize: "0.75rem",
                color: "#856404",
                border: "1px solid #ffc107",
              }}
            >
              <AlertCircle size={14} />
              <span>
                No review window means settlement can proceed{" "}
                <strong>as soon as scoring finishes</strong>. Use only for
                testing.
              </span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
