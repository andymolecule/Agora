import type {
  AuthoringPartnerProviderOutput,
  CreateAuthoringSourceDraftRequestOutput,
} from "@agora/common";
import type { AgoraLogger } from "@agora/common/server-observability";
import {
  createAuthoringDraft,
  createSupabaseClient,
  getAuthoringDraftViewById,
} from "@agora/db";
import { normalizeExternalArtifactsForDraft } from "./authoring-artifacts.js";
import { EXTERNAL_DRAFT_EXPIRY_MS } from "./authoring-draft-payloads.js";
import { createDraft } from "./authoring-draft-transitions.js";
import { buildManagedAuthoringIr } from "./managed-authoring-ir.js";

export async function createExternalAuthoringDraft(input: {
  provider: AuthoringPartnerProviderOutput;
  body: CreateAuthoringSourceDraftRequestOutput;
  createSupabaseClientImpl?: typeof createSupabaseClient;
  createAuthoringDraftImpl?: typeof createAuthoringDraft;
  getAuthoringDraftViewByIdImpl?: typeof getAuthoringDraftViewById;
  normalizeExternalArtifactsForDraftImpl?: typeof normalizeExternalArtifactsForDraft;
  logger?: AgoraLogger;
}) {
  const createSupabaseClientImpl =
    input.createSupabaseClientImpl ?? createSupabaseClient;
  const createAuthoringDraftImpl =
    input.createAuthoringDraftImpl ?? createAuthoringDraft;
  const getAuthoringDraftViewByIdImpl =
    input.getAuthoringDraftViewByIdImpl ?? getAuthoringDraftViewById;
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
    getAuthoringDraftViewByIdImpl,
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
