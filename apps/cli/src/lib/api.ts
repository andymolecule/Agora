import {
  type AgentChallengesQuery,
  getChallengeFromApi,
  getChallengeSolverStatusFromApi,
  getSubmissionStatusFromApi,
  listChallengesFromApi,
  waitForSubmissionStatusFromApi,
} from "@agora/agent-runtime";
import {
  AGORA_ERROR_CODES,
  AgoraError,
  readApiClientRuntimeConfig,
} from "@agora/common";

function requireApiUrl() {
  const apiUrl = readApiClientRuntimeConfig().apiUrl;
  if (!apiUrl) {
    throw new AgoraError("AGORA_API_URL is required for API requests.", {
      code: AGORA_ERROR_CODES.configMissing,
      nextAction: "Set AGORA_API_URL and retry.",
    });
  }
  return apiUrl;
}

export async function fetchApiJson<T>(pathname: string): Promise<T> {
  const apiUrl = requireApiUrl();
  const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const response = await fetch(`${apiUrl.replace(/\/$/, "")}${normalizedPath}`);
  if (!response.ok) {
    throw new Error(
      `API request failed (${response.status}): ${await response.text()}`,
    );
  }

  return (await response.json()) as T;
}

export async function listChallengesApi(query: AgentChallengesQuery) {
  return listChallengesFromApi(query, requireApiUrl());
}

export async function getChallengeApi(challengeId: string) {
  return getChallengeFromApi(challengeId, requireApiUrl());
}

export async function getChallengeSolverStatusApi(
  challengeId: string,
  solverAddress: string,
) {
  return getChallengeSolverStatusFromApi(
    challengeId,
    solverAddress,
    requireApiUrl(),
  );
}

export async function getSubmissionStatusApi(submissionId: string) {
  return getSubmissionStatusFromApi(submissionId, requireApiUrl());
}

export async function waitForSubmissionStatusApi(
  submissionId: string,
  timeoutSeconds?: number,
) {
  return waitForSubmissionStatusFromApi(
    submissionId,
    { timeoutSeconds },
    requireApiUrl(),
  );
}
