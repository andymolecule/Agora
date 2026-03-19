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

  return reloadDraftViewOrThrow(
    input.db,
    draft.id,
    input.getAuthoringDraftViewByIdImpl,
  );
}

export async function refreshDraftIr(input: {
  db: Parameters<typeof updateAuthoringDraft>[0];
  session: Pick<AuthoringDraftViewRow, "id" | "updated_at">;
  state: AuthoringDraftState;
  intentJson?: ChallengeIntentOutput | null;
  authoringIrJson: ChallengeAuthoringIrOutput;
  uploadedArtifactsJson: AuthoringArtifactOutput[];
  expiresInMs: number;
  updateAuthoringDraftImpl?: typeof updateAuthoringDraft;
  getAuthoringDraftViewByIdImpl?: typeof getAuthoringDraftViewById;
}) {
  await (input.updateAuthoringDraftImpl ?? updateAuthoringDraft)(input.db, {
    id: input.session.id,
    expected_updated_at: input.session.updated_at,
    state: input.state,
    intent_json: input.intentJson,
    authoring_ir_json: input.authoringIrJson,
    uploaded_artifacts_json: input.uploadedArtifactsJson,
    compilation_json: null,
    failure_message: null,
    expires_at: buildExpiry(input.expiresInMs),
  });

  return reloadDraftViewOrThrow(
    input.db,
    input.session.id,
    input.getAuthoringDraftViewByIdImpl,
  );
}

export async function markDraftCompiling(input: {
  db: Parameters<typeof updateAuthoringDraft>[0];
  session: Pick<AuthoringDraftViewRow, "id" | "updated_at">;
  posterAddress?: string | null;
  intentJson: ChallengeIntentOutput;
  authoringIrJson: ChallengeAuthoringIrOutput;
  expiresInMs: number;
  updateAuthoringDraftImpl?: typeof updateAuthoringDraft;
  getAuthoringDraftViewByIdImpl?: typeof getAuthoringDraftViewById;
}) {
  await (input.updateAuthoringDraftImpl ?? updateAuthoringDraft)(input.db, {
    id: input.session.id,
    expected_updated_at: input.session.updated_at,
    poster_address: input.posterAddress,
    state: "compiling",
    intent_json: input.intentJson,
    authoring_ir_json: input.authoringIrJson,
    compilation_json: null,
    failure_message: null,
    expires_at: buildExpiry(input.expiresInMs),
  });

  return reloadDraftViewOrThrow(
    input.db,
    input.session.id,
    input.getAuthoringDraftViewByIdImpl,
  );
}

export async function completeDraftCompilation(input: {
  db: Parameters<typeof updateAuthoringDraft>[0];
  session: Pick<AuthoringDraftViewRow, "id" | "updated_at">;
  state: AuthoringDraftState;
  posterAddress?: string | null;
  intentJson: ChallengeIntentOutput;
  authoringIrJson: ChallengeAuthoringIrOutput;
  uploadedArtifactsJson: AuthoringArtifactOutput[];
  compilationJson: CompilationResultOutput | null;
  expiresInMs: number;
  updateAuthoringDraftImpl?: typeof updateAuthoringDraft;
  getAuthoringDraftViewByIdImpl?: typeof getAuthoringDraftViewById;
}) {
  await (input.updateAuthoringDraftImpl ?? updateAuthoringDraft)(input.db, {
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
  });

  return reloadDraftViewOrThrow(
    input.db,
    input.session.id,
    input.getAuthoringDraftViewByIdImpl,
  );
}

export async function failDraft(input: {
  db: Parameters<typeof updateAuthoringDraft>[0];
  session: Pick<AuthoringDraftViewRow, "id" | "updated_at">;
  posterAddress?: string | null;
  intentJson?: ChallengeIntentOutput | null;
  authoringIrJson?: ChallengeAuthoringIrOutput | null;
  uploadedArtifactsJson?: AuthoringArtifactOutput[];
  compilationJson?: CompilationResultOutput | null;
  message: string;
  expiresInMs: number;
  updateAuthoringDraftImpl?: typeof updateAuthoringDraft;
  getAuthoringDraftViewByIdImpl?: typeof getAuthoringDraftViewById;
}) {
  await (input.updateAuthoringDraftImpl ?? updateAuthoringDraft)(input.db, {
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
  });

  return reloadDraftViewOrThrow(
    input.db,
    input.session.id,
    input.getAuthoringDraftViewByIdImpl,
  );
}

export async function approveDraftForPublish(input: {
  db: Parameters<typeof updateAuthoringDraft>[0];
  session: Pick<AuthoringDraftViewRow, "id">;
  compilationJson: CompilationResultOutput;
  expiresInMs: number;
  updateAuthoringDraftImpl?: typeof updateAuthoringDraft;
  getAuthoringDraftViewByIdImpl?: typeof getAuthoringDraftViewById;
}) {
  await (input.updateAuthoringDraftImpl ?? updateAuthoringDraft)(input.db, {
    id: input.session.id,
    state: "ready",
    compilation_json: input.compilationJson,
    expires_at: buildExpiry(input.expiresInMs),
  });

  return reloadDraftViewOrThrow(
    input.db,
    input.session.id,
    input.getAuthoringDraftViewByIdImpl,
  );
}

export async function publishDraft(input: {
  db: Parameters<typeof updateAuthoringDraft>[0];
  session: Pick<AuthoringDraftViewRow, "id">;
  posterAddress?: string | null;
  compilationJson: CompilationResultOutput;
  publishedSpecJson: ChallengeSpecOutput;
  publishedSpecCid: string;
  returnTo?: string | null;
  expiresInMs: number;
  updateAuthoringDraftImpl?: typeof updateAuthoringDraft;
  upsertPublishedChallengeLinkImpl?: typeof upsertPublishedChallengeLink;
  getAuthoringDraftViewByIdImpl?: typeof getAuthoringDraftViewById;
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

  return reloadDraftViewOrThrow(
    input.db,
    input.session.id,
    input.getAuthoringDraftViewByIdImpl,
  );
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
  session: Pick<AuthoringDraftViewRow, "id">;
  callbackUrl: string;
  registeredAt?: string;
  upsertAuthoringCallbackTargetImpl?: typeof upsertAuthoringCallbackTarget;
  getAuthoringDraftViewByIdImpl?: typeof getAuthoringDraftViewById;
}) {
  await (
    input.upsertAuthoringCallbackTargetImpl ?? upsertAuthoringCallbackTarget
  )(input.db, {
    draft_id: input.session.id,
    callback_url: input.callbackUrl,
    registered_at: input.registeredAt ?? new Date().toISOString(),
  });

  return reloadDraftViewOrThrow(
    input.db,
    input.session.id,
    input.getAuthoringDraftViewByIdImpl,
  );
}
