import { Check, Settings2 } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import {
  type FormState,
  METRIC_OPTIONS,
  getMetricOption,
} from "../post-client-model";
import { FormField, SectionHeader } from "../post-form-primitives";

export function JudgingSection({
  state,
  setState,
  isCustomType,
  showAdvanced,
  setShowAdvanced,
}: {
  state: FormState;
  setState: Dispatch<SetStateAction<FormState>>;
  isCustomType: boolean;
  showAdvanced: boolean;
  setShowAdvanced: Dispatch<SetStateAction<boolean>>;
}) {
  const usesNumericDrift =
    state.type === "reproducibility" && Number(state.tolerance || "0") > 0;

  return (
    <>
      <div className="form-section">
        <SectionHeader step={5} title="Judging" />
        <div className="form-section-body">
          <div className="poster-step-intro">
            <p className="poster-step-intro-title">
              How will Agora judge submissions?
            </p>
            <p className="poster-step-intro-copy">
              This defines the official scoring rule that determines how
              submissions are ranked and who gets paid.
            </p>
          </div>
          <div className="form-grid">
            {state.type === "prediction" ? (
              <div className="span-full">
                <p
                  style={{
                    fontSize: "0.7rem",
                    color: "var(--text-tertiary)",
                    margin: "0 0 0.35rem",
                    fontWeight: 600,
                  }}
                >
                  Official judging rule
                </p>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    padding: "0.65rem 0.85rem",
                    background: "#FAFAFA",
                    border: "1px solid #E5E7EB",
                    borderRadius: "8px",
                  }}
                >
                  <Check
                    size={14}
                    style={{
                      color: "var(--color-warm-900)",
                      flexShrink: 0,
                    }}
                  />
                  <span
                    style={{
                      fontSize: "0.8rem",
                      lineHeight: 1.5,
                      color: "var(--text-primary)",
                    }}
                  >
                    Agora compares submitted predictions against the posted
                    benchmark scoring targets after the submission window
                    closes, then ranks solvers by the selected metric.
                  </span>
                </div>
              </div>
            ) : null}

            {state.type === "prediction" ? (
              <FormField
                label="Primary metric"
                hint={getMetricOption(state.metric)?.hint ?? ""}
                className="span-full measure-small"
              >
                <select
                  className="form-select"
                  value={state.metric}
                  onChange={(event) => {
                    const metric = getMetricOption(event.target.value);
                    setState((current) => ({
                      ...current,
                      metric: event.target.value,
                      evaluationCriteria: metric
                        ? `Evaluated by ${metric.label}. ${metric.hint}.`
                        : current.evaluationCriteria,
                    }));
                  }}
                >
                  {METRIC_OPTIONS.map((metric) => (
                    <option key={metric.value} value={metric.value}>
                      {metric.label}
                    </option>
                  ))}
                </select>
              </FormField>
            ) : null}

            {state.type === "reproducibility" ? (
              <>
                <div className="span-full">
                  <p
                    style={{
                      fontSize: "0.7rem",
                      color: "var(--text-tertiary)",
                      margin: "0 0 0.35rem",
                      fontWeight: 600,
                    }}
                  >
                    Official judging rule
                  </p>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.5rem",
                      padding: "0.65rem 0.85rem",
                      background: "#FAFAFA",
                      border: "1px solid #E5E7EB",
                      borderRadius: "8px",
                    }}
                  >
                    <Check
                      size={14}
                      style={{
                        color: "var(--color-warm-900)",
                        flexShrink: 0,
                      }}
                    />
                    <span
                      style={{
                        fontSize: "0.8rem",
                        lineHeight: 1.5,
                        color: "var(--text-primary)",
                      }}
                    >
                      Agora compares the returned CSV against the posted
                      reference output row by row. The match rule below controls
                      whether numeric drift is allowed during that comparison.
                    </span>
                  </div>
                </div>
                <div className="form-field span-full">
                  <div className="form-label">
                    Match rule (How strict the official scorer should be when
                    comparing numeric values)
                  </div>
                  <div className="choice-grid">
                    <button
                      type="button"
                      className={`choice-card choice-card-with-input ${!usesNumericDrift ? "active" : ""}`}
                      onClick={() =>
                        setState((current) => ({ ...current, tolerance: "0" }))
                      }
                    >
                      <span className="choice-card-title">Exact match</span>
                      <span className="choice-card-hint">
                        All numeric values must match exactly.
                      </span>
                      <div className="choice-card-inline-field">
                        <span className="choice-card-inline-label">
                          Allowed drift
                        </span>
                        <span className="choice-card-inline-static">None</span>
                      </div>
                    </button>
                    <button
                      type="button"
                      className={`choice-card choice-card-with-input ${usesNumericDrift ? "active" : ""}`}
                      onClick={() => {
                        if (!usesNumericDrift) {
                          setState((current) => ({
                            ...current,
                            tolerance:
                              current.tolerance.trim() &&
                              Number(current.tolerance) > 0
                                ? current.tolerance
                                : "0.001",
                          }));
                        }
                      }}
                    >
                      <span className="choice-card-title">
                        Allow small drift
                      </span>
                      <span className="choice-card-hint">
                        Useful when minor rounding or floating-point noise
                        should still count as correct.
                      </span>
                      <div className="choice-card-inline-field">
                        <span className="choice-card-inline-label">
                          Allowed drift
                        </span>
                        <input
                          className="choice-card-inline-input form-input-mono"
                          placeholder="0.001"
                          value={usesNumericDrift ? state.tolerance : ""}
                          onChange={(event) =>
                            setState((current) => ({
                              ...current,
                              tolerance: event.target.value,
                            }))
                          }
                          onFocus={() => {
                            if (!usesNumericDrift) {
                              setState((current) => ({
                                ...current,
                                tolerance:
                                  current.tolerance.trim() &&
                                  Number(current.tolerance) > 0
                                    ? current.tolerance
                                    : "0.001",
                              }));
                            }
                          }}
                          onClick={(event) => event.stopPropagation()}
                        />
                      </div>
                    </button>
                  </div>
                  <span className="form-hint">
                    Absolute numeric tolerance is used for official scoring.
                    Example: 0.001 means values within +/-0.001 are treated as
                    matching.
                  </span>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </div>

      {isCustomType ? (
        <>
          <button
            type="button"
            className={`advanced-toggle ${showAdvanced ? "open" : ""}`}
            onClick={() => setShowAdvanced(!showAdvanced)}
          >
            <Settings2 size={14} />
            <span>Advanced Settings</span>
            <span className="form-hint" style={{ marginLeft: "auto" }}>
              Minimum score threshold
            </span>
          </button>

          {showAdvanced ? (
            <div
              className="advanced-body"
              style={{ gridTemplateColumns: "1fr" }}
            >
              <FormField
                label="Minimum score"
                hint="Submissions below this are rejected (0 = no threshold)"
              >
                <input
                  className="form-input form-input-mono"
                  type="number"
                  min={0}
                  max={100}
                  placeholder="0"
                  value={state.minimumScore}
                  onChange={(event) =>
                    setState((current) => ({
                      ...current,
                      minimumScore: event.target.value,
                    }))
                  }
                />
              </FormField>
            </div>
          ) : null}
        </>
      ) : null}
    </>
  );
}
