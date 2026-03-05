const WRITE_LIMIT = 5;
const WRITE_WINDOW_MS = 60 * 60 * 1000;
const GC_INTERVAL_MS = 10 * 60 * 1000;

const writeBuckets = new Map<string, { count: number; resetAt: number }>();

// Prevent unbounded memory growth from expired buckets
const gcTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of writeBuckets) {
    if (bucket.resetAt <= now) writeBuckets.delete(key);
  }
}, GC_INTERVAL_MS);
gcTimer.unref();

export function consumeWriteQuota(address: string, routeKey: string) {
  const key = `${address}:${routeKey}`;
  const now = Date.now();
  const current = writeBuckets.get(key);
  const bucket =
    !current || current.resetAt <= now
      ? { count: 0, resetAt: now + WRITE_WINDOW_MS }
      : current;

  if (bucket.count >= WRITE_LIMIT) {
    const retryAfterSec = Math.ceil((bucket.resetAt - now) / 1000);
    return {
      allowed: false,
      retryAfterSec,
      message: `Rate limit exceeded: max ${WRITE_LIMIT} write requests per hour. Retry after ${retryAfterSec}s.`,
    };
  }

  bucket.count += 1;
  writeBuckets.set(key, bucket);
  return { allowed: true } as const;
}
