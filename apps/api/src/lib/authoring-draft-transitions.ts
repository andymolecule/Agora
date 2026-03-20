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
  type AuthoringDraftRow,
  createAuthoringDraft,
  getAuthoringDraftById,
  updateAuthoringDraft,
} from "@agora/db";
import { buildExpiry } from "./authoring-draft-payloads.js";

async function reloadDraftOrThrow(
  db: Parameters<typeof getAuthoringDraftById>[0],
  draftId: string,
  getAuthoringDraftByIdImpl: typeof getAuthoringDraftById = getAuthoringDraftById,
) {
  const draft = await getAuthoringDraftByIdImpl(db, draftId);
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
  getAuthoringDraftByIdImpl?: typeof getAuthoringDraftById;
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

  return reloadDraftOrThrow(input.db, draft.id, input.getAuthoringDraftByIdImpl);
}

export async function refreshDraftIr(input: {
  db: Parameters<typeof updateAuthoringDraft>[0];
  session: Pick<AuthoringDraftRow, "id" | "updated_at">;
  state: AuthoringDraftState;
  intentJson?: ChallengeIntentOutput | null;
  authoringIrJson: ChallengeAuthoringIrOutput;
  uploadedArtifactsJson: AuthoringArtifactOutput[];
  expiresInMs: number;
  updateAuthoringDraftImpl?: typeof updateAuthoringDraft;
  getAuthoringDraftByIdImpl?: typeof getAuthoringDraftById;
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

  return reloadDraftOrThrow(
    input.db,
    input.session.id,
    input.getAuthoringDraftByIdImpl,
  );
}

export async function markDraftCompiling(input: {
  db: Parameters<typeof updateAuthoringDraft>[0];
  session: Pick<AuthoringDraftRow, "id" | "updated_at">;
  posterAddress?: string | null;
  intentJson: ChallengeIntentOutput;
  authoringIrJson: ChallengeAuthoringIrOutput;
  expiresInMs: number;
  updateAuthoringDraftImpl?: typeof updateAuthoringDraft;
  getAuthoringDraftByIdImpl?: typeof getAuthoringDraftById;
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

  return reloadDraftOrThrow(
    input.db,
    input.session.id,
    input.getAuthoringDraftByIdImpl,
  );
}

export async function completeDraftCompilation(input: {
  db: Parameters<typeof updateAuthoringDraft>[0];
  session: Pick<AuthoringDraftRow, "id" | "updated_at">;
  state: AuthoringDraftState;
  posterAddress?: string | null;
  intentJson: ChallengeIntentOutput;
  authoringIrJson: ChallengeAuthoringIrOutput;
  uploadedArtifactsJson: AuthoringArtifactOutput[];
  compilationJson: CompilationResultOutput | null;
  expiresInMs: number;
  updateAuthoringDraftImpl?: typeof updateAuthoringDraft;
  getAuthoringDraftByIdImpl?: typeof getAuthoringDraftById;
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

  return reloadDraftOrThrow(
    input.db,
    input.session.id,
    input.getAuthoringDraftByIdImpl,
  );
}

export async function failDraft(input: {
  db: Parameters<typeof updateAuthoringDraft>[0];
  session: Pick<AuthoringDraftRow, "id" | "updated_at">;
  posterAddress?: string | null;
  intentJson?: ChallengeIntentOutput | null;
  authoringIrJson?: ChallengeAuthoringIrOutput | null;
  uploadedArtifactsJson?: AuthoringArtifactOutput[];
  compilationJson?: CompilationResultOutput | null;
  message: string;
  expiresInMs: number;
  updateAuthoringDraftImpl?: typeof updateAuthoringDraft;
  getAuthoringDraftByIdImpl?: typeof getAuthoringDraftById;
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

  return reloadDraftOrThrow(
    input.db,
    input.session.id,
    input.getAuthoringDraftByIdImpl,
  );
}

export async function approveDraftForPublish(input: {
  db: Parameters<typeof updateAuthoringDraft>[0];
  session: Pick<AuthoringDraftRow, "id">;
  compilationJson: CompilationResultOutput;
  expiresInMs: number;
  updateAuthoringDraftImpl?: typeof updateAuthoringDraft;
  getAuthoringDraftByIdImpl?: typeof getAuthoringDraftById;
}) {
  await (input.updateAuthoringDraftImpl ?? updateAuthoringDraft)(input.db, {
    id: input.session.id,
    state: "ready",
    compilation_json: input.compilationJson,
    expires_at: buildExpiry(input.expiresInMs),
  });

  return reloadDraftOrThrow(
    input.db,
    input.session.id,
    input.getAuthoringDraftByIdImpl,
  );
}

export async function publishDraft(input: {
  db: Parameters<typeof updateAuthoringDraft>[0];
  session: Pick<AuthoringDraftRow, "id">;
  posterAddress?: string | null;
  compilationJson: CompilationResultOutput;
  publishedSpecJson: ChallengeSpecOutput;
  publishedSpecCid: string;
  challengeId?: string | null;
  returnTo?: string | null;
  expiresInMs: number;
  updateAuthoringDraftImpl?: typeof updateAuthoringDraft;
  getAuthoringDraftByIdImpl?: typeof getAuthoringDraftById;
}) {
  await (input.updateAuthoringDraftImpl ?? updateAuthoringDraft)(input.db, {
    id: input.session.id,
    poster_address: input.posterAddress,
    state: "published",
    compilation_json: input.compilationJson,
    published_challenge_id: input.challengeId ?? null,
    published_spec_json: input.publishedSpecJson,
    published_spec_cid: input.publishedSpecCid,
    published_return_to: input.returnTo ?? null,
    published_at: new Date().toISOString(),
    failure_message: null,
    expires_at: buildExpiry(input.expiresInMs),
  });

  return reloadDraftOrThrow(
    input.db,
    input.session.id,
    input.getAuthoringDraftByIdImpl,
  );
}

export function resolvePublishedDraftReturnSource(input: {
  draft:
    | Pick<AuthoringDraftRow, "published_return_to">
    | null
    | undefined;
  originExternalUrl?: string | null;
}) {
  if (!input.draft?.published_return_to) {
    return null;
  }
  if (
    input.originExternalUrl &&
    input.draft.published_return_to === input.originExternalUrl
  ) {
    return "origin_external_url" as const;
  }
  return "requested" as const;
}

export async function registerDraftCallback(input: {
  db: Parameters<typeof updateAuthoringDraft>[0];
  session: Pick<AuthoringDraftRow, "id" | "updated_at">;
  callbackUrl: string;
  registeredAt?: string;
  updateAuthoringDraftImpl?: typeof updateAuthoringDraft;
  getAuthoringDraftByIdImpl?: typeof getAuthoringDraftById;
}) {
  await (input.updateAuthoringDraftImpl ?? updateAuthoringDraft)(input.db, {
    id: input.session.id,
    expected_updated_at: input.session.updated_at,
    source_callback_url: input.callbackUrl,
    source_callback_registered_at:
      input.registeredAt ?? new Date().toISOString(),
  });

  return reloadDraftOrThrow(
    input.db,
    input.session.id,
    input.getAuthoringDraftByIdImpl,
  );
}
