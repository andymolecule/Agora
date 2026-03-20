import {
  authoringSourceRawContextSchema,
  challengeIntentSchema,
  safePublicHttpsUrlSchema,
  submitAuthoringSourceDraftRequestSchema,
} from "@agora/common";
import { z } from "zod";

const BEACH_MAX_THREAD_ID_LENGTH = 256;
const BEACH_MAX_THREAD_TITLE_LENGTH = 200;
const BEACH_MAX_HANDLE_LENGTH = 128;
const BEACH_MAX_MESSAGES = 64;
const BEACH_MAX_MESSAGE_ID_LENGTH = 256;
const BEACH_MAX_MESSAGE_CONTENT_LENGTH = 8_000;
const BEACH_MAX_ARTIFACTS = 12;
const BEACH_MAX_FILE_NAME_LENGTH = 255;
const BEACH_MAX_MIME_TYPE_LENGTH = 128;
const BEACH_MAX_ROLE_HINT_LENGTH = 128;

const beachThreadMessageSchema = z.object({
  id: z.string().trim().min(1).max(BEACH_MAX_MESSAGE_ID_LENGTH),
  body: z.string().trim().min(1).max(BEACH_MAX_MESSAGE_CONTENT_LENGTH),
  created_at: z.string().datetime({ offset: true }).optional(),
  author_handle: z
    .string()
    .trim()
    .min(1)
    .max(BEACH_MAX_HANDLE_LENGTH)
    .optional(),
  kind: z.enum(["post", "reply", "system"]).default("reply"),
  authored_by_poster: z.boolean().optional(),
});

const beachThreadArtifactSchema = z.object({
  url: safePublicHttpsUrlSchema,
  file_name: z
    .string()
    .trim()
    .min(1)
    .max(BEACH_MAX_FILE_NAME_LENGTH)
    .optional(),
  mime_type: z
    .string()
    .trim()
    .min(1)
    .max(BEACH_MAX_MIME_TYPE_LENGTH)
    .optional(),
  size_bytes: z.number().int().nonnegative().optional(),
  role_hint: z
    .string()
    .trim()
    .min(1)
    .max(BEACH_MAX_ROLE_HINT_LENGTH)
    .optional(),
});

const beachDraftSubmitFieldsSchema = z.object({
  thread: z.object({
    id: z.string().trim().min(1).max(BEACH_MAX_THREAD_ID_LENGTH),
    url: safePublicHttpsUrlSchema,
    title: z
      .string()
      .trim()
      .min(1)
      .max(BEACH_MAX_THREAD_TITLE_LENGTH)
      .optional(),
    poster_agent_handle: z
      .string()
      .trim()
      .min(1)
      .max(BEACH_MAX_HANDLE_LENGTH)
      .optional(),
  }),
  messages: z.array(beachThreadMessageSchema).min(1).max(BEACH_MAX_MESSAGES),
  artifacts: z
    .array(beachThreadArtifactSchema)
    .max(BEACH_MAX_ARTIFACTS)
    .default([]),
  raw_context: authoringSourceRawContextSchema.optional(),
  intent: challengeIntentSchema,
});

export const beachDraftSubmitRequestSchema =
  beachDraftSubmitFieldsSchema.superRefine((value, ctx) => {
    const posterHandle = value.thread.poster_agent_handle?.trim().toLowerCase();
    const hasPosterMessage = value.messages.some((message) => {
      if (message.kind === "system") {
        return false;
      }
      if (message.authored_by_poster === true) {
        return true;
      }
      if (!posterHandle || !message.author_handle) {
        return false;
      }
      return message.author_handle.trim().toLowerCase() === posterHandle;
    });

    if (!hasPosterMessage) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["messages"],
        message:
          "Beach draft import requires at least one poster-authored message. Next step: mark the thread starter or provide poster_agent_handle and retry.",
      });
    }
  });

export type BeachDraftSubmitRequestOutput = z.output<
  typeof beachDraftSubmitFieldsSchema
>;

export function normalizeBeachDraftSubmitRequest(
  input: BeachDraftSubmitRequestOutput,
) {
  const posterHandle = input.thread.poster_agent_handle?.trim().toLowerCase();
  const normalizedRawContext = {
    ...(input.raw_context ?? {}),
    beach_thread_id: input.thread.id,
    beach_thread_url: input.thread.url,
    ...(input.thread.poster_agent_handle
      ? {
          source_agent_handle: input.thread.poster_agent_handle,
          beach_poster_agent_handle: input.thread.poster_agent_handle,
        }
      : {}),
  };

  return submitAuthoringSourceDraftRequestSchema.parse({
    title: input.thread.title,
    external_id: input.thread.id,
    external_url: input.thread.url,
    raw_context: normalizedRawContext,
    intent: input.intent,
    messages: input.messages.map((message) => {
      const role =
        message.kind === "system"
          ? "system"
          : message.authored_by_poster === true ||
              (posterHandle &&
                message.author_handle?.trim().toLowerCase() === posterHandle)
            ? "poster"
            : "participant";
      return {
        id: message.id,
        role,
        content: message.body,
        created_at: message.created_at,
        author_handle: message.author_handle,
      };
    }),
    artifacts: input.artifacts.map((artifact) => ({
      source_url: artifact.url,
      suggested_filename: artifact.file_name,
      suggested_role: artifact.role_hint,
      mime_type: artifact.mime_type,
      size_bytes: artifact.size_bytes,
    })),
  });
}
