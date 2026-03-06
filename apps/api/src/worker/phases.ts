import type { WorkerLogFn } from "./types.js";

export type WorkerPhase =
  | "fetch_inputs"
  | "run_scorer"
  | "pin_proof"
  | "pre_post_reconcile"
  | "post_tx"
  | "wait_confirmation";

export interface WorkerPhaseMeta {
  jobId?: string;
  submissionId?: string;
  challengeId?: string;
  [key: string]: unknown;
}

export async function runWorkerPhase<T>(
  log: WorkerLogFn,
  phase: WorkerPhase,
  meta: WorkerPhaseMeta,
  fn: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  log("info", "Worker phase started", { ...meta, phase });
  try {
    const result = await fn();
    log("info", "Worker phase succeeded", {
      ...meta,
      phase,
      durationMs: Date.now() - startedAt,
    });
    return result;
  } catch (error) {
    log("error", "Worker phase failed", {
      ...meta,
      phase,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export function createWorkerPhaseObserver(
  log: WorkerLogFn,
  meta: WorkerPhaseMeta,
) {
  return {
    onPhaseStart: (phase: WorkerPhase) => {
      log("info", "Worker phase started", { ...meta, phase });
    },
    onPhaseSuccess: (phase: WorkerPhase, durationMs: number) => {
      log("info", "Worker phase succeeded", { ...meta, phase, durationMs });
    },
    onPhaseError: (phase: WorkerPhase, durationMs: number, error: unknown) => {
      log("error", "Worker phase failed", {
        ...meta,
        phase,
        durationMs,
        error: error instanceof Error ? error.message : String(error),
      });
    },
  };
}
