import { readWorkerTimingConfig } from "@agora/common";
import { isScorerInfrastructureError } from "@agora/scorer";

export function getWorkerPollIntervalMs() {
  return readWorkerTimingConfig().pollIntervalMs;
}

export function getWorkerFinalizeSweepIntervalMs() {
  return readWorkerTimingConfig().finalizeSweepIntervalMs;
}

export function getWorkerPostTxRetryDelayMs() {
  return readWorkerTimingConfig().postTxRetryDelayMs;
}

export function getWorkerInfraRetryDelayMs() {
  return readWorkerTimingConfig().infraRetryDelayMs;
}

export function getWorkerGeneralRetryDelayMs(attempts: number) {
  const timing = readWorkerTimingConfig();
  const normalizedAttempts = Math.max(1, attempts);
  const exponent = Math.max(0, normalizedAttempts - 1);
  return Math.min(
    timing.postTxRetryDelayMs * 2 ** exponent,
    timing.infraRetryDelayMs,
  );
}

export const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

export function isWorkerInfrastructureError(message: string): boolean {
  return isScorerInfrastructureError(message);
}
