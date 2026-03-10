import {
  hasSubmissionSealPublicConfig,
  loadConfig,
} from "@agora/common";
import {
  createSupabaseClient,
  listWorkerRuntimeStates,
  getEligibleQueuedJobCount,
  getLastScoredJobTime,
  getOldestPendingJobTime,
  getOldestRunningStartedAt,
  getScoreJobCounts,
  runningOverThresholdCount,
  summarizeWorkerRuntimeStates,
} from "@agora/db";
import { Hono } from "hono";
import type { ApiEnv } from "../types.js";

type WorkerStatus = "ok" | "warning" | "idle";

export const QUEUE_STALE_THRESHOLD_MS = 5 * 60 * 1000;
export const RUNNING_STALE_THRESHOLD_MS = 20 * 60 * 1000;

export interface WorkerHealthSnapshotInput {
  jobs: {
    queued: number;
    eligibleQueued: number;
    running: number;
    scored: number;
    failed: number;
    skipped: number;
  };
  oldestPendingAt: string | null;
  lastScoredAt: string | null;
  oldestRunningStartedAt: string | null;
  runningOverThresholdCount: number;
  workerRuntime?: {
    healthyWorkers: number;
    staleWorkers: number;
    latestHeartbeatAt: string | null;
    requireReadySealWorker: boolean;
    healthyWorkersForActiveSealKey: number;
    staleAfterMs: number;
  };
  nowMs?: number;
}

export function deriveWorkerHealthStatus(
  input: WorkerHealthSnapshotInput,
): WorkerStatus {
  const nowMs = input.nowMs ?? Date.now();
  const oldestQueuedAgeMs = input.oldestPendingAt
    ? nowMs - new Date(input.oldestPendingAt).getTime()
    : null;

  if (
    input.workerRuntime?.requireReadySealWorker &&
    (input.workerRuntime.healthyWorkersForActiveSealKey ?? 0) === 0
  ) {
    return "warning";
  }
  if (
    input.jobs.eligibleQueued > 0 &&
    (input.workerRuntime?.healthyWorkers ?? 0) === 0
  ) {
    return "warning";
  }

  if (
    input.jobs.eligibleQueued === 0 &&
    input.jobs.running === 0 &&
    input.jobs.failed === 0
  ) {
    return "idle";
  }

  if (
    typeof oldestQueuedAgeMs === "number" &&
    oldestQueuedAgeMs > QUEUE_STALE_THRESHOLD_MS
  ) {
    return "warning";
  }

  if (input.runningOverThresholdCount > 0) return "warning";
  if (input.jobs.failed > 0) return "warning";

  return "ok";
}

export function buildWorkerHealthResponse(input: WorkerHealthSnapshotInput) {
  const nowMs = input.nowMs ?? Date.now();
  const oldestQueuedAgeMs = input.oldestPendingAt
    ? Math.max(0, nowMs - new Date(input.oldestPendingAt).getTime())
    : null;
  const status = deriveWorkerHealthStatus({ ...input, nowMs });

  return {
    ok: status !== "warning",
    status,
    jobs: input.jobs,
    oldestPendingAt: input.oldestPendingAt,
    lastScoredAt: input.lastScoredAt,
    oldestRunningStartedAt: input.oldestRunningStartedAt,
    runningOverThresholdCount: input.runningOverThresholdCount,
    thresholds: {
      queueStaleMs: QUEUE_STALE_THRESHOLD_MS,
      runningStaleMs: RUNNING_STALE_THRESHOLD_MS,
    },
    metrics: {
      oldestQueuedAgeMs,
    },
    checkedAt: new Date(nowMs).toISOString(),
    workers: input.workerRuntime
      ? {
          healthy: input.workerRuntime.healthyWorkers,
          stale: input.workerRuntime.staleWorkers,
          latestHeartbeatAt: input.workerRuntime.latestHeartbeatAt,
          staleAfterMs: input.workerRuntime.staleAfterMs,
        }
      : undefined,
  };
}

const router = new Hono<ApiEnv>();

router.get("/", async (c) => {
  try {
    const db = createSupabaseClient(true);
    const config = loadConfig();
    const activeSealKeyId = hasSubmissionSealPublicConfig(config)
      ? (config.AGORA_SUBMISSION_SEAL_KEY_ID as string)
      : null;

    const [
      jobs,
      eligibleQueued,
      oldestPendingAt,
      lastScoredAt,
      oldestRunningStartedAt,
      runningOverThreshold,
      workerRuntimeStates,
    ] = await Promise.all([
      getScoreJobCounts(db),
      getEligibleQueuedJobCount(db),
      getOldestPendingJobTime(db),
      getLastScoredJobTime(db),
      getOldestRunningStartedAt(db),
      runningOverThresholdCount(db, RUNNING_STALE_THRESHOLD_MS),
      listWorkerRuntimeStates(db),
    ]);
    const workerRuntime = summarizeWorkerRuntimeStates(workerRuntimeStates, {
      activeSealKeyId,
    });
    const sealingConfigured = hasSubmissionSealPublicConfig(config);
    const sealingReady =
      sealingConfigured && workerRuntime.healthyWorkersForActiveSealKey > 0;

    return c.json({
      ...buildWorkerHealthResponse({
        jobs: {
          ...jobs,
          eligibleQueued,
        },
        oldestPendingAt,
        lastScoredAt,
        oldestRunningStartedAt,
        runningOverThresholdCount: runningOverThreshold,
        workerRuntime: {
          healthyWorkers: workerRuntime.healthyWorkers,
          staleWorkers: workerRuntime.staleWorkers,
          latestHeartbeatAt: workerRuntime.latestHeartbeatAt,
          requireReadySealWorker: sealingConfigured,
          healthyWorkersForActiveSealKey:
            workerRuntime.healthyWorkersForActiveSealKey,
          staleAfterMs: workerRuntime.staleAfterMs,
        },
      }),
      sealing: {
        enabled: sealingReady,
        configured: sealingConfigured,
        keyId: activeSealKeyId,
        publicKeyLoaded: Boolean(config.AGORA_SUBMISSION_SEAL_PUBLIC_KEY_PEM),
        workerReady: workerRuntime.healthyWorkersForActiveSealKey > 0,
        healthyWorkersForActiveKey:
          workerRuntime.healthyWorkersForActiveSealKey,
      },
    });
  } catch (error) {
    return c.json(
      {
        ok: false,
        status: "error",
        error:
          error instanceof Error
            ? error.message
            : "Failed to read worker health",
        checkedAt: new Date().toISOString(),
      },
      503,
    );
  }
});

export default router;
