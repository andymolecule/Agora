import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import { loadConfig } from "@hermes/common";
import { claimNextJob, createSupabaseClient } from "@hermes/db";
import { ensureDockerReady } from "@hermes/scorer";
import { sweepFinalizable } from "./chain.js";
import { processJob } from "./jobs.js";
import { FINALIZE_SWEEP_INTERVAL_MS, POLL_INTERVAL_MS, sleep } from "./policy.js";
import {
  resolveRunnerPolicyForChallenge,
  type ResolvedRunnerPolicy,
} from "./scoring.js";
import type { ScoreJobRow, WorkerLogFn } from "./types.js";

const WORKER_ID = `worker-${crypto.randomBytes(4).toString("hex")}`;

const log: WorkerLogFn = (level, message, meta) => {
  const ts = new Date().toISOString();
  const metaStr = meta ? ` ${JSON.stringify(meta)}` : "";
  console[level](`[${ts}] [${WORKER_ID}] ${message}${metaStr}`);
};

export { resolveRunnerPolicyForChallenge };
export type { ResolvedRunnerPolicy };

export async function startWorker() {
  loadConfig();

  if (!process.env.HERMES_ORACLE_KEY && !process.env.HERMES_PRIVATE_KEY) {
    throw new Error(
      "HERMES_ORACLE_KEY or HERMES_PRIVATE_KEY is required for the scoring worker.",
    );
  }
  if (process.env.HERMES_ORACLE_KEY && !process.env.HERMES_PRIVATE_KEY) {
    process.env.HERMES_PRIVATE_KEY = process.env.HERMES_ORACLE_KEY;
  }

  try {
    await ensureDockerReady();
    log("info", "Docker health check passed");
  } catch {
    log("error", "Docker is not available. Worker cannot start without Docker.");
    process.exit(1);
  }

  const db = createSupabaseClient(true);

  log("info", "Scoring worker started", {
    pollIntervalMs: POLL_INTERVAL_MS,
    finalizeSweepIntervalMs: FINALIZE_SWEEP_INTERVAL_MS,
    workerId: WORKER_ID,
  });

  let lastFinalizeSweepAt = 0;
  while (true) {
    let claimedJob = false;
    try {
      const job = await claimNextJob(db, WORKER_ID);

      if (job) {
        claimedJob = true;
        log("info", `Claimed job ${job.id}`, {
          submissionId: job.submission_id,
          challengeId: job.challenge_id,
          attempt: job.attempts,
          maxAttempts: job.max_attempts,
        });

        await processJob(db, job as ScoreJobRow, log);
      }

      const now = Date.now();
      if (now - lastFinalizeSweepAt >= FINALIZE_SWEEP_INTERVAL_MS) {
        await sweepFinalizable(db, log);
        lastFinalizeSweepAt = now;
      }
    } catch (error) {
      log("error", "Worker loop error", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    if (!claimedJob) {
      await sleep(POLL_INTERVAL_MS);
    }
  }
}

export function maybeRunWorkerCli(importMetaUrl: string, argv1?: string) {
  const isEntrypoint = argv1 ? pathToFileURL(argv1).href === importMetaUrl : false;
  if (!isEntrypoint) return;

  startWorker().catch((error) => {
    log("error", "Worker failed to start", {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  });
}
