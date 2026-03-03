export const POLL_INTERVAL_MS = Number(process.env.HERMES_WORKER_POLL_MS ?? 15_000);
export const FINALIZE_SWEEP_INTERVAL_MS = Number(
  process.env.HERMES_WORKER_FINALIZE_SWEEP_MS ?? 60_000,
);

export const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

export function isDockerInfrastructureError(message: string): boolean {
  return /docker is required|docker.*not running|docker info failed/i.test(
    message,
  );
}
