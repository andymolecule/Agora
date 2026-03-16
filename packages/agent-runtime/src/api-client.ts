import {
  type AgentChallengesQuery,
  AgoraError,
  agentChallengeDetailResponseSchema,
  agentChallengeLeaderboardResponseSchema,
  agentChallengesListResponseSchema,
  apiErrorResponseSchema,
  challengeRegistrationRequestSchema,
  challengeRegistrationResponseSchema,
  loadConfig,
  submissionIntentRequestSchema,
  submissionIntentResponseSchema,
  submissionPublicKeyResponseSchema,
  submissionRegistrationRequestSchema,
  submissionRegistrationResponseSchema,
  submissionStatusResponseSchema,
} from "@agora/common";

function isAddressRef(value: string) {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

function resolveApiUrl(explicitApiUrl?: string) {
  const apiUrl = explicitApiUrl ?? loadConfig().AGORA_API_URL;
  if (!apiUrl) {
    throw new Error(
      "AGORA_API_URL is required for API requests. Next step: set AGORA_API_URL and retry.",
    );
  }
  return apiUrl.replace(/\/$/, "");
}

function appendQuery(
  pathname: string,
  query?: Record<string, string | number | undefined | null>,
) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs.length > 0 ? `${pathname}?${qs}` : pathname;
}

async function requestJson<T>(input: {
  apiUrl?: string;
  pathname: string;
  init?: RequestInit;
  parse: (json: unknown) => T;
}) {
  const response = await fetch(
    `${resolveApiUrl(input.apiUrl)}${input.pathname}`,
    {
      headers: {
        "content-type": "application/json",
        ...(input.init?.headers ?? {}),
      },
      ...input.init,
    },
  );
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const parsedError = apiErrorResponseSchema.safeParse(payload);
    if (parsedError.success) {
      throw new AgoraError(parsedError.data.error, {
        code: parsedError.data.code,
        retriable: parsedError.data.retriable,
        status: response.status,
      });
    }
    throw new AgoraError(
      `API request failed (${response.status}). Next step: retry or inspect the API response body.`,
      {
        code: "API_REQUEST_FAILED",
        retriable: response.status >= 500,
        status: response.status,
      },
    );
  }
  return input.parse(await response.json());
}

export async function listChallengesFromApi(
  query: AgentChallengesQuery,
  apiUrl?: string,
) {
  return requestJson({
    apiUrl,
    pathname: appendQuery("/api/challenges", {
      status: query.status,
      domain: query.domain,
      poster_address: query.poster_address,
      limit: query.limit,
      min_reward: query.min_reward,
      updated_since: query.updated_since,
      cursor: query.cursor,
    }),
    parse: (json) => agentChallengesListResponseSchema.parse(json),
  });
}

export async function getChallengeFromApi(
  challengeIdOrAddress: string,
  apiUrl?: string,
) {
  const pathname = isAddressRef(challengeIdOrAddress)
    ? `/api/challenges/by-address/${challengeIdOrAddress}`
    : `/api/challenges/${challengeIdOrAddress}`;
  return requestJson({
    apiUrl,
    pathname,
    parse: (json) => agentChallengeDetailResponseSchema.parse(json),
  });
}

export async function registerChallengeWithApi(
  input: {
    txHash: `0x${string}`;
  },
  apiUrl?: string,
) {
  const payload = challengeRegistrationRequestSchema.parse(input);
  const response = await requestJson({
    apiUrl,
    pathname: "/api/challenges",
    init: {
      method: "POST",
      body: JSON.stringify(payload),
    },
    parse: (json) => challengeRegistrationResponseSchema.parse(json),
  });
  return response.data;
}

export async function getChallengeLeaderboardFromApi(
  challengeIdOrAddress: string,
  apiUrl?: string,
) {
  const pathname = isAddressRef(challengeIdOrAddress)
    ? `/api/challenges/by-address/${challengeIdOrAddress}/leaderboard`
    : `/api/challenges/${challengeIdOrAddress}/leaderboard`;
  return requestJson({
    apiUrl,
    pathname,
    parse: (json) => agentChallengeLeaderboardResponseSchema.parse(json),
  });
}

export async function getSubmissionStatusFromApi(
  submissionId: string,
  apiUrl?: string,
) {
  return requestJson({
    apiUrl,
    pathname: `/api/submissions/${submissionId}/status`,
    parse: (json) => submissionStatusResponseSchema.parse(json),
  });
}

export async function getSubmissionStatusByOnChainFromApi(
  input: {
    challengeAddress: string;
    onChainSubmissionId: number;
  },
  apiUrl?: string,
) {
  return requestJson({
    apiUrl,
    pathname: `/api/submissions/by-onchain/${input.challengeAddress}/${input.onChainSubmissionId}/status`,
    parse: (json) => submissionStatusResponseSchema.parse(json),
  });
}

export async function getSubmissionPublicKeyFromApi(apiUrl?: string) {
  return requestJson({
    apiUrl,
    pathname: "/api/submissions/public-key",
    parse: (json) => submissionPublicKeyResponseSchema.parse(json),
  });
}

export async function createSubmissionIntentWithApi(
  input: {
    challengeId?: string;
    challengeAddress?: `0x${string}`;
    solverAddress: `0x${string}`;
    resultCid: string;
    resultFormat?: "plain_v0" | "sealed_submission_v2";
  },
  apiUrl?: string,
) {
  const payload = submissionIntentRequestSchema.parse(input);
  const response = await requestJson({
    apiUrl,
    pathname: "/api/submissions/intent",
    init: {
      method: "POST",
      body: JSON.stringify(payload),
    },
    parse: (json) => submissionIntentResponseSchema.parse(json),
  });
  return response.data;
}

export async function registerSubmissionWithApi(
  input: {
    challengeId?: string;
    challengeAddress?: `0x${string}`;
    resultCid: string;
    txHash: `0x${string}`;
    resultFormat: "sealed_submission_v2";
  },
  apiUrl?: string,
) {
  const payload = submissionRegistrationRequestSchema.parse(input);
  return requestJson({
    apiUrl,
    pathname: "/api/submissions",
    init: {
      method: "POST",
      body: JSON.stringify(payload),
    },
    parse: (json) => submissionRegistrationResponseSchema.parse(json),
  });
}
