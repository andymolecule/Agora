import type {
  AuthoringPartnerProviderOutput,
  CreateAuthoringSourceDraftRequestOutput,
} from "@agora/common";
import type { AgoraLogger } from "@agora/common/server-observability";
import {
  createAuthoringDraft,
  createPostingSession,
  createSupabaseClient,
  getPostingSessionById,
} from "@agora/db";
import { normalizeExternalArtifactsForDraft } from "./authoring-artifacts.js";
import { createDraft } from "./authoring-draft-transitions.js";
import { buildManagedAuthoringIr } from "./managed-authoring-ir.js";
import { EXTERNAL_DRAFT_EXPIRY_MS } from "./posting-session-helpers.js";

export async function createExternalAuthoringDraft(input: {
  provider: AuthoringPartnerProviderOutput;
  body: CreateAuthoringSourceDraftRequestOutput;
  createSupabaseClientImpl?: typeof createSupabaseClient;
  createAuthoringDraftImpl?: typeof createAuthoringDraft;
  createPostingSessionImpl?: typeof createPostingSession;
  getPostingSessionByIdImpl?: typeof getPostingSessionById;
  normalizeExternalArtifactsForDraftImpl?: typeof normalizeExternalArtifactsForDraft;
  logger?: AgoraLogger;
}) {
  const createSupabaseClientImpl =
    input.createSupabaseClientImpl ?? createSupabaseClient;
  const createAuthoringDraftImpl =
    input.createPostingSessionImpl && !input.createAuthoringDraftImpl
      ? undefined
      : (input.createAuthoringDraftImpl ?? createAuthoringDraft);
  const createPostingSessionImpl =
    input.createPostingSessionImpl ?? createPostingSession;
  const getPostingSessionByIdImpl =
    input.getPostingSessionByIdImpl ?? getPostingSessionById;
  const normalizeExternalArtifactsForDraftImpl =
    input.normalizeExternalArtifactsForDraftImpl ??
    normalizeExternalArtifactsForDraft;

  const uploadedArtifacts = await normalizeExternalArtifactsForDraftImpl({
    artifacts: input.body.artifacts,
  });
  const authoringIr = buildManagedAuthoringIr({
    intent: null,
    uploadedArtifacts,
    sourceTitle: input.body.title ?? null,
    sourceMessages: input.body.messages,
    origin: {
      provider: input.provider,
      external_id: input.body.external_id ?? null,
      external_url: input.body.external_url ?? null,
      raw_context: input.body.raw_context ?? null,
    },
  });
  const db = createSupabaseClientImpl(true);
  const session = await createDraft({
    db,
    state: "draft",
    authoringIrJson: authoringIr,
    uploadedArtifactsJson: uploadedArtifacts,
    expiresInMs: EXTERNAL_DRAFT_EXPIRY_MS,
    createAuthoringDraftImpl,
    createPostingSessionImpl,
    getPostingSessionByIdImpl,
  });

  input.logger?.info(
    {
      event: "authoring.drafts.created",
      provider: input.provider,
      draftId: session.id,
      ambiguityClasses: authoringIr.ambiguity.classes,
    },
    "Created authoring draft from external source",
  );

  return session;
}
