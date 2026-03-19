export const EVALUATOR_ARCHETYPE_IDS = [
  "exact_artifact_match",
  "structured_table_score",
  "structured_record_score",
  "bundle_or_code_judge",
  "opaque_file_judge",
] as const;

export type EvaluatorArchetypeId = (typeof EVALUATOR_ARCHETYPE_IDS)[number];

export interface EvaluatorArchetypeDefinition {
  id: EvaluatorArchetypeId;
  label: string;
  description: string;
}

export const EVALUATOR_ARCHETYPE_REGISTRY: Record<
  EvaluatorArchetypeId,
  EvaluatorArchetypeDefinition
> = {
  exact_artifact_match: {
    id: "exact_artifact_match",
    label: "Exact Artifact Match",
    description:
      "Compare a solver artifact directly against a hidden or reference artifact using deterministic matching rules.",
  },
  structured_table_score: {
    id: "structured_table_score",
    label: "Structured Table Score",
    description:
      "Score a structured table submission against deterministic rules or hidden structured evaluation data.",
  },
  structured_record_score: {
    id: "structured_record_score",
    label: "Structured Record Score",
    description:
      "Score a structured record file such as JSON against a deterministic validation or scoring contract.",
  },
  bundle_or_code_judge: {
    id: "bundle_or_code_judge",
    label: "Bundle Or Code Judge",
    description:
      "Run a tightly-scoped deterministic judge over a solver-provided bundle, notebook, or code artifact.",
  },
  opaque_file_judge: {
    id: "opaque_file_judge",
    label: "Opaque File Judge",
    description:
      "Validate and score an opaque solver artifact through a deterministic custom evaluator contract.",
  },
};

export function getEvaluatorArchetype(
  archetypeId: string,
): EvaluatorArchetypeDefinition | undefined {
  return EVALUATOR_ARCHETYPE_REGISTRY[archetypeId as EvaluatorArchetypeId];
}
