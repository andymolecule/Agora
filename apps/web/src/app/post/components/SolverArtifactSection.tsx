import type { Dispatch, SetStateAction } from "react";
import { ScoringTrustNotice } from "../../../components/ScoringTrustNotice";
import { AVAILABLE_TYPE_OPTIONS, type FormState } from "../post-client-model";
import { FormField, SectionHeader } from "../post-form-primitives";
import {
  CustomArtifactFields,
  DockingArtifactFields,
  ManagedScoringNotice,
  OptimizationArtifactFields,
  PredictionArtifactFields,
  RedTeamArtifactFields,
  ReproducibilityArtifactFields,
} from "./solver-artifact-fields";

export function SolverArtifactSection({
  state,
  setState,
  fileNames,
  isCustomType,
}: {
  state: FormState;
  setState: Dispatch<SetStateAction<FormState>>;
  fileNames: Record<string, string>;
  isCustomType: boolean;
}) {
  return (
    <div className="form-section">
      <SectionHeader step={3} title="Solver Return Artifact" />
      <div className="form-section-body">
        <div className="poster-step-intro">
          <p className="poster-step-intro-title">
            What exactly must solvers send back?
          </p>
          <p className="poster-step-intro-copy">
            Define the returned artifact, the schema it must follow, and any
            notes solvers need to produce useful outputs rather than merely
            valid files.
          </p>
        </div>
        <div className="form-grid">
          {!AVAILABLE_TYPE_OPTIONS.includes(state.type) ? (
            <FormField
              label="Submission rules"
              hint="What makes a submission valid? (plain English)"
            >
              <input
                className="form-input"
                placeholder="e.g. Upload a ZIP containing model.pkl and predictions.csv"
                value={state.successDefinition}
                onChange={(event) =>
                  setState((current) => ({
                    ...current,
                    successDefinition: event.target.value,
                  }))
                }
              />
            </FormField>
          ) : null}

          {state.type === "prediction" ? (
            <PredictionArtifactFields state={state} setState={setState} />
          ) : null}
          {state.type === "reproducibility" ? (
            <ReproducibilityArtifactFields
              state={state}
              setState={setState}
              fileNames={fileNames}
            />
          ) : null}
          {state.type === "optimization" ? (
            <OptimizationArtifactFields state={state} setState={setState} />
          ) : null}
          {state.type === "docking" ? <DockingArtifactFields /> : null}
          {state.type === "red_team" ? (
            <RedTeamArtifactFields state={state} setState={setState} />
          ) : null}
          {state.type === "custom" ? (
            <CustomArtifactFields state={state} setState={setState} />
          ) : null}

          {!isCustomType ? <ManagedScoringNotice state={state} /> : null}

          <div className="span-full">
            <ScoringTrustNotice />
          </div>
        </div>
      </div>
    </div>
  );
}
