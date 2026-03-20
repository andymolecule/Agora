import {
  AgoraError,
  type AuthoringArtifactOutput,
  type AuthoringPartnerProviderOutput,
  type ExternalSourceMessageOutput,
  challengeIntentSchema,
} from "@agora/common";
import type { AgoraLogger } from "@agora/common/server-observability";
import {
  type AuthoringDraftRow,
  AuthoringDraftWriteConflictError,
  type createAuthoringDraft,
  type createSupabaseClient,
  type getAuthoringDraftById,
  type updateAuthoringDraft,
} from "@agora/db";
import {
  completeDraftCompilation,
  createDraft,
  failDraft,
  markDraftCompiling,
  refreshDraftIr,
} from "./authoring-draft-transitions.js";
import { buildManagedAuthoringIr } from "./managed-authoring-ir.js";
import { compileManagedAuthoringDraftOutcome } from "./managed-authoring.js";

const REQUIRED_MANAGED_INTENT_FIELDS = [
  "title",
  "description",
  "payout_condition",
  "reward_total",
  "deadline",
] as const;

function listMissingManagedIntentFields(intent: Record<string, unknown>) {
  return REQUIRED_MANAGED_INTENT_FIELDS.filter((field) => {
    const value = intent[field];
    return typeof value !== "string" || value.trim().length === 0;
  });
}

function draftBusyError() {
  return new AgoraError(
    "Authoring draft is already compiling. Next step: wait for the current compile to finish or reload the latest draft state and retry.",
    {
      status: 409,
      code: "AUTHORING_DRAFT_BUSY",
    },
  );
}

function draftConflictError(cause?: unknown) {
  return new AgoraError(
    "Authoring draft changed during the update. Next step: reload the latest draft state from Agora and retry your change.",
    {
      status: 409,
      code: "AUTHORING_DRAFT_CONFLICT",
      cause,
    },
  );
}

type DraftOrigin = {
  provider: AuthoringPartnerProviderOutput | "direct";
  external_id?: string | null;
  external_url?: string | null;
  ingested_at?: string;
  raw_context?: Record<string, unknown> | null;
};

function buildOrigin(input: DraftOrigin) {
  return {
    provider: input.provider,
    external_id: input.external_id ?? null,
    external_url: input.external_url ?? null,
    ingested_at: input.ingested_at,
    raw_context: input.raw_context ?? null,
  };
}

export type AuthoringIntakeWorkflowDependencies = {
  createDraft?: typeof createDraft;
  refreshDraftIr?: typeof refreshDraftIr;
  markDraftCompiling?: typeof markDraftCompiling;
  completeDraftCompilation?: typeof completeDraftCompilation;
  failDraft?: typeof failDraft;
  compileManagedAuthoringDraftOutcome?: typeof compileManagedAuthoringDraftOutcome;
  buildManagedAuthoringIr?: typeof buildManagedAuthoringIr;
};

export type AuthoringIntakeSubmitResult = {
  draft: AuthoringDraftRow;
  compileError?: AgoraError;
};

export function createAuthoringIntakeWorkflow(
  dependencies: AuthoringIntakeWorkflowDependencies = {},
) {
  const createDraftImpl = dependencies.createDraft ?? createDraft;
  const refreshDraftIrImpl = dependencies.refreshDraftIr ?? refreshDraftIr;
  const markDraftCompilingImpl =
    dependencies.markDraftCompiling ?? markDraftCompiling;
  const completeDraftCompilationImpl =
    dependencies.completeDraftCompilation ?? completeDraftCompilation;
  const failDraftImpl = dependencies.failDraft ?? failDraft;
  const compileManagedAuthoringDraftOutcomeImpl =
    dependencies.compileManagedAuthoringDraftOutcome ??
    compileManagedAuthoringDraftOutcome;
  const buildManagedAuthoringIrImpl =
    dependencies.buildManagedAuthoringIr ?? buildManagedAuthoringIr;

  return {
    async submitDraft(input: {
      db: ReturnType<typeof createSupabaseClient>;
      session?: AuthoringDraftRow | null;
      posterAddress?: string | null;
      intentCandidate: Record<string, unknown> | null | undefined;
      uploadedArtifacts: AuthoringArtifactOutput[];
      sourceTitle?: string | null;
      sourceMessages?: ExternalSourceMessageOutput[];
      origin: DraftOrigin;
      draftExpiryMs: number;
      readyExpiryMs: number;
      createAuthoringDraftImpl?: typeof createAuthoringDraft;
      getAuthoringDraftByIdImpl?: typeof getAuthoringDraftById;
      updateAuthoringDraftImpl?: typeof updateAuthoringDraft;
      logger?: AgoraLogger;
    }): Promise<AuthoringIntakeSubmitResult> {
      if (input.session?.state === "compiling") {
        throw draftBusyError();
      }

      const baseAuthoringIr = buildManagedAuthoringIrImpl({
        intent: input.intentCandidate ?? null,
        uploadedArtifacts: input.uploadedArtifacts,
        sourceTitle: input.sourceTitle ?? null,
        sourceMessages: input.sourceMessages ?? [],
        origin: buildOrigin(input.origin),
      });

      const missingFields = listMissingManagedIntentFields(
        input.intentCandidate ?? {},
      );
      if (missingFields.length > 0) {
        const draft = input.session
          ? await refreshDraftIrImpl({
              db: input.db,
              session: input.session,
              state: "needs_clarification",
              intentJson: null,
              authoringIrJson: baseAuthoringIr,
              uploadedArtifactsJson: input.uploadedArtifacts,
              expiresInMs: input.draftExpiryMs,
              updateAuthoringDraftImpl: input.updateAuthoringDraftImpl,
              getAuthoringDraftByIdImpl: input.getAuthoringDraftByIdImpl,
            })
          : await createDraftImpl({
              db: input.db,
              posterAddress: input.posterAddress,
              state: "needs_clarification",
              intentJson: null,
              authoringIrJson: baseAuthoringIr,
              uploadedArtifactsJson: input.uploadedArtifacts,
              expiresInMs: input.draftExpiryMs,
              createAuthoringDraftImpl: input.createAuthoringDraftImpl,
              getAuthoringDraftByIdImpl: input.getAuthoringDraftByIdImpl,
            });
        return { draft };
      }

      const parsedIntent = challengeIntentSchema.safeParse(
        input.intentCandidate,
      );
      if (!parsedIntent.success) {
        throw new AgoraError(
          "Managed authoring intent is invalid. Next step: correct the highlighted fields and retry.",
          {
            status: 400,
            code: "AUTHORING_INTENT_INVALID",
            details: {
              issues: parsedIntent.error.issues,
            },
          },
        );
      }

      const compilingAuthoringIr = buildManagedAuthoringIrImpl({
        intent: parsedIntent.data,
        uploadedArtifacts: input.uploadedArtifacts,
        sourceTitle: input.sourceTitle ?? parsedIntent.data.title,
        sourceMessages: input.sourceMessages ?? [],
        origin: buildOrigin(input.origin),
      });

      const draftSeed = input.session
        ? input.session
        : await createDraftImpl({
            db: input.db,
            posterAddress: input.posterAddress,
            state: "draft",
            intentJson: parsedIntent.data,
            authoringIrJson: compilingAuthoringIr,
            uploadedArtifactsJson: input.uploadedArtifacts,
            expiresInMs: input.draftExpiryMs,
            createAuthoringDraftImpl: input.createAuthoringDraftImpl,
            getAuthoringDraftByIdImpl: input.getAuthoringDraftByIdImpl,
          });

      let compilingDraft: Awaited<ReturnType<typeof markDraftCompilingImpl>>;
      try {
        compilingDraft = await markDraftCompilingImpl({
          db: input.db,
          session: draftSeed,
          posterAddress: input.posterAddress,
          intentJson: parsedIntent.data,
          authoringIrJson: compilingAuthoringIr,
          expiresInMs: input.draftExpiryMs,
          updateAuthoringDraftImpl: input.updateAuthoringDraftImpl,
          getAuthoringDraftByIdImpl: input.getAuthoringDraftByIdImpl,
        });
      } catch (error) {
        if (error instanceof AuthoringDraftWriteConflictError) {
          throw draftConflictError(error);
        }
        throw error;
      }

      try {
        const outcome = await compileManagedAuthoringDraftOutcomeImpl({
          intent: parsedIntent.data,
          uploadedArtifacts: input.uploadedArtifacts,
        });

        const updatedAuthoringIr = {
          ...outcome.authoringIr,
          origin: {
            ...outcome.authoringIr.origin,
            ...buildOrigin(input.origin),
            ingested_at:
              input.origin.ingested_at ??
              outcome.authoringIr.origin.ingested_at,
          },
          source: {
            ...outcome.authoringIr.source,
            title:
              input.sourceTitle ??
              outcome.authoringIr.source.title ??
              parsedIntent.data.title,
            poster_messages:
              (input.sourceMessages ?? []).map((message) => ({
                id: message.id,
                role: message.role,
                content: message.content,
                created_at: message.created_at ?? new Date().toISOString(),
              })) ?? [],
            uploaded_artifact_ids: input.uploadedArtifacts.map(
              (artifact, index) => artifact.id ?? `${index}:${artifact.uri}`,
            ),
          },
        };

        if (outcome.state === "failed") {
          const draft = await failDraftImpl({
            db: input.db,
            session: compilingDraft,
            posterAddress: input.posterAddress,
            intentJson: parsedIntent.data,
            authoringIrJson: updatedAuthoringIr,
            uploadedArtifactsJson: input.uploadedArtifacts,
            compilationJson: null,
            message:
              outcome.message ??
              "Agora could not map this challenge to a supported Gems scorer.",
            expiresInMs: input.draftExpiryMs,
            updateAuthoringDraftImpl: input.updateAuthoringDraftImpl,
            getAuthoringDraftByIdImpl: input.getAuthoringDraftByIdImpl,
          });
          return { draft };
        }

        const draft = await completeDraftCompilationImpl({
          db: input.db,
          session: compilingDraft,
          state: outcome.state,
          posterAddress: input.posterAddress,
          intentJson: parsedIntent.data,
          authoringIrJson: updatedAuthoringIr,
          uploadedArtifactsJson: input.uploadedArtifacts,
          compilationJson: outcome.compilation ?? null,
          expiresInMs:
            outcome.state === "ready"
              ? input.readyExpiryMs
              : input.draftExpiryMs,
          updateAuthoringDraftImpl: input.updateAuthoringDraftImpl,
          getAuthoringDraftByIdImpl: input.getAuthoringDraftByIdImpl,
        });
        return { draft };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        try {
          const draft = await failDraftImpl({
            db: input.db,
            session: compilingDraft,
            posterAddress: input.posterAddress,
            intentJson: parsedIntent.data,
            authoringIrJson: compilingAuthoringIr,
            uploadedArtifactsJson: input.uploadedArtifacts,
            compilationJson: null,
            message,
            expiresInMs: input.draftExpiryMs,
            updateAuthoringDraftImpl: input.updateAuthoringDraftImpl,
            getAuthoringDraftByIdImpl: input.getAuthoringDraftByIdImpl,
          });
          return {
            draft,
            compileError: new AgoraError(message, {
              status: 422,
              code: "AUTHORING_DRAFT_COMPILE_FAILED",
              cause: error,
            }),
          };
        } catch (conflictError) {
          if (conflictError instanceof AuthoringDraftWriteConflictError) {
            throw draftConflictError(conflictError);
          }
          throw conflictError;
        }
      }
    },
  };
}
