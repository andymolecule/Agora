import type {
  ChallengeAuthoringIrOutput,
  ChallengeIntentOutput,
  CompilationResultOutput,
  PostingSessionState,
} from "@agora/common";
import type {
  AuthoringArtifactOutput,
  ChallengeSpecOutput,
} from "@agora/common";
import {
  type PostingSessionRow,
  type PublishedChallengeLinkRow,
  type createAuthoringDraft,
  createPostingSession,
  getPostingSessionById,
  updateAuthoringDraft,
  updatePostingSession,
  upsertPublishedChallengeLink,
} from "@agora/db";
import { buildExpiry } from "./posting-session-helpers.js";

async function reloadPostingSessionOrThrow(
  db: Parameters<typeof getPostingSessionById>[0],
  draftId: string,
  getPostingSessionByIdImpl: typeof getPostingSessionById = getPostingSessionById,
) {
  const session = await getPostingSessionByIdImpl(db, draftId);
  if (!session) {
    throw new Error(
      `Authoring draft ${draftId} could not be reloaded. Next step: retry the request and inspect the draft storage path.`,
    );
  }
  return session;
}

export async function createDraft(input: {
  db: Parameters<typeof createAuthoringDraft>[0];
  state: PostingSessionState;
  posterAddress?: string | null;
  intentJson?: ChallengeIntentOutput | null;
  authoringIrJson?: ChallengeAuthoringIrOutput | null;
  uploadedArtifactsJson?: AuthoringArtifactOutput[];
  compilationJson?: CompilationResultOutput | null;
  expiresInMs: number;
  failureMessage?: string | null;
  sourceCallbackUrl?: string | null;
  sourceCallbackRegisteredAt?: string | null;
  createAuthoringDraftImpl?: typeof createAuthoringDraft;
  createPostingSessionImpl?: typeof createPostingSession;
  getPostingSessionByIdImpl?: typeof getPostingSessionById;
}) {
  const payload: Parameters<typeof createAuthoringDraft>[1] = {
    poster_address: input.posterAddress ?? null,
    state: input.state,
    intent_json: input.intentJson ?? null,
    authoring_ir_json: input.authoringIrJson ?? null,
    uploaded_artifacts_json: input.uploadedArtifactsJson ?? [],
    compilation_json: input.compilationJson ?? null,
    failure_message: input.failureMessage ?? null,
    source_callback_url: input.sourceCallbackUrl ?? null,
    source_callback_registered_at: input.sourceCallbackRegisteredAt ?? null,
    expires_at: buildExpiry(input.expiresInMs),
  };
  if (input.createAuthoringDraftImpl) {
    const draft = await input.createAuthoringDraftImpl(input.db, payload);
    return reloadPostingSessionOrThrow(
      input.db,
      draft.id,
      input.getPostingSessionByIdImpl,
    );
  }
  return (input.createPostingSessionImpl ?? createPostingSession)(
    input.db,
    payload,
  );
}

export async function refreshDraftIr(input: {
  db: Parameters<typeof updateAuthoringDraft>[0];
  session: Pick<PostingSessionRow, "id" | "updated_at">;
  state: PostingSessionState;
  intentJson?: ChallengeIntentOutput | null;
  authoringIrJson: ChallengeAuthoringIrOutput;
  uploadedArtifactsJson: AuthoringArtifactOutput[];
  expiresInMs: number;
  updateAuthoringDraftImpl?: typeof updateAuthoringDraft;
  updatePostingSessionImpl?: typeof updatePostingSession;
  getPostingSessionByIdImpl?: typeof getPostingSessionById;
}) {
  const patch: Parameters<typeof updateAuthoringDraft>[1] = {
    id: input.session.id,
    expected_updated_at: input.session.updated_at,
    state: input.state,
    intent_json: input.intentJson,
    authoring_ir_json: input.authoringIrJson,
    uploaded_artifacts_json: input.uploadedArtifactsJson,
    compilation_json: null,
    failure_message: null,
    expires_at: buildExpiry(input.expiresInMs),
  };
  if (input.updateAuthoringDraftImpl) {
    await input.updateAuthoringDraftImpl(input.db, patch);
    return reloadPostingSessionOrThrow(
      input.db,
      input.session.id,
      input.getPostingSessionByIdImpl,
    );
  }
  return (input.updatePostingSessionImpl ?? updatePostingSession)(
    input.db,
    patch,
  );
}

export async function markDraftCompiling(input: {
  db: Parameters<typeof updateAuthoringDraft>[0];
  session: Pick<PostingSessionRow, "id" | "updated_at">;
  posterAddress?: string | null;
  intentJson: ChallengeIntentOutput;
  authoringIrJson: ChallengeAuthoringIrOutput;
  expiresInMs: number;
  updateAuthoringDraftImpl?: typeof updateAuthoringDraft;
  updatePostingSessionImpl?: typeof updatePostingSession;
  getPostingSessionByIdImpl?: typeof getPostingSessionById;
}) {
  const patch: Parameters<typeof updateAuthoringDraft>[1] = {
    id: input.session.id,
    expected_updated_at: input.session.updated_at,
    poster_address: input.posterAddress,
    state: "compiling",
    intent_json: input.intentJson,
    authoring_ir_json: input.authoringIrJson,
    compilation_json: null,
    failure_message: null,
    expires_at: buildExpiry(input.expiresInMs),
  };
  if (input.updateAuthoringDraftImpl) {
    await input.updateAuthoringDraftImpl(input.db, patch);
    return reloadPostingSessionOrThrow(
      input.db,
      input.session.id,
      input.getPostingSessionByIdImpl,
    );
  }
  return (input.updatePostingSessionImpl ?? updatePostingSession)(
    input.db,
    patch,
  );
}

export async function completeDraftCompilation(input: {
  db: Parameters<typeof updateAuthoringDraft>[0];
  session: Pick<PostingSessionRow, "id" | "updated_at">;
  state: PostingSessionState;
  posterAddress?: string | null;
  intentJson: ChallengeIntentOutput;
  authoringIrJson: ChallengeAuthoringIrOutput;
  uploadedArtifactsJson: AuthoringArtifactOutput[];
  compilationJson: CompilationResultOutput | null;
  expiresInMs: number;
  updateAuthoringDraftImpl?: typeof updateAuthoringDraft;
  updatePostingSessionImpl?: typeof updatePostingSession;
  getPostingSessionByIdImpl?: typeof getPostingSessionById;
}) {
  const patch: Parameters<typeof updateAuthoringDraft>[1] = {
    id: input.session.id,
    expected_updated_at: input.session.updated_at,
    poster_address: input.posterAddress,
    state: input.state,
    intent_json: input.intentJson,
    authoring_ir_json: input.authoringIrJson,
    uploaded_artifacts_json: input.uploadedArtifactsJson,
    compilation_json: input.compilationJson,
    failure_message: null,
    expires_at: buildExpiry(input.expiresInMs),
  };
  if (input.updateAuthoringDraftImpl) {
    await input.updateAuthoringDraftImpl(input.db, patch);
    return reloadPostingSessionOrThrow(
      input.db,
      input.session.id,
      input.getPostingSessionByIdImpl,
    );
  }
  return (input.updatePostingSessionImpl ?? updatePostingSession)(
    input.db,
    patch,
  );
}

export async function failDraft(input: {
  db: Parameters<typeof updateAuthoringDraft>[0];
  session: Pick<PostingSessionRow, "id" | "updated_at">;
  posterAddress?: string | null;
  intentJson?: ChallengeIntentOutput | null;
  authoringIrJson?: ChallengeAuthoringIrOutput | null;
  uploadedArtifactsJson?: AuthoringArtifactOutput[];
  compilationJson?: CompilationResultOutput | null;
  message: string;
  expiresInMs: number;
  updateAuthoringDraftImpl?: typeof updateAuthoringDraft;
  updatePostingSessionImpl?: typeof updatePostingSession;
  getPostingSessionByIdImpl?: typeof getPostingSessionById;
}) {
  const patch: Parameters<typeof updateAuthoringDraft>[1] = {
    id: input.session.id,
    expected_updated_at: input.session.updated_at,
    poster_address: input.posterAddress,
    state: "failed",
    intent_json: input.intentJson,
    authoring_ir_json: input.authoringIrJson,
    uploaded_artifacts_json: input.uploadedArtifactsJson,
    compilation_json: input.compilationJson,
    failure_message: input.message,
    expires_at: buildExpiry(input.expiresInMs),
  };
  if (input.updateAuthoringDraftImpl) {
    await input.updateAuthoringDraftImpl(input.db, patch);
    return reloadPostingSessionOrThrow(
      input.db,
      input.session.id,
      input.getPostingSessionByIdImpl,
    );
  }
  return (input.updatePostingSessionImpl ?? updatePostingSession)(
    input.db,
    patch,
  );
}

export async function approveDraftForPublish(input: {
  db: Parameters<typeof updateAuthoringDraft>[0];
  session: Pick<PostingSessionRow, "id">;
  compilationJson: CompilationResultOutput;
  expiresInMs: number;
  updateAuthoringDraftImpl?: typeof updateAuthoringDraft;
  updatePostingSessionImpl?: typeof updatePostingSession;
  getPostingSessionByIdImpl?: typeof getPostingSessionById;
}) {
  const patch: Parameters<typeof updateAuthoringDraft>[1] = {
    id: input.session.id,
    state: "ready",
    compilation_json: input.compilationJson,
    expires_at: buildExpiry(input.expiresInMs),
  };
  if (input.updateAuthoringDraftImpl) {
    await input.updateAuthoringDraftImpl(input.db, patch);
    return reloadPostingSessionOrThrow(
      input.db,
      input.session.id,
      input.getPostingSessionByIdImpl,
    );
  }
  return (input.updatePostingSessionImpl ?? updatePostingSession)(
    input.db,
    patch,
  );
}

export async function publishDraft(input: {
  db: Parameters<typeof updateAuthoringDraft>[0];
  session: Pick<PostingSessionRow, "id">;
  posterAddress?: string | null;
  compilationJson: CompilationResultOutput;
  publishedSpecJson: ChallengeSpecOutput;
  publishedSpecCid: string;
  returnTo?: string | null;
  expiresInMs: number;
  updateAuthoringDraftImpl?: typeof updateAuthoringDraft;
  upsertPublishedChallengeLinkImpl?: typeof upsertPublishedChallengeLink;
  getPostingSessionByIdImpl?: typeof getPostingSessionById;
}) {
  await (input.updateAuthoringDraftImpl ?? updateAuthoringDraft)(input.db, {
    id: input.session.id,
    poster_address: input.posterAddress,
    state: "published",
    compilation_json: input.compilationJson,
    failure_message: null,
    expires_at: buildExpiry(input.expiresInMs),
  });

  await (
    input.upsertPublishedChallengeLinkImpl ?? upsertPublishedChallengeLink
  )(input.db, {
    draft_id: input.session.id,
    published_spec_json: input.publishedSpecJson,
    published_spec_cid: input.publishedSpecCid,
    return_to: input.returnTo ?? null,
  });

  const publishedSession = await (
    input.getPostingSessionByIdImpl ?? getPostingSessionById
  )(input.db, input.session.id);
  if (!publishedSession) {
    throw new Error(
      `Published draft ${input.session.id} could not be reloaded. Next step: retry the publish request and inspect the draft storage path.`,
    );
  }

  return publishedSession;
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
  session: Pick<PostingSessionRow, "id">;
  callbackUrl: string;
  registeredAt?: string;
  updateAuthoringDraftImpl?: typeof updateAuthoringDraft;
  updatePostingSessionImpl?: typeof updatePostingSession;
  getPostingSessionByIdImpl?: typeof getPostingSessionById;
}) {
  const patch: Parameters<typeof updateAuthoringDraft>[1] = {
    id: input.session.id,
    source_callback_url: input.callbackUrl,
    source_callback_registered_at:
      input.registeredAt ?? new Date().toISOString(),
  };
  if (input.updateAuthoringDraftImpl) {
    await input.updateAuthoringDraftImpl(input.db, patch);
    return reloadPostingSessionOrThrow(
      input.db,
      input.session.id,
      input.getPostingSessionByIdImpl,
    );
  }
  return (input.updatePostingSessionImpl ?? updatePostingSession)(
    input.db,
    patch,
  );
}
