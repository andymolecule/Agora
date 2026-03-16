import { Check } from "lucide-react";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import {
  type FormState,
  getMetricDisplayLabel,
  scoringRuleLabel,
} from "../post-client-model";
import { FormField } from "../post-form-primitives";

type FormStateSetter = Dispatch<SetStateAction<FormState>>;

function ArtifactRequirementBanner({
  title,
  detail,
}: {
  title: string;
  detail: string;
}) {
  return (
    <div className="span-full">
      <p
        style={{
          fontSize: "0.7rem",
          color: "var(--text-tertiary)",
          margin: "0 0 0.35rem",
          fontWeight: 600,
        }}
      >
        Required submission file
      </p>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          padding: "0.5rem 0.75rem",
          background: "#FAFAFA",
          border: "1px solid #E5E7EB",
          borderRadius: "6px",
        }}
      >
        <Check size={14} style={{ color: "var(--color-warm-900)" }} />
        <span
          style={{
            fontSize: "0.8rem",
            fontWeight: 600,
            color: "var(--text-primary)",
          }}
        >
          {title}
        </span>
        <span
          style={{
            fontSize: "0.72rem",
            color: "var(--text-tertiary)",
          }}
        >
          - {detail}
        </span>
      </div>
    </div>
  );
}

function SectionDivider() {
  return (
    <div
      className="span-full"
      style={{
        borderTop: "1px solid var(--border-subtle)",
        margin: "0.25rem 0",
      }}
    />
  );
}

function InlineNote({ children }: { children: ReactNode }) {
  return (
    <p
      className="span-full"
      style={{
        fontSize: "0.72rem",
        color: "var(--text-tertiary)",
        margin: 0,
        fontStyle: "italic",
      }}
    >
      {children}
    </p>
  );
}

function PreviewBlock({
  title,
  description,
  sample,
  footer,
}: {
  title: string;
  description: string;
  sample: string;
  footer?: ReactNode;
}) {
  return (
    <div className="span-full">
      <p
        style={{
          fontSize: "0.7rem",
          color: "var(--text-tertiary)",
          margin: "0 0 0.25rem",
          fontWeight: 600,
        }}
      >
        {title}
      </p>
      <p
        style={{
          fontSize: "0.68rem",
          color: "var(--text-tertiary)",
          margin: "0 0 0.35rem",
          lineHeight: 1.4,
        }}
      >
        {description}
      </p>
      <pre
        style={{
          margin: 0,
          padding: "0.5rem 0.75rem",
          background: "#FAFAFA",
          border: "1px solid #E5E7EB",
          borderRadius: "6px",
          fontSize: "0.72rem",
          fontFamily: "var(--font-mono)",
          color: "var(--text-secondary)",
          lineHeight: 1.6,
          overflowX: "auto",
        }}
      >
        {sample}
      </pre>
      {footer ? (
        <p
          style={{
            fontSize: "0.68rem",
            color: "var(--text-tertiary)",
            margin: "0.35rem 0 0",
            lineHeight: 1.4,
          }}
        >
          {footer}
        </p>
      ) : null}
    </div>
  );
}

function ContainerAndDescriptionFields({
  state,
  setState,
  containerLabel,
  containerHint,
  containerPlaceholder,
  descriptionLabel,
  descriptionHint,
  descriptionPlaceholder,
}: {
  state: FormState;
  setState: FormStateSetter;
  containerLabel: string;
  containerHint: string;
  containerPlaceholder: string;
  descriptionLabel: string;
  descriptionHint: string;
  descriptionPlaceholder: string;
}) {
  return (
    <>
      <SectionDivider />
      <FormField
        label={containerLabel}
        hint={containerHint}
        className="span-full"
      >
        <input
          className="form-input form-input-mono"
          placeholder={containerPlaceholder}
          value={state.container}
          onChange={(event) =>
            setState((current) => ({
              ...current,
              container: event.target.value,
            }))
          }
        />
      </FormField>
      <FormField
        label={descriptionLabel}
        hint={descriptionHint}
        className="span-full"
      >
        <textarea
          className="form-textarea"
          placeholder={descriptionPlaceholder}
          value={state.evaluationCriteria}
          onChange={(event) =>
            setState((current) => ({
              ...current,
              evaluationCriteria: event.target.value,
            }))
          }
        />
      </FormField>
    </>
  );
}

export function PredictionArtifactFields({
  state,
  setState,
}: {
  state: FormState;
  setState: FormStateSetter;
}) {
  return (
    <>
      <ArtifactRequirementBanner
        title="CSV predictions only"
        detail="Solvers submit one prediction row per evaluation input"
      />
      <FormField
        label="Row ID column"
        hint="Identifier column name in the evaluation input CSV"
      >
        <input
          className="form-input form-input-mono"
          placeholder="id"
          value={state.idColumn}
          onChange={(event) =>
            setState((current) => ({
              ...current,
              idColumn: event.target.value,
            }))
          }
        />
      </FormField>
      <FormField
        label="Prediction column name"
        hint="Column name solvers must use for predictions in their submission CSV"
      >
        <input
          className="form-input form-input-mono"
          placeholder="prediction"
          value={state.labelColumn}
          onChange={(event) =>
            setState((current) => ({
              ...current,
              labelColumn: event.target.value,
            }))
          }
        />
      </FormField>
      <FormField
        label="Submission guidance (optional)"
        hint="Add scientific or dataset context that helps solvers produce stronger predictions"
      >
        <input
          className="form-input"
          placeholder="e.g. Rows are assay replicates and scores are judged on Spearman correlation"
          value={state.evaluationCriteria}
          onChange={(event) =>
            setState((current) => ({
              ...current,
              evaluationCriteria: event.target.value,
            }))
          }
        />
      </FormField>
      <SectionDivider />
      <PreviewBlock
        title="Required submission file"
        description="Solvers submit a CSV file with these columns:"
        sample={`${state.idColumn || "id"},${state.labelColumn || "prediction"}\n1,3.42\n2,7.89\n3,1.05\n...`}
        footer={
          <>
            <code
              style={{
                fontSize: "0.68rem",
                background: "#FAFAFA",
                border: "1px solid #E5E7EB",
                padding: "0.1rem 0.3rem",
                borderRadius: "3px",
              }}
            >
              {state.idColumn || "id"}
            </code>{" "}
            must match the IDs in your test set.{" "}
            <code
              style={{
                fontSize: "0.68rem",
                background: "#FAFAFA",
                border: "1px solid #E5E7EB",
                padding: "0.1rem 0.3rem",
                borderRadius: "3px",
              }}
            >
              {state.labelColumn || "prediction"}
            </code>{" "}
            is the numeric value scored by {getMetricDisplayLabel(state.metric)}
            .
          </>
        }
      />
    </>
  );
}

export function ReproducibilityArtifactFields({
  state,
  setState,
  fileNames,
}: {
  state: FormState;
  setState: FormStateSetter;
  fileNames: Record<string, string>;
}) {
  return (
    <>
      <ArtifactRequirementBanner
        title="CSV output only"
        detail="Solvers submit a CSV matching the reference output columns and row order"
      />
      <FormField
        label="Submission guidance (optional)"
        hint="Add human guidance that helps solvers reproduce the artifact correctly"
        className="span-full"
      >
        <textarea
          className="form-textarea"
          placeholder="e.g. Rows must stay in the original order and all values should be rounded to three decimals"
          value={state.evaluationCriteria}
          onChange={(event) =>
            setState((current) => ({
              ...current,
              evaluationCriteria: event.target.value,
            }))
          }
        />
      </FormField>
      <SectionDivider />
      <div className="span-full">
        <p
          style={{
            fontSize: "0.7rem",
            color: "var(--text-tertiary)",
            margin: "0 0 0.25rem",
            fontWeight: 600,
          }}
        >
          Required submission columns
          {state.detectedColumns.length > 0 ? (
            <span
              style={{
                fontWeight: 400,
                fontStyle: "italic",
                marginLeft: "0.5rem",
              }}
            >
              (auto-detected from {fileNames.test || "reference output"})
            </span>
          ) : null}
        </p>
        {state.detectedColumns.length > 0 ? (
          <>
            <p
              style={{
                fontSize: "0.68rem",
                color: "var(--text-tertiary)",
                margin: "0 0 0.35rem",
                lineHeight: 1.4,
              }}
            >
              Solvers submit a CSV matching these columns:
            </p>
            <pre
              style={{
                margin: 0,
                padding: "0.5rem 0.75rem",
                background: "#FAFAFA",
                border: "1px solid #E5E7EB",
                borderRadius: "6px",
                fontSize: "0.72rem",
                fontFamily: "var(--font-mono)",
                color: "var(--text-secondary)",
                lineHeight: 1.6,
                overflowX: "auto",
              }}
            >
              {state.detectedColumns.join(",")}
            </pre>
            <InlineNote>
              Solvers should keep the same column order and row order as the
              posted reference output.
            </InlineNote>
          </>
        ) : (
          <InlineNote>
            Upload the reference output above to preview the required submission
            columns.
          </InlineNote>
        )}
      </div>
    </>
  );
}

export function OptimizationArtifactFields({
  state,
  setState,
}: {
  state: FormState;
  setState: FormStateSetter;
}) {
  return (
    <>
      <ContainerAndDescriptionFields
        state={state}
        setState={setState}
        containerLabel="Scoring container"
        containerHint="Your OCI image that runs the simulation"
        containerPlaceholder="ghcr.io/org/scorer@sha256:..."
        descriptionLabel="Scoring description"
        descriptionHint="Describe the objective function"
        descriptionPlaceholder="e.g. Minimize binding energy. Score = 100 - abs(energy - target_energy)."
      />
      <InlineNote>
        Your custom scorer container runs the solver&apos;s parameters through
        your simulation.
      </InlineNote>
    </>
  );
}

export function DockingArtifactFields() {
  return (
    <PreviewBlock
      title="Solver output format"
      description="Solvers submit a CSV ranked by docking score:"
      sample={
        "ligand_id,docking_score\nZINC000001,-8.42\nZINC000002,-7.91\nZINC000003,-6.55\n..."
      }
      footer={
        "Most negative score = best binding affinity. The scorer compares against reference docking scores using Spearman correlation."
      }
    />
  );
}

export function RedTeamArtifactFields({
  state,
  setState,
}: {
  state: FormState;
  setState: FormStateSetter;
}) {
  return (
    <>
      <ContainerAndDescriptionFields
        state={state}
        setState={setState}
        containerLabel="Scoring container"
        containerHint="Your Docker image that runs the model on adversarial inputs and measures degradation"
        containerPlaceholder="ghcr.io/org/red-team-scorer@sha256:..."
        descriptionLabel="Scoring description"
        descriptionHint="Explain how degradation is measured"
        descriptionPlaceholder="e.g. Scorer runs model on adversarial inputs, measures accuracy drop vs baseline. Score = percentage degradation (0-100)."
      />
      <InlineNote>
        Your scorer loads the target model, runs it on adversarial inputs, and
        outputs a degradation score. Higher score = more degradation = better
        attack.
      </InlineNote>
    </>
  );
}

export function CustomArtifactFields({
  state,
  setState,
}: {
  state: FormState;
  setState: FormStateSetter;
}) {
  return (
    <>
      <ContainerAndDescriptionFields
        state={state}
        setState={setState}
        containerLabel="Scoring container"
        containerHint="Your OCI image reference"
        containerPlaceholder="ghcr.io/org/scorer@sha256:..."
        descriptionLabel="Scoring description"
        descriptionHint="Explain the scoring logic for solvers"
        descriptionPlaceholder="e.g. Exact hash match scores 100, partial matches scored by edit distance."
      />
      <InlineNote>
        Define your own scoring logic via a Docker container. The scoring
        description is informational.
      </InlineNote>
    </>
  );
}

export function ManagedScoringNotice({ state }: { state: FormState }) {
  return (
    <div
      className="span-full"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "0.25rem",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          padding: "0.5rem 0.75rem",
          background: "#FAFAFA",
          border: "1px solid #E5E7EB",
          borderRadius: "6px",
          fontSize: "0.75rem",
          fontFamily: "var(--font-mono)",
        }}
      >
        <span style={{ fontWeight: 600, color: "var(--text-secondary)" }}>
          Official scoring rule:
        </span>
        <span style={{ color: "var(--text-primary)" }}>
          {scoringRuleLabel(state)}
        </span>
      </div>
      <InlineNote>
        Managed scorer - scoring is deterministic and independently verifiable.
      </InlineNote>
    </div>
  );
}
