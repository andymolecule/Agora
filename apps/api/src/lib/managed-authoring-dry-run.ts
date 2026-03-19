import {
  AgoraError,
  type ChallengeSpecOutput,
  type DryRunPreviewOutput,
  resolveChallengeEvaluation,
  resolveRuntimeFamilyLimits,
  resolveRuntimeFamilyRuntimeDefaults,
  resolveScoringEnvironmentFromSpec,
} from "@agora/common";
import { getText } from "@agora/ipfs";
import { executeScoringPipeline } from "@agora/scorer";

type ExecuteScoringPipelineFn = typeof executeScoringPipeline;
type GetTextFn = typeof getText;

interface CsvRow {
  [key: string]: string;
}

interface StructuredRecordRubric {
  requiredFields: string[];
  nonEmptyArrayFields: string[];
  allowedStringValues: Record<string, string[]>;
}

function parseCsv(text: string): CsvRow[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return [];
  }
  const lines = trimmed.split(/\r?\n/);
  const header = lines[0]?.split(",").map((value) => value.trim()) ?? [];
  if (header.length === 0) {
    return [];
  }
  return lines.slice(1).flatMap((line) => {
    if (!line.trim()) {
      return [];
    }
    const values = line.split(",").map((value) => value.trim());
    if (values.length !== header.length) {
      return [];
    }
    return [
      Object.fromEntries(
        header.map((column, index) => [column, values[index] ?? ""]),
      ),
    ];
  });
}

function serializeCsv(header: string[], rows: CsvRow[]) {
  return `${header.join(",")}\n${rows
    .map((row) => header.map((column) => row[column] ?? "").join(","))
    .join("\n")}\n`;
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (entry): entry is string =>
      typeof entry === "string" && entry.trim().length > 0,
  );
}

function parseStructuredRecordRubric(content: string): StructuredRecordRubric {
  let document: unknown;
  try {
    document = JSON.parse(content);
  } catch {
    throw new AgoraError(
      "Agora could not build a structured-record dry-run because the hidden rubric is not valid JSON. Next step: upload a valid rubric JSON file and retry.",
      {
        code: "MANAGED_DRY_RUN_INVALID_STRUCTURED_RECORD_RUBRIC",
        status: 422,
      },
    );
  }

  if (!document || typeof document !== "object" || Array.isArray(document)) {
    throw new AgoraError(
      "Agora could not build a structured-record dry-run because the hidden rubric must be a JSON object. Next step: upload a rubric object and retry.",
      {
        code: "MANAGED_DRY_RUN_INVALID_STRUCTURED_RECORD_RUBRIC",
        status: 422,
      },
    );
  }

  const record = document as Record<string, unknown>;
  const requiredFields = parseStringArray(
    record.required_fields ?? record.required_sections,
  );
  const nonEmptyArrayFields = parseStringArray(record.non_empty_array_fields);
  const allowedStringValuesSource = record.allowed_string_values;
  const allowedStringValuesEntries = Object.entries(
    allowedStringValuesSource &&
      typeof allowedStringValuesSource === "object" &&
      !Array.isArray(allowedStringValuesSource)
      ? (allowedStringValuesSource as Record<string, unknown>)
      : {},
  ).flatMap(([field, values]) => {
    const parsedValues = parseStringArray(values);
    return parsedValues.length > 0 ? [[field, parsedValues] as const] : [];
  });
  const allowedStringValues = Object.fromEntries(allowedStringValuesEntries);

  if (
    requiredFields.length === 0 &&
    nonEmptyArrayFields.length === 0 &&
    Object.keys(allowedStringValues).length === 0
  ) {
    throw new AgoraError(
      "Agora could not build a structured-record dry-run because the hidden rubric does not declare any deterministic validation rules. Next step: add required_fields, non_empty_array_fields, or allowed_string_values and retry.",
      {
        code: "MANAGED_DRY_RUN_INVALID_STRUCTURED_RECORD_RUBRIC",
        status: 422,
      },
    );
  }

  return {
    requiredFields,
    nonEmptyArrayFields,
    allowedStringValues,
  };
}

function buildStructuredRecordSampleSubmission(rubric: StructuredRecordRubric) {
  const fieldNames = new Set<string>([
    ...rubric.requiredFields,
    ...rubric.nonEmptyArrayFields,
    ...Object.keys(rubric.allowedStringValues),
  ]);
  const submission: Record<string, unknown> = {};
  for (const fieldName of fieldNames) {
    const allowedValues = rubric.allowedStringValues[fieldName];
    if (allowedValues && allowedValues.length > 0) {
      submission[fieldName] = allowedValues[0];
      continue;
    }
    if (rubric.nonEmptyArrayFields.includes(fieldName)) {
      submission[fieldName] =
        fieldName === "timeline"
          ? [{ timestamp: "2026-01-01T00:00:00Z", event: "sample event" }]
          : [`sample_${fieldName}`];
      continue;
    }
    submission[fieldName] = `sample_${fieldName}`;
  }
  return JSON.stringify(submission);
}

function summarizeDryRunScore(input: {
  runtimeFamily: string;
  metric: string;
  score: number;
  details: Record<string, unknown>;
}) {
  const normalizedScore = `normalized score ${input.score.toFixed(6)}`;
  const selectedMetricValue =
    typeof input.details.selected_metric_value === "number"
      ? input.details.selected_metric_value
      : typeof input.details[input.metric] === "number"
        ? input.details[input.metric]
        : undefined;

  if (typeof selectedMetricValue === "number") {
    return `${normalizedScore} (${input.metric} ${selectedMetricValue.toFixed(6)})`;
  }

  if (
    input.runtimeFamily === "reproducibility" &&
    typeof input.details.matched_rows === "number" &&
    typeof input.details.total_rows === "number"
  ) {
    return `${normalizedScore} (${input.details.matched_rows}/${input.details.total_rows} rows matched)`;
  }

  return normalizedScore;
}

async function buildSubmissionSource(input: {
  challengeSpec: ChallengeSpecOutput;
  getTextImpl: GetTextFn;
}) {
  const evalPlan = resolveChallengeEvaluation(input.challengeSpec);
  const evaluationUri = evalPlan.evaluationBundleCid;
  if (!evaluationUri) {
    throw new AgoraError(
      "This challenge needs a deterministic evaluation artifact before dry-run execution. Next step: attach the missing evaluation artifact or use Expert Mode.",
      {
        code: "MANAGED_DRY_RUN_MISSING_EVALUATION_BUNDLE",
        status: 422,
      },
    );
  }

  const runtimeFamily = input.challengeSpec.evaluation.runtime_family;
  const effectiveRuntimeFamily =
    evalPlan.semiCustomExecution?.runner_runtime_family ?? runtimeFamily;
  if (evalPlan.semiCustomExecution?.template === "official_structured_record_v1") {
    const rubricText = await input.getTextImpl(evaluationUri);
    return {
      content: buildStructuredRecordSampleSubmission(
        parseStructuredRecordRubric(rubricText),
      ),
    };
  }

  if (effectiveRuntimeFamily === "reproducibility") {
    return { cid: evaluationUri };
  }

  if (input.challengeSpec.submission_contract.kind !== "csv_table") {
    throw new AgoraError(
      `Managed runtime family ${runtimeFamily} requires a csv_table submission contract for dry-runs. Next step: fix the runtime family configuration or use Expert Mode.`,
      {
        code: "MANAGED_DRY_RUN_UNSUPPORTED_CONTRACT",
        status: 500,
      },
    );
  }

  const bundleText = await input.getTextImpl(evaluationUri);
  const rows = parseCsv(bundleText);
  if (rows.length === 0) {
    throw new AgoraError(
      "Agora could not build a dry-run submission because the evaluation bundle is empty. Next step: upload a non-empty evaluation file and retry.",
      {
        code: "MANAGED_DRY_RUN_EMPTY_EVALUATION_BUNDLE",
        status: 422,
      },
    );
  }

  const submissionColumns = input.challengeSpec.submission_contract.columns;
  const idColumn = submissionColumns.id;
  const valueColumn = submissionColumns.value;
  if (!idColumn || !valueColumn) {
    throw new AgoraError(
      "Managed dry-run needs a submission contract with id and value columns. Next step: recompile the draft or use Expert Mode.",
      {
        code: "MANAGED_DRY_RUN_INVALID_SUBMISSION_CONTRACT",
        status: 500,
      },
    );
  }
  const evaluationContract =
    evalPlan.semiCustomExecution?.evaluation_contract ??
    resolveRuntimeFamilyRuntimeDefaults(
      input.challengeSpec.evaluation.runtime_family,
    )?.evaluationContract;
  const evaluationIdColumn = evaluationContract?.columns.id;
  const evaluationValueColumn = evaluationContract?.columns.value;
  if (!evaluationIdColumn || !evaluationValueColumn) {
    throw new AgoraError(
      "Managed dry-run needs an evaluation contract with id and value columns. Next step: fix the runtime family configuration or use Expert Mode.",
      {
        code: "MANAGED_DRY_RUN_INVALID_EVALUATION_CONTRACT",
        status: 500,
      },
    );
  }

  const submissionRows = rows.map((row) => {
    const evaluationId = row[evaluationIdColumn];
    const evaluationLabel = row[evaluationValueColumn];
    if (
      typeof evaluationId !== "string" ||
      evaluationId.length === 0 ||
      typeof evaluationLabel !== "string" ||
      evaluationLabel.length === 0
    ) {
      throw new AgoraError(
        `Agora could not derive dry-run predictions from the evaluation bundle. Next step: upload an evaluation file with ${evaluationIdColumn} and ${evaluationValueColumn} columns or use Expert Mode.`,
        {
          code: "MANAGED_DRY_RUN_EVALUATION_FORMAT_UNSUPPORTED",
          status: 422,
        },
      );
    }
    return {
      [idColumn]: evaluationId,
      [valueColumn]: evaluationLabel,
    };
  });

  return {
    content: serializeCsv(submissionColumns.required, submissionRows),
  };
}

export async function executeManagedAuthoringDryRun(
  input: {
    challengeSpec: ChallengeSpecOutput;
    timeoutMs: number;
  },
  dependencies: {
    executeScoringPipelineImpl?: ExecuteScoringPipelineFn;
    getTextImpl?: GetTextFn;
  } = {},
): Promise<DryRunPreviewOutput> {
  return executeAuthoringDryRun(input, dependencies);
}

export async function executeAuthoringDryRun(
  input: {
    challengeSpec: ChallengeSpecOutput;
    timeoutMs: number;
  },
  dependencies: {
    executeScoringPipelineImpl?: ExecuteScoringPipelineFn;
    getTextImpl?: GetTextFn;
  } = {},
): Promise<DryRunPreviewOutput> {
  const executeScoringPipelineImpl =
    dependencies.executeScoringPipelineImpl ?? executeScoringPipeline;
  const getTextImpl = dependencies.getTextImpl ?? getText;
  const evalPlan = resolveChallengeEvaluation(input.challengeSpec);
  const runnerLimits = resolveRuntimeFamilyLimits(
    evalPlan.semiCustomExecution?.runner_runtime_family ??
      evalPlan.runtimeFamily,
  );
  const submission = await buildSubmissionSource({
    challengeSpec: input.challengeSpec,
    getTextImpl,
  });

  const run = await executeScoringPipelineImpl({
    image: evalPlan.image,
    runtimeFamily: evalPlan.runtimeFamily,
    evaluationBundle: evalPlan.evaluationBundleCid
      ? { cid: evalPlan.evaluationBundleCid }
      : undefined,
    mount: evalPlan.mount,
    submission,
    submissionContract: input.challengeSpec.submission_contract,
    evaluationContract: evalPlan.semiCustomExecution?.evaluation_contract,
    metric: evalPlan.metric,
    policies: evalPlan.semiCustomExecution?.policies,
    env: resolveScoringEnvironmentFromSpec(input.challengeSpec),
    timeoutMs: Math.min(
      input.timeoutMs,
      runnerLimits?.timeoutMs ?? input.timeoutMs,
    ),
    limits: runnerLimits
      ? {
          memory: runnerLimits.memory,
          cpus: runnerLimits.cpus,
          pids: runnerLimits.pids,
        }
      : undefined,
  });

  try {
    if (!run.result.ok) {
      throw new AgoraError(
        `Managed dry-run failed: ${run.result.error ?? "the scorer rejected the sample submission"}. Next step: fix the uploaded files or use Expert Mode.`,
        {
          code: "MANAGED_DRY_RUN_REJECTED",
          status: 422,
          details: run.result.details,
        },
      );
    }

    const sampleScore = summarizeDryRunScore({
      runtimeFamily: evalPlan.runtimeFamily,
      metric: evalPlan.metric,
      score: run.result.score,
      details: run.result.details,
    });

    return {
      status: "validated",
      summary: `Agora executed the official scorer against a sample submission derived from the uploaded evaluation artifacts and got ${sampleScore}.`,
      sample_score: sampleScore,
    };
  } finally {
    await run.cleanup();
  }
}
