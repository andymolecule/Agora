import { randomUUID } from "node:crypto";
import {
  CHALLENGE_LIMITS,
  challengeIntentSchema,
  confirmPublishAuthoringSessionRequestSchema,
  createAuthoringSessionRequestSchema,
  defaultMinimumScoreForEvaluation,
  loadConfig,
  publishAuthoringSessionRequestSchema,
  readAuthoringSponsorRuntimeConfig,
  respondAuthoringSessionRequestSchema,
  SUBMISSION_LIMITS,
  uploadUrlRequestSchema,
  walletPublishPreparationSchema,
  type AuthoringSessionCreatorOutput,
} from "@agora/common";
import {
  type AuthoringSessionRow,
  AuthoringSessionWriteConflictError,
  createAuthoringSession,
  createSupabaseClient,
  getAuthoringSessionById,
  getChallengeById,
  listAuthoringSessionsByCreator,
  updateAuthoringSession,
} from "@agora/db";
import { pinJSON } from "@agora/ipfs";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { parseUnits, zeroAddress } from "viem";
import { z } from "zod";
import {
  type ChallengeRegistrationError,
  registerChallengeFromTxHash,
} from "../lib/challenge-registration.js";
import { compileManagedAuthoringSessionOutcome } from "../lib/managed-authoring.js";
import {
  buildManagedAuthoringIr,
  deriveManagedIntentCandidate,
  extractMissingIntentFields,
} from "../lib/managed-authoring-ir.js";
import { buildAuthoringQuestions } from "../lib/authoring-questions.js";
import { jsonAuthoringSessionApiError } from "../lib/authoring-session-api-error.js";
import {
  type StoredAuthoringSessionArtifact,
  createDirectAuthoringSessionArtifact,
  decodeAuthoringSessionArtifactId,
  mergeStoredArtifacts,
  normalizeAuthoringSessionFileInputs,
  toAuthoringSessionArtifactPayload,
} from "../lib/authoring-session-artifacts.js";
import {
  buildAuthoringSessionListItemPayload,
  buildAuthoringSessionPayload,
  buildSessionIntentCandidate,
  buildSessionQuestionDescriptors,
  isAuthoringSessionExpired,
  type SessionQuestionDescriptor,
} from "../lib/authoring-session-payloads.js";
import {
  sponsorAndPublishAuthoringSession,
} from "../lib/authoring-sponsored-publish.js";
import { requireWriteQuota } from "../middleware/rate-limit.js";
import {
  requireAuthoringPrincipal,
} from "../middleware/authoring-principal.js";
import type { ApiEnv } from "../types.js";

const INTERNAL_CREATED_TTL_MS = 15 * 60 * 1000;
const AWAITING_INPUT_TTL_MS = 24 * 60 * 60 * 1000;
const READY_TTL_MS = 2 * 60 * 60 * 1000;
const TERMINAL_TTL_MS = 0;
const DISTRIBUTION_TO_ENUM = {
  winner_take_all: 0,
  top_3: 1,
  proportional: 2,
} as const;

type AuthoringSessionRouteDependencies = {
  createSupabaseClient?: typeof createSupabaseClient;
  createAuthoringSession?: typeof createAuthoringSession;
  getAuthoringSessionById?: typeof getAuthoringSessionById;
  listAuthoringSessionsByCreator?: typeof listAuthoringSessionsByCreator;
  updateAuthoringSession?: typeof updateAuthoringSession;
  getChallengeById?: typeof getChallengeById;
  compileManagedAuthoringSessionOutcome?: typeof compileManagedAuthoringSessionOutcome;
  requireAuthoringPrincipalMiddleware?: MiddlewareHandler<ApiEnv>;
  requireWriteQuotaImpl?: typeof requireWriteQuota;
  sponsorAndPublishAuthoringSession?: typeof sponsorAndPublishAuthoringSession;
  createDirectAuthoringSessionArtifact?: typeof createDirectAuthoringSessionArtifact;
  normalizeAuthoringSessionFileInputs?: typeof normalizeAuthoringSessionFileInputs;
  registerChallengeFromTxHashImpl?: typeof registerChallengeFromTxHash;
};

function buildExpiry(offsetMs: number) {
  return new Date(Date.now() + offsetMs).toISOString();
}

function buildNowIso() {
  return new Date().toISOString();
}

function toUnixSeconds(iso: string) {
  const timestamp = new Date(iso).getTime();
  if (!Number.isFinite(timestamp)) {
    throw new Error(
      "Challenge deadline is invalid. Next step: fix the compiled deadline and retry publish.",
    );
  }
  return Math.floor(timestamp / 1000);
}

function buildWalletPublishPreparation(input: {
  session: AuthoringSessionRow;
  specCid: string;
}) {
  const challengeSpec = input.session.compilation_json?.challenge_spec;
  if (!challengeSpec) {
    throw new Error(
      "This session is missing a compiled challenge spec. Next step: recompile the session before publishing.",
    );
  }

  const config = loadConfig();
  return walletPublishPreparationSchema.parse({
    spec_cid: input.specCid,
    factory_address: config.AGORA_FACTORY_ADDRESS,
    usdc_address: config.AGORA_USDC_ADDRESS,
    reward_units: parseUnits(String(challengeSpec.reward.total), 6).toString(),
    deadline_seconds: toUnixSeconds(challengeSpec.deadline),
    dispute_window_hours:
      challengeSpec.dispute_window_hours ??
      CHALLENGE_LIMITS.defaultDisputeWindowHours,
    minimum_score_wad: parseUnits(
      String(
        challengeSpec.minimum_score ??
          defaultMinimumScoreForEvaluation(challengeSpec.evaluation) ??
          0,
      ),
      18,
    ).toString(),
    distribution_type:
      DISTRIBUTION_TO_ENUM[
        challengeSpec.reward.distribution as keyof typeof DISTRIBUTION_TO_ENUM
      ] ?? 0,
    lab_tba: zeroAddress,
    max_submissions_total:
      challengeSpec.max_submissions_total ?? SUBMISSION_LIMITS.maxPerChallenge,
    max_submissions_per_solver:
      challengeSpec.max_submissions_per_solver ??
      SUBMISSION_LIMITS.maxPerSolverPerChallenge,
  });
}

function buildPosterMessage(content: string) {
  return {
    id: `poster-${randomUUID()}`,
    role: "poster" as const,
    content,
    created_at: buildNowIso(),
  };
}

function cleanText(value?: string | null) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function appendFreeformContext(
  intentCandidate: Record<string, unknown>,
  contextText: string | null,
) {
  if (!contextText) {
    return intentCandidate;
  }

  if (typeof intentCandidate.description !== "string") {
    return {
      ...intentCandidate,
      description: contextText,
    };
  }

  const existingInstructions =
    typeof intentCandidate.solver_instructions === "string"
      ? intentCandidate.solver_instructions.trim()
      : "";

  return {
    ...intentCandidate,
    solver_instructions:
      existingInstructions.length > 0
        ? `${existingInstructions}\n\n${contextText}`
        : contextText,
  };
}

function buildCreateSourceMessages(input: {
  summary?: string;
  messages?: Array<{ text: string }>;
}) {
  const sourceMessages = [];
  const summary = cleanText(input.summary);
  if (summary) {
    sourceMessages.push(buildPosterMessage(summary));
  }

  for (const message of input.messages ?? []) {
    sourceMessages.push(buildPosterMessage(message.text));
  }

  return sourceMessages;
}

function buildRespondSourceMessages(input: {
  current: AuthoringSessionRow;
  context?: string;
}) {
  const sourceMessages = [
    ...(input.current.authoring_ir_json?.source.poster_messages ?? []),
  ];
  const context = cleanText(input.context);
  if (context) {
    sourceMessages.push(buildPosterMessage(context));
  }
  return sourceMessages;
}

function principalOwnsSession(
  session: AuthoringSessionRow,
  principal: AuthoringSessionCreatorOutput,
) {
  if (principal.type === "agent") {
    return (
      session.creator_type === "agent" &&
      session.creator_agent_id === principal.agent_id
    );
  }

  return (
    session.poster_address?.toLowerCase() === principal.address.toLowerCase()
  );
}

function creatorInsertFields(principal: AuthoringSessionCreatorOutput) {
  if (principal.type === "agent") {
    return {
      creator_type: "agent" as const,
      creator_agent_id: principal.agent_id,
      poster_address: null,
    };
  }

  return {
    creator_type: "web" as const,
    creator_agent_id: null,
    poster_address: principal.address,
  };
}

function creatorListFilter(principal: AuthoringSessionCreatorOutput) {
  if (principal.type === "agent") {
    return {
      type: "agent" as const,
      agentId: principal.agent_id,
    };
  }

  return {
    type: "web" as const,
    address: principal.address,
  };
}

function toOriginProvider(value?: string | null) {
  return value === "beach_science" ? "beach_science" : "direct";
}

function invalidRequestMessage(error: unknown) {
  if (
    error &&
    typeof error === "object" &&
    "issues" in error &&
    Array.isArray((error as { issues?: unknown[] }).issues)
  ) {
    const firstIssue = (error as { issues: Array<{ message?: string }> }).issues[0];
    if (typeof firstIssue?.message === "string" && firstIssue.message.length > 0) {
      return firstIssue.message;
    }
  }
  return "Invalid request body.";
}

async function parseJsonBody<T extends z.ZodTypeAny>(
  c: import("hono").Context<ApiEnv>,
  schema: T,
) {
  let body: unknown;

  try {
    body = await c.req.json();
  } catch {
    return {
      ok: false as const,
      response: jsonAuthoringSessionApiError(c, {
        status: 400,
        code: "invalid_request",
        message: "Request body must be valid JSON.",
        nextAction: "Fix the request body and retry.",
      }),
    };
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false as const,
      response: jsonAuthoringSessionApiError(c, {
        status: 400,
        code: "invalid_request",
        message: invalidRequestMessage(parsed.error),
        nextAction: "Fix the request body and retry.",
      }),
    };
  }

  return {
    ok: true as const,
    data: parsed.data as z.infer<T>,
  };
}

async function readDirectUpload(
  c: import("hono").Context<ApiEnv>,
): Promise<{ bytes: Uint8Array; fileName: string | null } | null> {
  const contentType = c.req.header("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    const formData = await c.req.raw.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return null;
    }
    return {
      bytes: new Uint8Array(await file.arrayBuffer()),
      fileName: file.name,
    };
  }

  if (contentType.includes("application/json")) {
    return null;
  }

  const bytes = new Uint8Array(await c.req.raw.arrayBuffer());
  if (bytes.byteLength === 0) {
    return null;
  }

  return {
    bytes,
    fileName: c.req.header("x-file-name") ?? null,
  };
}

function normalizeFileName(fileName: string | null) {
  const normalized = fileName?.trim();
  return normalized && normalized.length > 0 ? normalized : "artifact";
}

function collectAnswerArtifacts(input: {
  answers?: Array<{ question_id: string; value: string | { type: "artifact"; artifact_id: string } }>;
}) {
  const artifacts: StoredAuthoringSessionArtifact[] = [];
  for (const answer of input.answers ?? []) {
    if (typeof answer.value === "string") {
      continue;
    }
    artifacts.push(decodeAuthoringSessionArtifactId(answer.value.artifact_id));
  }
  return artifacts;
}

function resolveQuestionById(
  session: AuthoringSessionRow,
  questionId: string,
) {
  return buildSessionQuestionDescriptors(session.authoring_ir_json).find(
    (question) => question.id === questionId,
  );
}

function buildArtifactAssignmentsOverride(input: {
  session: AuthoringSessionRow;
  uploadedArtifacts: StoredAuthoringSessionArtifact[];
  answers?: Array<{ question_id: string; value: string | { type: "artifact"; artifact_id: string } }>;
}) {
  const assignments = new Map<
    string,
    { artifactIndex: number; role: string; visibility: "public" | "private" }
  >();

  for (const assignment of input.session.authoring_ir_json?.evaluation
    .artifact_assignments ?? []) {
    assignments.set(assignment.role, {
      artifactIndex: assignment.artifact_index,
      role: assignment.role,
      visibility: assignment.visibility,
    });
  }

  for (const answer of input.answers ?? []) {
    const question = resolveQuestionById(input.session, answer.question_id);
    if (!question?.role || typeof answer.value === "string") {
      continue;
    }

    const artifact = decodeAuthoringSessionArtifactId(answer.value.artifact_id);
    const artifactIndex = input.uploadedArtifacts.findIndex(
      (candidate) =>
        candidate.id === artifact.id || candidate.uri === artifact.uri,
    );
    if (artifactIndex < 0) {
      continue;
    }

    assignments.set(question.role, {
      artifactIndex,
      role: question.role,
      visibility:
        question.role === "hidden_labels" ||
        question.role === "reference_ranking" ||
        question.role === "reference_scores"
          ? "private"
          : "public",
    });
  }

  return Array.from(assignments.values());
}

function applyAnswerPatch(input: {
  session: AuthoringSessionRow;
  answers?: Array<{ question_id: string; value: string | { type: "artifact"; artifact_id: string } }>;
}) {
  const intentCandidate = buildSessionIntentCandidate(input.session);
  let metricOverride =
    input.session.compilation_json?.metric ??
    input.session.authoring_ir_json?.evaluation.metric ??
    null;

  for (const answer of input.answers ?? []) {
    const question = resolveQuestionById(input.session, answer.question_id);
    if (!question) {
      throw new Error(
        "Answer references an unknown question_id. Next step: reload the session and answer one of the current pending questions.",
      );
    }

    if (question.kind === "file") {
      if (typeof answer.value === "string") {
        throw new Error(
          "File questions require an artifact reference answer. Next step: upload the file first, then retry with the returned artifact_id.",
        );
      }
      continue;
    }

    if (typeof answer.value !== "string") {
      throw new Error(
        "This question expects a text or select answer. Next step: send a string value and retry.",
      );
    }

    if (
      question.kind === "select" &&
      question.options &&
      !question.options.includes(answer.value)
    ) {
      throw new Error(
        "Answer value is not one of the allowed options. Next step: choose one of the current question options and retry.",
      );
    }

    switch (question.field) {
      case "title":
        intentCandidate.title = answer.value;
        break;
      case "description":
        intentCandidate.description = answer.value;
        break;
      case "payout_condition":
        intentCandidate.payout_condition = answer.value;
        break;
      case "reward_total":
        intentCandidate.reward_total = answer.value;
        break;
      case "distribution":
        intentCandidate.distribution = answer.value as
          | "winner_take_all"
          | "top_3"
          | "proportional";
        break;
      case "deadline":
        intentCandidate.deadline = answer.value;
        break;
      case "metric":
        metricOverride = answer.value;
        break;
      default:
        break;
    }
  }

  return {
    intentCandidate,
    metricOverride,
  };
}

async function ensureSessionVisibility(
  c: import("hono").Context<ApiEnv>,
  db: ReturnType<typeof createSupabaseClient>,
  session: AuthoringSessionRow | null,
  updateAuthoringSessionImpl: typeof updateAuthoringSession,
) {
  const principal = c.get("authoringPrincipal");
  if (!session || !principalOwnsSession(session, principal)) {
    return {
      ok: false as const,
      response: jsonAuthoringSessionApiError(c, {
        status: 404,
        code: "not_found",
        message: "Session not found.",
        nextAction: "Check the session ID or create a new session.",
      }),
    };
  }

  if (isAuthoringSessionExpired(session)) {
    const expired =
      session.state === "expired"
        ? session
        : await updateAuthoringSessionImpl(db, {
            id: session.id,
            state: "expired",
            expires_at: buildNowIso(),
          });
    return {
      ok: true as const,
      session: expired,
    };
  }

  return {
    ok: true as const,
    session,
  };
}

async function maybeReadChallenge(
  getChallengeByIdImpl: typeof getChallengeById,
  db: ReturnType<typeof createSupabaseClient>,
  session: AuthoringSessionRow,
) {
  if (!session.published_challenge_id) {
    return null;
  }

  try {
    const challenge = await getChallengeByIdImpl(db, session.published_challenge_id);
    return {
      id: challenge.id as string,
      contract_address: challenge.contract_address as string,
      tx_hash: challenge.tx_hash as string,
    };
  } catch {
    return null;
  }
}

function nextEditableStateError(
  c: import("hono").Context<ApiEnv>,
  session: AuthoringSessionRow,
) {
  return jsonAuthoringSessionApiError(c, {
    status: 400,
    code:
      session.state === "expired" ? "session_expired" : "invalid_request",
    message:
      session.state === "ready"
        ? "This session is ready for publish and cannot accept more input."
        : session.state === "published"
          ? "This session has already been published and cannot accept more input."
          : session.state === "rejected"
            ? "This session was rejected and cannot accept more input."
            : "This session has expired.",
    nextAction:
      session.state === "expired"
        ? "Create a new session to continue."
        : "Create a new session to make changes.",
    ...(session.state === "expired"
      ? { state: "expired" as const }
      : undefined),
  });
}

async function persistAssessmentResult(input: {
  db: ReturnType<typeof createSupabaseClient>;
  session: AuthoringSessionRow | null;
  principal: AuthoringSessionCreatorOutput;
  intentCandidate: Record<string, unknown>;
  sourceMessages: Array<{
    id: string;
    role: "poster" | "participant" | "system";
    content: string;
    created_at: string;
  }>;
  origin?: {
    provider: "direct" | "beach_science";
    external_id?: string | null;
    external_url?: string | null;
  };
  uploadedArtifacts: StoredAuthoringSessionArtifact[];
  compileManagedAuthoringSessionOutcomeImpl: typeof compileManagedAuthoringSessionOutcome;
  createAuthoringSessionImpl: typeof createAuthoringSession;
  updateAuthoringSessionImpl: typeof updateAuthoringSession;
  runtimeFamilyOverride?: string | null;
  metricOverride?: string | null;
  artifactAssignmentsOverride?: Array<{
    artifactIndex: number;
    role: string;
    visibility: "public" | "private";
  }>;
}) {
  const sourceTitle =
    cleanText(
      typeof input.intentCandidate.title === "string"
        ? input.intentCandidate.title
        : null,
    ) ??
    input.sourceMessages[0]?.content ??
    null;
  const effectiveIntentCandidate = deriveManagedIntentCandidate({
    intent: input.intentCandidate,
    sourceTitle,
  });

  const missingFields = extractMissingIntentFields(effectiveIntentCandidate);

  if (missingFields.length > 0) {
    const questions = buildAuthoringQuestions({
      missingFields,
      uploadedArtifacts: input.uploadedArtifacts,
    });
    const authoringIr = buildManagedAuthoringIr({
      intent: effectiveIntentCandidate,
      uploadedArtifacts: input.uploadedArtifacts,
      sourceTitle,
      sourceMessages: input.sourceMessages,
      origin:
        input.origin ??
        input.session?.authoring_ir_json?.origin ?? { provider: "direct" },
      questions,
      assessmentOutcome: "awaiting_input",
      missingFields,
    });

    if (input.session) {
      return input.updateAuthoringSessionImpl(input.db, {
        id: input.session.id,
        expected_updated_at: input.session.updated_at,
        state: "awaiting_input",
        authoring_ir_json: authoringIr,
        uploaded_artifacts_json: input.uploadedArtifacts,
        intent_json: null,
        compilation_json: null,
        failure_message: null,
        expires_at: buildExpiry(AWAITING_INPUT_TTL_MS),
      });
    }

    return input.createAuthoringSessionImpl(input.db, {
      ...creatorInsertFields(input.principal),
      state: "awaiting_input",
      authoring_ir_json: authoringIr,
      uploaded_artifacts_json: input.uploadedArtifacts,
      expires_at: buildExpiry(AWAITING_INPUT_TTL_MS),
    });
  }

  const parsedIntent = challengeIntentSchema.parse(effectiveIntentCandidate);
  const outcome = await input.compileManagedAuthoringSessionOutcomeImpl(
    {
      intent: parsedIntent,
      uploadedArtifacts: input.uploadedArtifacts,
      runtimeFamilyOverride:
        input.runtimeFamilyOverride && input.runtimeFamilyOverride.length > 0
          ? (input.runtimeFamilyOverride as
              | "reproducibility"
              | "tabular_regression"
              | "tabular_classification"
              | "ranking"
              | "docking")
          : undefined,
      metricOverride: input.metricOverride ?? undefined,
      artifactAssignmentsOverride: input.artifactAssignmentsOverride,
    },
    {},
  );

  const state =
    outcome.state === "ready"
      ? "ready"
      : outcome.state === "awaiting_input"
        ? "awaiting_input"
        : "rejected";
  const expiresAt =
    state === "ready"
      ? buildExpiry(READY_TTL_MS)
      : state === "awaiting_input"
        ? buildExpiry(AWAITING_INPUT_TTL_MS)
        : buildExpiry(TERMINAL_TTL_MS);

  if (input.session) {
    return input.updateAuthoringSessionImpl(input.db, {
      id: input.session.id,
      expected_updated_at: input.session.updated_at,
      state,
      intent_json: parsedIntent,
      authoring_ir_json: outcome.authoringIr,
      uploaded_artifacts_json: input.uploadedArtifacts,
      compilation_json: outcome.compilation ?? null,
      failure_message: state === "rejected" ? outcome.message ?? null : null,
      expires_at: expiresAt,
    });
  }

  return input.createAuthoringSessionImpl(input.db, {
    ...creatorInsertFields(input.principal),
    state,
    intent_json: parsedIntent,
    authoring_ir_json: outcome.authoringIr,
    uploaded_artifacts_json: input.uploadedArtifacts,
    compilation_json: outcome.compilation ?? null,
    failure_message: state === "rejected" ? outcome.message ?? null : null,
    expires_at: expiresAt,
  });
}

export function createAuthoringSessionRoutes(
  dependencies: AuthoringSessionRouteDependencies = {},
) {
  const router = new Hono<ApiEnv>();
  const {
    createSupabaseClient: createSupabaseClientImpl = createSupabaseClient,
    createAuthoringSession: createAuthoringSessionImpl = createAuthoringSession,
    getAuthoringSessionById: getAuthoringSessionByIdImpl =
      getAuthoringSessionById,
    listAuthoringSessionsByCreator: listAuthoringSessionsByCreatorImpl =
      listAuthoringSessionsByCreator,
    updateAuthoringSession: updateAuthoringSessionImpl = updateAuthoringSession,
    getChallengeById: getChallengeByIdImpl = getChallengeById,
    compileManagedAuthoringSessionOutcome:
      compileManagedAuthoringSessionOutcomeImpl =
        compileManagedAuthoringSessionOutcome,
    requireAuthoringPrincipalMiddleware = requireAuthoringPrincipal,
    requireWriteQuotaImpl = requireWriteQuota,
    sponsorAndPublishAuthoringSession:
      sponsorAndPublishAuthoringSessionImpl = sponsorAndPublishAuthoringSession,
    createDirectAuthoringSessionArtifact:
      createDirectAuthoringSessionArtifactImpl =
        createDirectAuthoringSessionArtifact,
    normalizeAuthoringSessionFileInputs:
      normalizeAuthoringSessionFileInputsImpl =
        normalizeAuthoringSessionFileInputs,
    registerChallengeFromTxHashImpl = registerChallengeFromTxHash,
  } = dependencies;

  router.get(
    "/sessions",
    requireAuthoringPrincipalMiddleware,
    async (c) => {
      const db = createSupabaseClientImpl(true);
      const sessions = await listAuthoringSessionsByCreatorImpl(
        db,
        creatorListFilter(c.get("authoringPrincipal")),
      );
      return c.json({
        sessions: sessions.map((session) =>
          buildAuthoringSessionListItemPayload(session),
        ),
      });
    },
  );

  router.get(
    "/sessions/:id",
    requireAuthoringPrincipalMiddleware,
    async (c) => {
      const db = createSupabaseClientImpl(true);
      const session = await getAuthoringSessionByIdImpl(db, c.req.param("id"));
      const visible = await ensureSessionVisibility(
        c,
        db,
        session,
        updateAuthoringSessionImpl,
      );
      if (!visible.ok) {
        return visible.response;
      }

      const challenge = await maybeReadChallenge(
        getChallengeByIdImpl,
        db,
        visible.session,
      );
      return c.json(buildAuthoringSessionPayload(visible.session, { challenge }));
    },
  );

  router.post(
    "/sessions",
    requireAuthoringPrincipalMiddleware,
    requireWriteQuotaImpl("/api/authoring/sessions"),
    async (c) => {
      const parsed = await parseJsonBody(c, createAuthoringSessionRequestSchema);
      if (!parsed.ok) {
        return parsed.response;
      }

      const db = createSupabaseClientImpl(true);
      const incomingArtifacts = parsed.data.files?.length
        ? await normalizeAuthoringSessionFileInputsImpl({
            files: parsed.data.files,
          })
        : [];
      const sourceMessages = buildCreateSourceMessages({
        summary: parsed.data.summary,
        messages: parsed.data.messages,
      });
      const freeformSeed =
        cleanText(parsed.data.summary) ??
        parsed.data.messages?.map((message) => message.text).join("\n\n") ??
        null;
      const intentCandidate = appendFreeformContext({}, freeformSeed);

      const session = await persistAssessmentResult({
        db,
        session: null,
        principal: c.get("authoringPrincipal"),
        intentCandidate,
        sourceMessages,
        origin: parsed.data.provenance
          ? {
              provider: toOriginProvider(parsed.data.provenance.source),
              external_id: parsed.data.provenance.external_id ?? null,
              external_url: parsed.data.provenance.source_url ?? null,
            }
          : undefined,
        uploadedArtifacts: incomingArtifacts,
        compileManagedAuthoringSessionOutcomeImpl,
        createAuthoringSessionImpl,
        updateAuthoringSessionImpl,
      });

      return c.json(buildAuthoringSessionPayload(session));
    },
  );

  router.post(
    "/sessions/:id/respond",
    requireAuthoringPrincipalMiddleware,
    requireWriteQuotaImpl("/api/authoring/sessions/respond"),
    async (c) => {
      const parsed = await parseJsonBody(c, respondAuthoringSessionRequestSchema);
      if (!parsed.ok) {
        return parsed.response;
      }

      const db = createSupabaseClientImpl(true);
      const current = await getAuthoringSessionByIdImpl(db, c.req.param("id"));
      const visible = await ensureSessionVisibility(
        c,
        db,
        current,
        updateAuthoringSessionImpl,
      );
      if (!visible.ok) {
        return visible.response;
      }

      if (visible.session.state === "expired") {
        return jsonAuthoringSessionApiError(c, {
          status: 409,
          code: "session_expired",
          message: "This session has expired.",
          nextAction: "Create a new session to continue.",
          state: "expired",
        });
      }

      if (
        visible.session.state === "ready" ||
        visible.session.state === "published" ||
        visible.session.state === "rejected"
      ) {
        return nextEditableStateError(c, visible.session);
      }

      let questionPatch;
      try {
        questionPatch = applyAnswerPatch({
          session: visible.session,
          answers: parsed.data.answers,
        });
      } catch (error) {
        return jsonAuthoringSessionApiError(c, {
          status: 400,
          code: "invalid_request",
          message:
            error instanceof Error ? error.message : "Invalid respond payload.",
          nextAction: "Fix the request body and retry.",
        });
      }

      const artifactsFromAnswers = collectAnswerArtifacts({
        answers: parsed.data.answers,
      });
      const artifactsFromFiles = parsed.data.files?.length
        ? await normalizeAuthoringSessionFileInputsImpl({
            files: parsed.data.files,
          })
        : [];
      const currentArtifacts = (visible.session.uploaded_artifacts_json ??
        []) as StoredAuthoringSessionArtifact[];
      const uploadedArtifacts = mergeStoredArtifacts(currentArtifacts, [
        ...artifactsFromAnswers,
        ...artifactsFromFiles,
      ]);
      const intentCandidate = appendFreeformContext(
        questionPatch.intentCandidate,
        cleanText(parsed.data.context),
      );
      const sourceMessages = buildRespondSourceMessages({
        current: visible.session,
        context: parsed.data.context,
      });
      const artifactAssignmentsOverride = buildArtifactAssignmentsOverride({
        session: visible.session,
        uploadedArtifacts,
        answers: parsed.data.answers,
      });
      const runtimeFamilyOverride =
        visible.session.compilation_json?.runtime_family ??
        visible.session.authoring_ir_json?.evaluation.runtime_family ??
        null;

      try {
        const session = await persistAssessmentResult({
          db,
          session: visible.session,
          principal: c.get("authoringPrincipal"),
          intentCandidate,
          sourceMessages,
          origin: visible.session.authoring_ir_json?.origin,
          uploadedArtifacts,
          compileManagedAuthoringSessionOutcomeImpl,
          createAuthoringSessionImpl,
          updateAuthoringSessionImpl,
          runtimeFamilyOverride,
          metricOverride: questionPatch.metricOverride,
          artifactAssignmentsOverride,
        });

        return c.json(buildAuthoringSessionPayload(session));
      } catch (error) {
        if (error instanceof AuthoringSessionWriteConflictError) {
          return jsonAuthoringSessionApiError(c, {
            status: 409,
            code: "invalid_request",
            message: error.message,
            nextAction: "Reload the latest session and retry.",
          });
        }
        throw error;
      }
    },
  );

  router.post(
    "/sessions/:id/publish",
    requireAuthoringPrincipalMiddleware,
    requireWriteQuotaImpl("/api/authoring/sessions/publish"),
    async (c) => {
      const parsed = await parseJsonBody(c, publishAuthoringSessionRequestSchema);
      if (!parsed.ok) {
        return parsed.response;
      }

      const db = createSupabaseClientImpl(true);
      const current = await getAuthoringSessionByIdImpl(db, c.req.param("id"));
      const visible = await ensureSessionVisibility(
        c,
        db,
        current,
        updateAuthoringSessionImpl,
      );
      if (!visible.ok) {
        return visible.response;
      }

      if (visible.session.state === "expired") {
        return jsonAuthoringSessionApiError(c, {
          status: 409,
          code: "session_expired",
          message: "This session has expired.",
          nextAction: "Create a new session to continue.",
          state: "expired",
        });
      }

      if (visible.session.state !== "ready" || !visible.session.compilation_json) {
        return jsonAuthoringSessionApiError(c, {
          status: 400,
          code: "invalid_request",
          message: "This session is not ready to publish.",
          nextAction: "Continue the session until it reaches ready, then retry publish.",
        });
      }

      const principal = c.get("authoringPrincipal");
      if (principal.type === "agent" && parsed.data.funding !== "sponsor") {
        return jsonAuthoringSessionApiError(c, {
          status: 400,
          code: "invalid_request",
          message: "Agent sessions currently publish with sponsor funding only.",
          nextAction: "Retry publish with funding set to sponsor.",
        });
      }

      if (principal.type === "web" && parsed.data.funding !== "wallet") {
        return jsonAuthoringSessionApiError(c, {
          status: 400,
          code: "invalid_request",
          message: "Web sessions currently publish with wallet funding only.",
          nextAction: "Retry publish with funding set to wallet.",
        });
      }

      if (parsed.data.funding === "wallet") {
        const specCid =
          visible.session.published_spec_cid ??
          (await pinJSON(
            `challenge-${visible.session.id}`,
            visible.session.compilation_json.challenge_spec,
          ));
        return c.json(
          buildWalletPublishPreparation({
            session: visible.session,
            specCid,
          }),
        );
      }

      const specCid =
        visible.session.published_spec_cid ??
        (await pinJSON(
          `challenge-${visible.session.id}`,
          visible.session.compilation_json.challenge_spec,
        ));
      const sponsorRuntime = readAuthoringSponsorRuntimeConfig();
      if (!sponsorRuntime.privateKey) {
        return jsonAuthoringSessionApiError(c, {
          status: 503,
          code: "invalid_request",
          message: "Agora sponsor publishing is not configured on this API runtime.",
          nextAction: "Configure the Agora sponsor private key, then retry publish.",
        });
      }
      const result = await sponsorAndPublishAuthoringSessionImpl({
        db,
        session: visible.session,
        spec: visible.session.compilation_json.challenge_spec,
        specCid,
        sponsorPrivateKey: sponsorRuntime.privateKey,
        expiresInMs: TERMINAL_TTL_MS,
      });

      const challenge = await maybeReadChallenge(
        getChallengeByIdImpl,
        db,
        result.session,
      );
      return c.json(buildAuthoringSessionPayload(result.session, { challenge }));
    },
  );

  router.post(
    "/sessions/:id/confirm-publish",
    requireAuthoringPrincipalMiddleware,
    requireWriteQuotaImpl("/api/authoring/sessions/confirm-publish"),
    async (c) => {
      const parsed = await parseJsonBody(
        c,
        confirmPublishAuthoringSessionRequestSchema,
      );
      if (!parsed.ok) {
        return parsed.response;
      }

      const db = createSupabaseClientImpl(true);
      const current = await getAuthoringSessionByIdImpl(db, c.req.param("id"));
      const visible = await ensureSessionVisibility(
        c,
        db,
        current,
        updateAuthoringSessionImpl,
      );
      if (!visible.ok) {
        return visible.response;
      }

      if (visible.session.state === "expired") {
        return jsonAuthoringSessionApiError(c, {
          status: 409,
          code: "session_expired",
          message: "This session has expired.",
          nextAction: "Create a new session to continue.",
          state: "expired",
        });
      }

      if (visible.session.state !== "ready" || !visible.session.compilation_json) {
        return jsonAuthoringSessionApiError(c, {
          status: 400,
          code: "invalid_request",
          message: "This session is not ready to confirm publish.",
          nextAction:
            "Prepare wallet publish from a ready session, then retry confirm-publish.",
        });
      }

      const principal = c.get("authoringPrincipal");
      if (principal.type !== "web" || !visible.session.poster_address) {
        return jsonAuthoringSessionApiError(c, {
          status: 400,
          code: "invalid_request",
          message:
            "Confirm-publish is only available for wallet-funded web sessions.",
          nextAction:
            "Use sponsor publish for agent-owned sessions, or confirm from the session creator wallet.",
        });
      }

      let registration;
      try {
        registration = await registerChallengeFromTxHashImpl({
          db,
          txHash: parsed.data.tx_hash as `0x${string}`,
          expectedPosterAddress: visible.session.poster_address as `0x${string}`,
          expectedSpec: visible.session.compilation_json.challenge_spec,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unable to confirm publish.";
        return jsonAuthoringSessionApiError(c, {
          status: 400,
          code: "invalid_request",
          message,
          nextAction:
            "Verify the wallet transaction hash belongs to this session publish, then retry confirm-publish.",
        });
      }

      try {
        const published = await updateAuthoringSessionImpl(db, {
          id: visible.session.id,
          expected_updated_at: visible.session.updated_at,
          state: "published",
          published_challenge_id: registration.challengeRow.id,
          published_spec_json: registration.spec,
          published_spec_cid: registration.specCid,
          published_at: buildNowIso(),
          expires_at: buildExpiry(TERMINAL_TTL_MS),
          failure_message: null,
        });

        return c.json(
          buildAuthoringSessionPayload(published, {
            challenge: {
              id: registration.challengeRow.id,
              contract_address: registration.challengeAddress,
              tx_hash: parsed.data.tx_hash,
            },
          }),
        );
      } catch (error) {
        if (error instanceof AuthoringSessionWriteConflictError) {
          return jsonAuthoringSessionApiError(c, {
            status: 400,
            code: "invalid_request",
            message: error.message,
            nextAction: "Reload the latest session and retry confirm-publish.",
          });
        }
        throw error;
      }
    },
  );

  router.post(
    "/uploads",
    requireAuthoringPrincipalMiddleware,
    requireWriteQuotaImpl("/api/authoring/uploads"),
    async (c) => {
      const directUpload = await readDirectUpload(c);
      if (directUpload) {
        const artifact = await createDirectAuthoringSessionArtifactImpl({
          bytes: directUpload.bytes,
          fileName: normalizeFileName(directUpload.fileName),
        });
        return c.json(toAuthoringSessionArtifactPayload(artifact));
      }

      const parsed = await parseJsonBody(c, uploadUrlRequestSchema);
      if (!parsed.ok) {
        return parsed.response;
      }

      const [artifact] = await normalizeAuthoringSessionFileInputsImpl({
        files: [{ type: "url", url: parsed.data.url }],
      });
      if (!artifact) {
        return jsonAuthoringSessionApiError(c, {
          status: 400,
          code: "invalid_request",
          message: "Upload request did not produce an artifact.",
          nextAction: "Provide a valid file upload or URL and retry.",
        });
      }
      return c.json(toAuthoringSessionArtifactPayload(artifact));
    },
  );

  return router;
}

export default createAuthoringSessionRoutes();
