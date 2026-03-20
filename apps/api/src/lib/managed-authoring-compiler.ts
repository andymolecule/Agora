import {
  AgoraError,
  type AuthoringArtifactOutput,
  type ChallengeIntentOutput,
  lookupManagedRuntimeFamily,
  validateRuntimeMetric,
} from "@agora/common";
import type { AgoraLogger } from "@agora/common/server-observability";
import { z } from "zod";
import { readManagedAuthoringRuntimeConfig } from "./managed-authoring-runtime.js";

export type SupportedManagedPresetId =
  | "reproducibility"
  | "tabular_regression"
  | "tabular_classification"
  | "ranking"
  | "docking";

export interface CompilerArtifactAssignment {
  artifactIndex: number;
  role: string;
  visibility: "public" | "private";
}

export interface CompilerProposal {
  presetId: SupportedManagedPresetId;
  metric: string;
  confidenceScore: number;
  reasonCodes: string[];
  warnings: string[];
  artifactAssignments?: CompilerArtifactAssignment[];
}

export interface CompilerProvider {
  compile(input: {
    intent: ChallengeIntentOutput;
    uploadedArtifacts: AuthoringArtifactOutput[];
  }): Promise<CompilerProposal>;
}

const supportedRuntimeFamilyIds = [
  "reproducibility",
  "tabular_regression",
  "tabular_classification",
  "ranking",
  "docking",
] as const satisfies readonly SupportedManagedPresetId[];

const compilerProposalSchema = z.object({
  preset_id: z.enum(supportedRuntimeFamilyIds),
  metric: z.string().trim().min(1),
  confidence_score: z.number().min(0).max(1),
  reason_codes: z.array(z.string().trim().min(1)).default([]),
  warnings: z.array(z.string().trim().min(1)).default([]),
  artifact_assignments: z
    .array(
      z.object({
        artifact_index: z.number().int().min(0),
        role: z.string().trim().min(1),
        visibility: z.enum(["public", "private"]),
      }),
    )
    .optional(),
});

function artifactName(artifact: AuthoringArtifactOutput) {
  return artifact.file_name?.trim() || artifact.uri;
}

function inferManagedPreset(sourceText: string): {
  presetId: SupportedManagedPresetId;
  matchedSupportedSignal: boolean;
} {
  if (
    /(reproduce|reproduc|exact match|same output|reference output|benchmark)/i.test(
      sourceText,
    )
  ) {
    return {
      presetId: "reproducibility",
      matchedSupportedSignal: true,
    };
  }
  if (
    /(dock|docking|ligand|binding pocket|target structure)/i.test(sourceText)
  ) {
    return {
      presetId: "docking",
      matchedSupportedSignal: true,
    };
  }
  if (/(rank|ranking|ndcg|leaderboard)/i.test(sourceText)) {
    return {
      presetId: "ranking",
      matchedSupportedSignal: true,
    };
  }
  if (/(classif|accuracy|f1|precision|recall|label class)/i.test(sourceText)) {
    return {
      presetId: "tabular_classification",
      matchedSupportedSignal: true,
    };
  }
  if (
    /(predict|prediction|regress|regression|forecast|estimate|holdout|numeric response|response values?)/i.test(
      sourceText,
    )
  ) {
    return {
      presetId: "tabular_regression",
      matchedSupportedSignal: true,
    };
  }
  return {
    presetId: "tabular_regression",
    matchedSupportedSignal: false,
  };
}

function inferMetric(
  presetId: SupportedManagedPresetId,
  sourceText: string,
): string {
  switch (presetId) {
    case "reproducibility":
      return /(tolerance|approx|drift)/i.test(sourceText)
        ? "tolerant_match"
        : "exact_match";
    case "tabular_regression":
      if (/\brmse\b/i.test(sourceText)) return "rmse";
      if (/\bmae\b/i.test(sourceText)) return "mae";
      if (/\bpearson\b/i.test(sourceText)) return "pearson";
      if (/\bspearman\b/i.test(sourceText)) return "spearman";
      return "r2";
    case "tabular_classification":
      return /\bf1\b/i.test(sourceText) ? "f1" : "accuracy";
    case "ranking":
      return /\bndcg\b/i.test(sourceText) ? "ndcg" : "spearman";
    case "docking":
      return /\bndcg\b/i.test(sourceText) ? "ndcg" : "spearman";
  }
}

class HeuristicCompilerProvider implements CompilerProvider {
  async compile(input: {
    intent: ChallengeIntentOutput;
    uploadedArtifacts: AuthoringArtifactOutput[];
  }): Promise<CompilerProposal> {
    const sourceText = [
      input.intent.title,
      input.intent.description,
      input.intent.payout_condition,
      input.intent.solver_instructions ?? "",
      ...input.uploadedArtifacts.map((artifact) => artifactName(artifact)),
    ].join(" ");

    const { presetId, matchedSupportedSignal } =
      inferManagedPreset(sourceText);
    const metric = inferMetric(presetId, sourceText);

    let confidenceScore = 0.8;
    const reasonCodes: string[] = [];
    const warnings: string[] = [];

    if (!matchedSupportedSignal) {
      confidenceScore -= 0.35;
      reasonCodes.push("no_supported_runtime_signal");
      warnings.push(
        "Challenge description does not clearly match a current managed evaluator template.",
      );
    }

    const minimumArtifacts = presetId === "docking" ? 3 : 2;
    if (input.uploadedArtifacts.length < minimumArtifacts) {
      confidenceScore -= 0.25;
      reasonCodes.push("too_few_artifacts");
    }

    if (
      !/train|test|label|hidden|reference|output|ranking|reproduc|ligand|docking|target/i.test(
        sourceText,
      )
    ) {
      confidenceScore -= 0.1;
      reasonCodes.push("weak_artifact_role_signals");
    }

    if (!input.intent.payout_condition.trim()) {
      confidenceScore -= 0.1;
      reasonCodes.push("missing_payout_condition");
    }

    if (presetId === "tabular_regression" && metric === "r2") {
      warnings.push(
        "Regression challenges default to R2 unless the description clearly requests RMSE, MAE, Pearson, or Spearman.",
      );
    }
    if (presetId === "docking") {
      warnings.push(
        "Docking challenges work best when the uploaded files clearly include a target structure, a ligand set, and hidden reference scores.",
      );
    }

    return {
      presetId,
      metric,
      confidenceScore,
      reasonCodes,
      warnings,
    };
  }
}

function buildCompilerCatalog() {
  return supportedRuntimeFamilyIds.map((runtimeFamilyId) => {
    const family = lookupManagedRuntimeFamily(runtimeFamilyId);
    return {
      id: runtimeFamilyId,
      display_name: family?.displayName ?? runtimeFamilyId,
      description: family?.description ?? "",
      supported_metrics:
        family?.supportedMetrics.map((metric) => ({
          id: metric.id,
          direction: metric.direction,
          label: metric.label,
        })) ?? [],
      supported_artifact_roles: family?.supportedArtifactRoles ?? [],
    };
  });
}

function buildSystemPrompt() {
  return [
    "You compile Agora managed challenge drafts into a supported managed preset.",
    "Return JSON only. Do not include markdown or prose outside the JSON object.",
    "Choose one preset_id, one supported metric for that preset, and artifact assignments for the required file roles when you can infer them.",
    "Use only these visibility values: public, private.",
    "Confidence should reflect whether a non-technical poster would likely agree that the uploaded files were mapped correctly and the scoring metric matches their stated payout condition.",
    "If the challenge is ambiguous, keep confidence below 0.75 and include concrete reason_codes.",
    "If the challenge does not fit the managed catalog cleanly, keep confidence low and include reason_codes such as no_supported_runtime_signal or weak_runtime_fit so the caller can route to a definition-backed path or Expert Mode.",
    "Prefer tabular_regression for numeric prediction tasks, tabular_classification for label prediction tasks, reproducibility for exact output matching, docking for ligand-ranking tasks against a target structure, and ranking for ordered or leaderboard-style outcomes that are not docking-specific.",
    `Supported managed preset catalog: ${JSON.stringify(buildCompilerCatalog())}`,
  ].join("\n");
}

async function readOpenAiCompatibleContent(response: Response) {
  const payload = (await response.json()) as {
    error?: { message?: string };
    choices?: Array<{
      message?: {
        content?: string | Array<{ type?: string; text?: string }>;
        refusal?: string | null;
      };
    }>;
  };

  const refusal = payload.choices?.[0]?.message?.refusal;
  if (typeof refusal === "string" && refusal.trim().length > 0) {
    throw new Error(
      `Managed authoring compiler refused the request: ${refusal}. Next step: simplify the challenge description or use Expert Mode.`,
    );
  }

  const content = payload.choices?.[0]?.message?.content;
  if (typeof content === "string" && content.trim().length > 0) {
    return content;
  }

  if (Array.isArray(content)) {
    const text = content
      .map((item) => (item.type === "text" ? (item.text ?? "") : ""))
      .join("")
      .trim();
    if (text.length > 0) {
      return text;
    }
  }

  const providerMessage =
    payload.error?.message ??
    "Managed authoring compiler returned an empty response.";
  throw new Error(
    `${providerMessage} Next step: retry the compile request or switch back to heuristic compilation.`,
  );
}

class OpenAiCompatibleCompilerProvider implements CompilerProvider {
  constructor(
    private readonly config = readManagedAuthoringRuntimeConfig(),
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async compile(input: {
    intent: ChallengeIntentOutput;
    uploadedArtifacts: AuthoringArtifactOutput[];
  }): Promise<CompilerProposal> {
    const response = await this.fetchImpl(
      `${this.config.baseUrl?.replace(/\/$/, "")}/chat/completions`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          temperature: 0,
          messages: [
            {
              role: "system",
              content: buildSystemPrompt(),
            },
            {
              role: "user",
              content: JSON.stringify(
                {
                  intent: input.intent,
                  uploaded_artifacts: input.uploadedArtifacts.map(
                    (artifact, index) => ({
                      index,
                      file_name: artifact.file_name ?? null,
                      uri: artifact.uri,
                      mime_type: artifact.mime_type ?? null,
                      detected_columns: artifact.detected_columns ?? [],
                    }),
                  ),
                },
                null,
                2,
              ),
            },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "agora_managed_challenge_compile",
              strict: true,
              schema: {
                type: "object",
                additionalProperties: false,
                properties: {
                  preset_id: {
                    type: "string",
                    enum: [...supportedRuntimeFamilyIds],
                  },
                  metric: { type: "string" },
                  confidence_score: {
                    type: "number",
                    minimum: 0,
                    maximum: 1,
                  },
                  reason_codes: {
                    type: "array",
                    items: { type: "string" },
                  },
                  warnings: {
                    type: "array",
                    items: { type: "string" },
                  },
                  artifact_assignments: {
                    type: "array",
                    items: {
                      type: "object",
                      additionalProperties: false,
                      properties: {
                        artifact_index: { type: "integer", minimum: 0 },
                        role: { type: "string" },
                        visibility: {
                          type: "string",
                          enum: ["public", "private"],
                        },
                      },
                      required: ["artifact_index", "role", "visibility"],
                    },
                  },
                },
                required: [
                  "preset_id",
                  "metric",
                  "confidence_score",
                  "reason_codes",
                  "warnings",
                ],
              },
            },
          },
        }),
      },
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Managed authoring compiler request failed with ${response.status}. Next step: verify AGORA_MANAGED_AUTHORING_MODEL/API_KEY and retry. ${body}`,
      );
    }

    const content = await readOpenAiCompatibleContent(response);
    const parsed = compilerProposalSchema.parse(JSON.parse(content));
    const metricError = validateRuntimeMetric(parsed.preset_id, parsed.metric);
    if (metricError) {
      throw new Error(
        `${metricError} Next step: choose a supported metric or switch to Expert Mode.`,
      );
    }

    const family = lookupManagedRuntimeFamily(parsed.preset_id);
    for (const assignment of parsed.artifact_assignments ?? []) {
      if (
        assignment.artifact_index < 0 ||
        assignment.artifact_index >= input.uploadedArtifacts.length
      ) {
        throw new Error(
          `Managed authoring compiler referenced missing artifact index ${assignment.artifact_index}. Next step: retry the compile request.`,
        );
      }
      if (!family?.supportedArtifactRoles.includes(assignment.role)) {
        throw new Error(
          `Managed authoring compiler returned unsupported artifact role ${assignment.role} for ${parsed.preset_id}. Next step: retry the compile request or use Expert Mode.`,
        );
      }
    }

    return {
      presetId: parsed.preset_id,
      metric: parsed.metric,
      confidenceScore: parsed.confidence_score,
      reasonCodes: parsed.reason_codes,
      warnings: parsed.warnings,
      artifactAssignments: parsed.artifact_assignments?.map((assignment) => ({
        artifactIndex: assignment.artifact_index,
        role: assignment.role,
        visibility: assignment.visibility,
      })),
    };
  }
}

export function resolveCompilerProvider(input?: {
  fetchImpl?: typeof fetch;
}): CompilerProvider {
  const runtime = readManagedAuthoringRuntimeConfig();
  if (runtime.compilerBackend === "openai_compatible") {
    return new OpenAiCompatibleCompilerProvider(runtime, input?.fetchImpl);
  }
  return new HeuristicCompilerProvider();
}

export async function compileManagedAuthoringProposal(input: {
  intent: ChallengeIntentOutput;
  uploadedArtifacts: AuthoringArtifactOutput[];
  fetchImpl?: typeof fetch;
  draftId?: string;
  logger?: AgoraLogger;
}): Promise<CompilerProposal> {
  const runtime = readManagedAuthoringRuntimeConfig();
  input.logger?.info(
    {
      event: "authoring.compiler.started",
      draftId: input.draftId ?? null,
      backend: runtime.compilerBackend,
      model:
        runtime.compilerBackend === "openai_compatible" ? runtime.model : null,
      artifactCount: input.uploadedArtifacts.length,
    },
    "Started managed authoring compiler",
  );

  try {
    const proposal = await resolveCompilerProvider({
      fetchImpl: input.fetchImpl,
    }).compile({
      intent: input.intent,
      uploadedArtifacts: input.uploadedArtifacts,
    });
    input.logger?.info(
      {
        event: "authoring.compiler.completed",
        draftId: input.draftId ?? null,
        backend: runtime.compilerBackend,
        model:
          runtime.compilerBackend === "openai_compatible"
            ? runtime.model
            : null,
        presetId: proposal.presetId,
        metric: proposal.metric,
        confidenceScore: proposal.confidenceScore,
        reasonCodes: proposal.reasonCodes,
        warningCount: proposal.warnings.length,
        artifactAssignmentCount: proposal.artifactAssignments?.length ?? 0,
      },
      "Completed managed authoring compiler",
    );
    return proposal;
  } catch (error) {
    input.logger?.warn(
      {
        event: "authoring.compiler.failed",
        draftId: input.draftId ?? null,
        backend: runtime.compilerBackend,
        model:
          runtime.compilerBackend === "openai_compatible"
            ? runtime.model
            : null,
        code: error instanceof AgoraError ? error.code : null,
        status: error instanceof AgoraError ? error.status : null,
        message: error instanceof Error ? error.message : String(error),
      },
      "Managed authoring compiler failed",
    );
    if (error instanceof AgoraError) {
      throw error;
    }
    throw new AgoraError(
      `Managed authoring compiler failed. Next step: retry the compile request or switch to Expert Mode. ${error instanceof Error ? error.message : String(error)}`,
      {
        code: "MANAGED_COMPILER_PROVIDER_FAILED",
        status: 502,
      },
    );
  }
}
