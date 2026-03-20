import { z } from "zod";

export const AUTHORING_SOURCE_MAX_TITLE_LENGTH = 200;
export const AUTHORING_SOURCE_MAX_EXTERNAL_ID_LENGTH = 256;
const AUTHORING_SOURCE_MAX_MESSAGES = 64;
const AUTHORING_SOURCE_MAX_MESSAGE_ID_LENGTH = 256;
const AUTHORING_SOURCE_MAX_MESSAGE_CONTENT_LENGTH = 8_000;
const AUTHORING_SOURCE_MAX_AUTHOR_HANDLE_LENGTH = 128;
const AUTHORING_SOURCE_MAX_ARTIFACTS = 12;
const AUTHORING_SOURCE_MAX_URL_LENGTH = 2_048;
const AUTHORING_SOURCE_MAX_FILE_NAME_LENGTH = 255;
const AUTHORING_SOURCE_MAX_MIME_TYPE_LENGTH = 128;
const AUTHORING_SOURCE_MAX_ROLE_LENGTH = 128;
const AUTHORING_SOURCE_MAX_RAW_CONTEXT_BYTES = 10_000;
const textEncoder = new TextEncoder();

function isPrivateOrLocalHostname(hostname: string) {
  const normalized = hostname.toLowerCase();
  if (
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized.endsWith(".local")
  ) {
    return true;
  }
  if (
    normalized.startsWith("127.") ||
    normalized.startsWith("10.") ||
    normalized.startsWith("192.168.")
  ) {
    return true;
  }

  const privateRange = /^172\.(1[6-9]|2\d|3[0-1])\./.test(normalized);
  return privateRange;
}

function isSafeExternalSourceUrl(value: string) {
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === "https:" &&
      parsed.username.length === 0 &&
      parsed.password.length === 0 &&
      !isPrivateOrLocalHostname(parsed.hostname)
    );
  } catch {
    return false;
  }
}

export const safePublicHttpsUrlSchema = z
  .string()
  .url()
  .max(AUTHORING_SOURCE_MAX_URL_LENGTH)
  .refine(
    isSafeExternalSourceUrl,
    "URL must be an HTTPS URL on a public host. Next step: provide a publicly reachable HTTPS URL and retry.",
  );

// Includes "direct" for persisted IR origin; partner auth excludes "direct".
export const EXTERNAL_SOURCE_PROVIDER_VALUES = [
  "direct",
  "beach_science",
  "github",
  "slack",
  "lab_portal",
] as const;

export const AUTHORING_PARTNER_PROVIDER_VALUES = [
  "beach_science",
  "github",
  "slack",
  "lab_portal",
] as const;

export const externalSourceProviderSchema = z.enum(
  EXTERNAL_SOURCE_PROVIDER_VALUES,
);
export const authoringPartnerProviderSchema = z.enum(
  AUTHORING_PARTNER_PROVIDER_VALUES,
);

export const externalSourceMessageSchema = z.object({
  id: z.string().trim().min(1).max(AUTHORING_SOURCE_MAX_MESSAGE_ID_LENGTH),
  role: z.enum(["poster", "participant", "system"]),
  content: z
    .string()
    .trim()
    .min(1)
    .max(AUTHORING_SOURCE_MAX_MESSAGE_CONTENT_LENGTH),
  created_at: z.string().datetime({ offset: true }).optional(),
  author_handle: z
    .string()
    .trim()
    .min(1)
    .max(AUTHORING_SOURCE_MAX_AUTHOR_HANDLE_LENGTH)
    .optional(),
});

export const externalSourceArtifactRefSchema = z.object({
  source_url: safePublicHttpsUrlSchema,
  suggested_role: z
    .string()
    .trim()
    .min(1)
    .max(AUTHORING_SOURCE_MAX_ROLE_LENGTH)
    .optional(),
  suggested_filename: z
    .string()
    .trim()
    .min(1)
    .max(AUTHORING_SOURCE_MAX_FILE_NAME_LENGTH)
    .optional(),
  mime_type: z
    .string()
    .trim()
    .min(1)
    .max(AUTHORING_SOURCE_MAX_MIME_TYPE_LENGTH)
    .optional(),
  size_bytes: z.number().int().nonnegative().optional(),
});

export const authoringSourceRawContextSchema = z
  .record(z.string().trim().min(1).max(256), z.unknown())
  .refine((value) => {
    try {
      return (
        textEncoder.encode(JSON.stringify(value)).length <=
        AUTHORING_SOURCE_MAX_RAW_CONTEXT_BYTES
      );
    } catch {
      return false;
    }
  }, `Authoring source raw_context must stay under ${AUTHORING_SOURCE_MAX_RAW_CONTEXT_BYTES} bytes. Next step: trim provider debug payloads and retry.`);

export const createAuthoringSourceDraftRequestSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1)
      .max(AUTHORING_SOURCE_MAX_TITLE_LENGTH)
      .optional(),
    external_id: z
      .string()
      .trim()
      .min(1)
      .max(AUTHORING_SOURCE_MAX_EXTERNAL_ID_LENGTH)
      .optional(),
    // Hosted providers can omit this to disable implicit post-publish return links.
    external_url: safePublicHttpsUrlSchema.optional(),
    raw_context: authoringSourceRawContextSchema.optional(),
    messages: z
      .array(externalSourceMessageSchema)
      .min(1)
      .max(AUTHORING_SOURCE_MAX_MESSAGES),
    artifacts: z
      .array(externalSourceArtifactRefSchema)
      .max(AUTHORING_SOURCE_MAX_ARTIFACTS)
      .default([]),
  })
  .superRefine((value, ctx) => {
    const seenUrls = new Set<string>();
    for (const artifact of value.artifacts) {
      if (seenUrls.has(artifact.source_url)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["artifacts"],
          message:
            "Duplicate source_url is not allowed. Next step: remove the duplicate external artifact URL and retry.",
        });
        return;
      }
      seenUrls.add(artifact.source_url);
    }
  });

export type ExternalSourceProviderOutput = z.output<
  typeof externalSourceProviderSchema
>;
export type AuthoringPartnerProviderOutput = z.output<
  typeof authoringPartnerProviderSchema
>;
export type ExternalSourceMessageOutput = z.output<
  typeof externalSourceMessageSchema
>;
export type ExternalSourceArtifactRefOutput = z.output<
  typeof externalSourceArtifactRefSchema
>;
export type CreateAuthoringSourceDraftRequestOutput = z.output<
  typeof createAuthoringSourceDraftRequestSchema
>;
