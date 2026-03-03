export const SCORE_JOB_STATUS = {
  queued: "queued",
  running: "running",
  scored: "scored",
  failed: "failed",
  skipped: "skipped",
} as const;

export type ScoreJobStatus =
  (typeof SCORE_JOB_STATUS)[keyof typeof SCORE_JOB_STATUS];

export const SCORE_JOB_STATUSES: readonly ScoreJobStatus[] = [
  SCORE_JOB_STATUS.queued,
  SCORE_JOB_STATUS.running,
  SCORE_JOB_STATUS.scored,
  SCORE_JOB_STATUS.failed,
  SCORE_JOB_STATUS.skipped,
];

const SCORE_JOB_STATUS_SET = new Set<string>(SCORE_JOB_STATUSES);

export function isScoreJobStatus(value: unknown): value is ScoreJobStatus {
  return typeof value === "string" && SCORE_JOB_STATUS_SET.has(value);
}
