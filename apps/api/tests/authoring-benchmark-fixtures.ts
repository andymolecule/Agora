import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AuthoringArtifactOutput, ChallengeIntentOutput } from "@agora/common";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const BENCHMARK_ROOT = path.resolve(
  TEST_DIR,
  "../../../challenges/test-data/authoring-benchmarks",
);

type BenchmarkCompileState = "ready" | "needs_review" | "needs_clarification";

type BenchmarkJson = {
  id: string;
  authoring_path_support:
    | "supported"
    | "definition_backed_executable"
    | "definition_backed_typed";
  intent_family: string;
  artifacts_root: string;
  prompt_variants_root: string;
  solver_submissions_root: string;
  compile_invariants: {
    preset_id: string;
    backend_kind:
      | "preset_interpreter"
      | "definition_only"
      | "generated_scorer"
      | "oci_image";
    execution_runtime_family?: string | null;
    metric: string;
    artifact_roles: Array<{
      file_name: string;
      role: string;
      visibility: "public" | "private";
    }>;
    submission_contract: {
      kind: "csv_table" | "opaque_file";
      required_columns?: string[];
      id_column?: string;
      value_column?: string;
      extension?: string;
      mime?: string;
    };
    challenge_type?: string;
    evaluator_archetype?: string;
  };
  acceptable_compile_states: BenchmarkCompileState[];
  disallowed_outcomes: {
    preset_ids: string[];
    recommended_actions: string[];
  };
  prompt_variants: Array<{
    id: string;
    file: string;
    acceptable_compile_states: BenchmarkCompileState[];
    expected_follow_up_topics: string[];
  }>;
};

export interface AuthoringBenchmarkCase {
  benchmark: BenchmarkJson;
  benchmarkDir: string;
  variantId: string;
  promptText: string;
  intent: ChallengeIntentOutput;
  uploadedArtifacts: AuthoringArtifactOutput[];
  artifactTextByUri: Map<string, string>;
}

function titleFromPrompt(promptText: string, benchmarkId: string) {
  const match = /^#\s+(.+)$/m.exec(promptText);
  if (match?.[1]) {
    return match[1].trim();
  }
  return benchmarkId
    .split("-")
    .map((segment) => segment[0]?.toUpperCase() + segment.slice(1))
    .join(" ");
}

function stripPromptHeading(promptText: string) {
  return promptText.replace(/^#\s+.+\n+/m, "").trim();
}

function inferMimeType(fileName: string) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".csv")) return "text/csv";
  if (lower.endsWith(".json")) return "application/json";
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".zip")) return "application/zip";
  return "application/octet-stream";
}

function detectColumns(filePath: string, mimeType: string) {
  if (mimeType !== "text/csv") {
    return undefined;
  }
  const [headerLine = ""] = fs.readFileSync(filePath, "utf8").split(/\r?\n/, 1);
  const columns = headerLine
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  return columns.length > 0 ? columns : undefined;
}

function createUploadedArtifact(input: {
  benchmarkId: string;
  artifactPath: string;
  fileName: string;
}) {
  const mimeType = inferMimeType(input.fileName);
  return {
    id: input.fileName.replace(/\.[^.]+$/, ""),
    uri: `ipfs://${input.benchmarkId}/${input.fileName}`,
    file_name: input.fileName,
    mime_type: mimeType,
    size_bytes: fs.statSync(input.artifactPath).size,
    detected_columns: detectColumns(input.artifactPath, mimeType),
  } satisfies AuthoringArtifactOutput;
}

function payoutConditionForBenchmark(benchmark: BenchmarkJson) {
  if (benchmark.compile_invariants.metric === "exact_match") {
    return "Exact match against the hidden reference output wins.";
  }
  if (benchmark.compile_invariants.evaluator_archetype === "structured_record_score") {
    return "Highest deterministic validation score wins.";
  }
  if (benchmark.compile_invariants.metric === "r2") {
    return "Highest R2 wins.";
  }
  return `Best ${benchmark.compile_invariants.metric} result wins.`;
}

function solverInstructionsForBenchmark(benchmark: BenchmarkJson) {
  const submissionContract = benchmark.compile_invariants.submission_contract;
  if (submissionContract.kind === "csv_table") {
    const requiredColumns = submissionContract.required_columns?.join(", ");
    return requiredColumns
      ? `Submit one CSV with columns ${requiredColumns}.`
      : "Submit one CSV artifact matching the challenge contract.";
  }

  if (submissionContract.mime === "application/json") {
    return "Submit one deterministic JSON artifact.";
  }

  return "Submit one deterministic file artifact.";
}

function domainForBenchmark(benchmark: BenchmarkJson) {
  if (benchmark.intent_family === "prediction") {
    return "omics";
  }
  return "other";
}

function buildBenchmarkIntent(input: {
  benchmark: BenchmarkJson;
  promptText: string;
}): ChallengeIntentOutput {
  return {
    title: titleFromPrompt(input.promptText, input.benchmark.id),
    description: stripPromptHeading(input.promptText),
    payout_condition: payoutConditionForBenchmark(input.benchmark),
    reward_total: "25",
    distribution: "winner_take_all",
    deadline: "2026-12-31T00:00:00.000Z",
    dispute_window_hours: 168,
    domain: domainForBenchmark(input.benchmark),
    tags: [input.benchmark.intent_family],
    solver_instructions: solverInstructionsForBenchmark(input.benchmark),
    timezone: "UTC",
  };
}

export function loadAuthoringBenchmarkCases() {
  return fs
    .readdirSync(BENCHMARK_ROOT, {
      withFileTypes: true,
    })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .flatMap((benchmarkId) => {
      const benchmarkDir = path.join(BENCHMARK_ROOT, benchmarkId);
      const benchmark = JSON.parse(
        fs.readFileSync(path.join(benchmarkDir, "benchmark.json"), "utf8"),
      ) as BenchmarkJson;
      const uploadsDir = path.join(benchmarkDir, benchmark.artifacts_root);

      const uploadedArtifacts = benchmark.compile_invariants.artifact_roles.map(
        (artifact) =>
          createUploadedArtifact({
            benchmarkId,
            artifactPath: path.join(uploadsDir, artifact.file_name),
            fileName: artifact.file_name,
          }),
      );

      const artifactTextByUri = new Map<string, string>();
      for (const artifact of uploadedArtifacts) {
        const fileName = artifact.file_name;
        if (!fileName) {
          continue;
        }
        const mimeType = artifact.mime_type ?? inferMimeType(fileName);
        if (mimeType !== "text/csv" && mimeType !== "application/json") {
          continue;
        }
        artifactTextByUri.set(
          artifact.uri,
          fs.readFileSync(path.join(uploadsDir, fileName), "utf8"),
        );
      }

      return benchmark.prompt_variants.map((variant) => {
        const promptText = fs.readFileSync(
          path.join(benchmarkDir, variant.file),
          "utf8",
        );
        return {
          benchmark,
          benchmarkDir,
          variantId: variant.id,
          promptText,
          intent: buildBenchmarkIntent({
            benchmark,
            promptText,
          }),
          uploadedArtifacts,
          artifactTextByUri,
        } satisfies AuthoringBenchmarkCase;
      });
    });
}

export function buildAuthoringBenchmarkDependencies(
  benchmarkCase: AuthoringBenchmarkCase,
) {
  const metric = benchmarkCase.benchmark.compile_invariants.metric;
  const selectedMetricValue = metric === "exact_match" ? 1 : 0.97;
  const compilerResponse =
    benchmarkCase.benchmark.authoring_path_support === "supported"
      ? {
          preset_id: benchmarkCase.benchmark.compile_invariants.preset_id,
          metric,
          confidence_score: 0.91,
          reason_codes: ["benchmark_managed_fit"],
          warnings: [],
        }
      : {
          preset_id: "reproducibility",
          metric: "exact_match",
          confidence_score: 0.4,
          reason_codes: ["no_supported_runtime_signal"],
          warnings: [
            "Challenge description does not fit a managed template cleanly.",
          ],
        };

  return {
    fetchImpl: async (url: string | URL | Request) => {
      const requestUrl =
        typeof url === "string"
          ? url
          : url instanceof URL
            ? url.toString()
            : url.url;

      if (requestUrl.includes("ghcr.io/v2/")) {
        return new Response(null, {
          status: 200,
          headers: {
            "docker-content-digest":
              "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          },
        });
      }

      if (requestUrl.endsWith("/chat/completions")) {
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify(compilerResponse),
                },
              },
            ],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }

      throw new Error(
        `Unexpected fetch in authoring benchmark test: ${requestUrl}`,
      );
    },
    getTextImpl: async (uri: string) => {
      return benchmarkCase.artifactTextByUri.get(uri) ?? "";
    },
    executeScoringPipelineImpl: async (_input: unknown) => ({
      result: {
        ok: true,
        score: selectedMetricValue,
        details:
          metric === "exact_match"
            ? {
                selected_metric: metric,
                selected_metric_value: selectedMetricValue,
                matched_rows: 1,
                total_rows: 1,
              }
            : {
                selected_metric: metric,
                selected_metric_value: selectedMetricValue,
              },
        containerImageDigest:
          "ghcr.io/andymolecule/test-scorer@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        log: "",
        outputPath: "/tmp/output/score.json",
      },
      workspaceRoot: "/tmp/workspace",
      inputDir: "/tmp/workspace/input",
      evaluationBundlePath: "/tmp/workspace/input/evaluation",
      submissionPath: "/tmp/workspace/input/submission",
      runtimeConfigPath: "/tmp/workspace/input/agora-runtime.json",
      inputPaths: [],
      cleanup: async () => undefined,
    }),
  };
}
