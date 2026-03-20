import type {
  AuthoringDraftState,
  ChallengeAuthoringIrOutput,
  ChallengeIntentOutput,
  CompilationResultOutput,
} from "@agora/common";
import type {
  AuthoringArtifactOutput,
  ChallengeSpecOutput,
} from "@agora/common";
import type { AgoraLogger } from "@agora/common/server-observability";
import {
  type AuthoringDraftViewRow,
  type PublishedChallengeLinkRow,
  createAuthoringDraft,
  getAuthoringDraftViewById,
  updateAuthoringDraft,
  upsertAuthoringCallbackTarget,
  upsertPublishedChallengeLink,
} from "@agora/db";
import { buildExpiry } from "./authoring-draft-payloads.js";

async function reloadDraftViewOrThrow(
  db: Parameters<typeof getAuthoringDraftViewById>[0],
  draftId: string,
  getAuthoringDraftViewByIdImpl: typeof getAuthoringDraftViewById = getAuthoringDraftViewById,
) {
  const draft = await getAuthoringDraftViewByIdImpl(db, draftId);
  if (!draft) {
    throw new Error(
      `Authoring draft ${draftId} could not be reloaded. Next step: retry the request and inspect the draft storage path.`,
    );
  }
  return draft;
}

function logDraftTransition(input: {
  logger?: AgoraLogger;
  event: string;
  message: string;
  draft: Pick<AuthoringDraftViewRow, "id" | "state">;
  publishedSpecCid?: string | null;
  challengeId?: string | null;
  callbackUrl?: string | null;
}) {
  input.logger?.info(
    {
      event: input.event,
      draftId: input.draft.id,
      state: input.draft.state,
      publishedSpecCid: input.publishedSpecCid ?? null,
      challengeId: input.challengeId ?? null,
      callbackUrl: input.callbackUrl ?? null,
    },
    input.message,
  );
}

export async function createDraft(input: {
  db: Parameters<typeof createAuthoringDraft>[0];
  state: AuthoringDraftState;
  posterAddress?: string | null;
  intentJson?: ChallengeIntentOutput | null;
  authoringIrJson?: ChallengeAuthoringIrOutput | null;
  uploadedArtifactsJson?: AuthoringArtifactOutput[];
  compilationJson?: CompilationResultOutput | null;
  expiresInMs: number;
  failureMessage?: string | null;
  createAuthoringDraftImpl?: typeof createAuthoringDraft;
  getAuthoringDraftViewByIdImpl?: typeof getAuthoringDraftViewById;
  logger?: AgoraLogger;
}) {
  const draft = await (input.createAuthoringDraftImpl ?? createAuthoringDraft)(
    input.db,
    {
      poster_address: input.posterAddress ?? null,
      state: input.state,
      intent_json: input.intentJson ?? null,
      authoring_ir_json: input.authoringIrJson ?? null,
      uploaded_artifacts_json: input.uploadedArtifactsJson ?? [],
      compilation_json: input.compilationJson ?? null,
      failure_message: input.failureMessage ?? null,
      expires_at: buildExpiry(input.expiresInMs),
    },
  );

  const createdDraft = await reloadDraftViewOrThrow(
    input.db,
    draft.id,
    input.getAuthoringDraftViewByIdImpl,
  );
  logDraftTransition({
    logger: input.logger,
    event: "authoring.draft.created",
    message: "Created authoring draft",
    draft: createdDraft,
  });
  return createdDraft;
}

export async function refreshDraftIr(input: {
  db: Parameters<typeof updateAuthoringDraft>[0];
  draft: Pick<AuthoringDraftViewRow, "id" | "updated_at">;
  state: AuthoringDraftState;
  intentJson?: ChallengeIntentOutput | null;
  authoringIrJson: ChallengeAuthoringIrOutput;
  uploadedArtifactsJson: AuthoringArtifactOutput[];
  expiresInMs: number;
  updateAuthoringDraftImpl?: typeof updateAuthoringDraft;
  getAuthoringDraftViewByIdImpl?: typeof getAuthoringDraftViewById;
  logger?: AgoraLogger;
}) {
  await (input.updateAuthoringDraftImpl ?? updateAuthoringDraft)(input.db, {
    id: input.draft.id,
    expected_updated_at: input.draft.updated_at,
    state: input.state,
    intent_json: input.intentJson,
    authoring_ir_json: input.authoringIrJson,
    uploaded_artifacts_json: input.uploadedArtifactsJson,
    compilation_json: null,
    failure_message: null,
    expires_at: buildExpiry(input.expiresInMs),
  });

  const refreshedDraft = await reloadDraftViewOrThrow(
    input.db,
    input.draft.id,
    input.getAuthoringDraftViewByIdImpl,
  );
  logDraftTransition({
    logger: input.logger,
    event: "authoring.draft.ir_refreshed",
    message: "Refreshed authoring draft IR",
    draft: refreshedDraft,
  });
  return refreshedDraft;
}

export async function markDraftCompiling(input: {
  db: Parameters<typeof updateAuthoringDraft>[0];
  draft: Pick<AuthoringDraftViewRow, "id" | "updated_at">;
  posterAddress?: string | null;
  intentJson: ChallengeIntentOutput;
  authoringIrJson: ChallengeAuthoringIrOutput;
  expiresInMs: number;
  updateAuthoringDraftImpl?: typeof updateAuthoringDraft;
  getAuthoringDraftViewByIdImpl?: typeof getAuthoringDraftViewById;
  logger?: AgoraLogger;
}) {
  await (input.updateAuthoringDraftImpl ?? updateAuthoringDraft)(input.db, {
    id: input.draft.id,
    expected_updated_at: input.draft.updated_at,
    poster_address: input.posterAddress,
    state: "compiling",
    intent_json: input.intentJson,
    authoring_ir_json: input.authoringIrJson,
    compilation_json: null,
    failure_message: null,
    expires_at: buildExpiry(input.expiresInMs),
  });

  const compilingDraft = await reloadDraftViewOrThrow(
    input.db,
    input.draft.id,
    input.getAuthoringDraftViewByIdImpl,
  );
  logDraftTransition({
    logger: input.logger,
    event: "authoring.draft.compiling",
    message: "Marked authoring draft as compiling",
    draft: compilingDraft,
  });
  return compilingDraft;
}

export async function completeDraftCompilation(input: {
  db: Parameters<typeof updateAuthoringDraft>[0];
  draft: Pick<AuthoringDraftViewRow, "id" | "updated_at">;
  state: AuthoringDraftState;
  posterAddress?: string | null;
  intentJson: ChallengeIntentOutput;
  authoringIrJson: ChallengeAuthoringIrOutput;
  uploadedArtifactsJson: AuthoringArtifactOutput[];
  compilationJson: CompilationResultOutput | null;
  expiresInMs: number;
  updateAuthoringDraftImpl?: typeof updateAuthoringDraft;
  getAuthoringDraftViewByIdImpl?: typeof getAuthoringDraftViewById;
  logger?: AgoraLogger;
}) {
  await (input.updateAuthoringDraftImpl ?? updateAuthoringDraft)(input.db, {
    id: input.draft.id,
    expected_updated_at: input.draft.updated_at,
    poster_address: input.posterAddress,
    state: input.state,
    intent_json: input.intentJson,
    authoring_ir_json: input.authoringIrJson,
    uploaded_artifacts_json: input.uploadedArtifactsJson,
    compilation_json: input.compilationJson,
    failure_message: null,
    expires_at: buildExpiry(input.expiresInMs),
  });

  const completedDraft = await reloadDraftViewOrThrow(
    input.db,
    input.draft.id,
    input.getAuthoringDraftViewByIdImpl,
  );
  logDraftTransition({
    logger: input.logger,
    event: "authoring.draft.compilation_persisted",
    message: "Persisted authoring draft compilation",
    draft: completedDraft,
  });
  return completedDraft;
}

export async function failDraft(input: {
  db: Parameters<typeof updateAuthoringDraft>[0];
  draft: Pick<AuthoringDraftViewRow, "id" | "updated_at">;
  posterAddress?: string | null;
  intentJson?: ChallengeIntentOutput | null;
  authoringIrJson?: ChallengeAuthoringIrOutput | null;
  uploadedArtifactsJson?: AuthoringArtifactOutput[];
  compilationJson?: CompilationResultOutput | null;
  message: string;
  expiresInMs: number;
  updateAuthoringDraftImpl?: typeof updateAuthoringDraft;
  getAuthoringDraftViewByIdImpl?: typeof getAuthoringDraftViewById;
  logger?: AgoraLogger;
}) {
  await (input.updateAuthoringDraftImpl ?? updateAuthoringDraft)(input.db, {
    id: input.draft.id,
    expected_updated_at: input.draft.updated_at,
    poster_address: input.posterAddress,
    state: "failed",
    intent_json: input.intentJson,
    authoring_ir_json: input.authoringIrJson,
    uploaded_artifacts_json: input.uploadedArtifactsJson,
    compilation_json: input.compilationJson,
    failure_message: input.message,
    expires_at: buildExpiry(input.expiresInMs),
  });

  const failedDraft = await reloadDraftViewOrThrow(
    input.db,
    input.draft.id,
    input.getAuthoringDraftViewByIdImpl,
  );
  input.logger?.warn(
    {
      event: "authoring.draft.failed",
      draftId: failedDraft.id,
      state: failedDraft.state,
      message: input.message,
    },
    "Marked authoring draft as failed",
  );
  return failedDraft;
}

export async function approveDraftForPublish(input: {
  db: Parameters<typeof updateAuthoringDraft>[0];
  draft: Pick<AuthoringDraftViewRow, "id">;
  compilationJson: CompilationResultOutput;
  expiresInMs: number;
  updateAuthoringDraftImpl?: typeof updateAuthoringDraft;
  getAuthoringDraftViewByIdImpl?: typeof getAuthoringDraftViewById;
  logger?: AgoraLogger;
}) {
  await (input.updateAuthoringDraftImpl ?? updateAuthoringDraft)(input.db, {
    id: input.draft.id,
    state: "ready",
    compilation_json: input.compilationJson,
    expires_at: buildExpiry(input.expiresInMs),
  });

  const approvedDraft = await reloadDraftViewOrThrow(
    input.db,
    input.draft.id,
    input.getAuthoringDraftViewByIdImpl,
  );
  logDraftTransition({
    logger: input.logger,
    event: "authoring.draft.ready",
    message: "Approved authoring draft for publish",
    draft: approvedDraft,
  });
  return approvedDraft;
}

export async function publishDraft(input: {
  db: Parameters<typeof updateAuthoringDraft>[0];
  draft: Pick<
    AuthoringDraftViewRow,
    | "id"
    | "state"
    | "poster_address"
    | "compilation_json"
    | "failure_message"
    | "expires_at"
  >;
  posterAddress?: string | null;
  compilationJson: CompilationResultOutput;
  publishedSpecJson: ChallengeSpecOutput;
  publishedSpecCid: string;
  challengeId?: string | null;
  returnTo?: string | null;
  expiresInMs: number;
  updateAuthoringDraftImpl?: typeof updateAuthoringDraft;
  upsertPublishedChallengeLinkImpl?: typeof upsertPublishedChallengeLink;
  getAuthoringDraftViewByIdImpl?: typeof getAuthoringDraftViewById;
  logger?: AgoraLogger;
}) {
  const updateAuthoringDraftFn =
    input.updateAuthoringDraftImpl ?? updateAuthoringDraft;

  await updateAuthoringDraftFn(input.db, {
    id: input.draft.id,
    poster_address: input.posterAddress,
    state: "published",
    compilation_json: input.compilationJson,
    failure_message: null,
    expires_at: buildExpiry(input.expiresInMs),
  });

  try {
    await (
      input.upsertPublishedChallengeLinkImpl ?? upsertPublishedChallengeLink
    )(input.db, {
      draft_id: input.draft.id,
      challenge_id: input.challengeId ?? null,
      published_spec_json: input.publishedSpecJson,
      published_spec_cid: input.publishedSpecCid,
      return_to: input.returnTo ?? null,
    });
  } catch (error) {
    try {
      await updateAuthoringDraftFn(input.db, {
        id: input.draft.id,
        poster_address: input.draft.poster_address,
        state: input.draft.state,
        compilation_json: input.draft.compilation_json,
        failure_message: input.draft.failure_message,
        expires_at: input.draft.expires_at,
      });
      input.logger?.warn(
        {
          event: "authoring.draft.publish_reverted",
          draftId: input.draft.id,
          restoredState: input.draft.state,
          message: error instanceof Error ? error.message : String(error),
        },
        "Reverted authoring draft publish state after link persistence failed",
      );
    } catch (rollbackError) {
      input.logger?.warn(
        {
          event: "authoring.draft.publish_revert_failed",
          draftId: input.draft.id,
          publishError: error instanceof Error ? error.message : String(error),
          rollbackError:
            rollbackError instanceof Error
              ? rollbackError.message
              : String(rollbackError),
        },
        "Failed to revert authoring draft publish state after link persistence failed",
      );
    }
    throw error;
  }

  const publishedDraft = await reloadDraftViewOrThrow(
    input.db,
    input.draft.id,
    input.getAuthoringDraftViewByIdImpl,
  );
  logDraftTransition({
    logger: input.logger,
    event: "authoring.draft.published",
    message: "Published authoring draft",
    draft: publishedDraft,
    publishedSpecCid: input.publishedSpecCid,
    challengeId: input.challengeId ?? null,
  });
  return publishedDraft;
}

export function resolvePublishedDraftReturnSource(input: {
  publishedLink: Pick<PublishedChallengeLinkRow, "return_to"> | null;
  originExternalUrl?: string | null;
}) {
  if (!input.publishedLink?.return_to) {
    return null;
  }
  if (
    input.originExternalUrl &&
    input.publishedLink.return_to === input.originExternalUrl
  ) {
    return "origin_external_url" as const;
  }
  return "requested" as const;
}

export async function registerDraftCallback(input: {
  db: Parameters<typeof updateAuthoringDraft>[0];
  draft: Pick<AuthoringDraftViewRow, "id">;
  callbackUrl: string;
  registeredAt?: string;
  upsertAuthoringCallbackTargetImpl?: typeof upsertAuthoringCallbackTarget;
  getAuthoringDraftViewByIdImpl?: typeof getAuthoringDraftViewById;
  logger?: AgoraLogger;
}) {
  await (
    input.upsertAuthoringCallbackTargetImpl ?? upsertAuthoringCallbackTarget
  )(input.db, {
    draft_id: input.draft.id,
    callback_url: input.callbackUrl,
    registered_at: input.registeredAt ?? new Date().toISOString(),
  });

  const updatedDraft = await reloadDraftViewOrThrow(
    input.db,
    input.draft.id,
    input.getAuthoringDraftViewByIdImpl,
  );
  logDraftTransition({
    logger: input.logger,
    event: "authoring.draft.callback_registered",
    message: "Registered authoring draft callback",
    draft: updatedDraft,
    callbackUrl: input.callbackUrl,
  });
  return updatedDraft;
}
