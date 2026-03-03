import assert from "node:assert/strict";

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;

process.env.HERMES_IPFS_FETCH_TIMEOUT_MS = "20";
process.env.HERMES_IPFS_FETCH_MAX_ATTEMPTS = "2";
process.env.HERMES_IPFS_FETCH_RETRY_BASE_MS = "0";

const { getText } = await import("../fetch");

try {
  {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      if (calls === 1) {
        return new Response("temporary", { status: 503 });
      }
      return new Response("ok", { status: 200 });
    }) as typeof fetch;

    const text = await getText("https://example.invalid/retry");
    assert.equal(text, "ok");
    assert.equal(calls, 2, "should retry once on 503");
  }

  {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response("missing", { status: 404 });
    }) as typeof fetch;

    await assert.rejects(
      getText("https://example.invalid/not-found"),
      /404/,
    );
    assert.equal(calls, 1, "should not retry non-retryable 4xx status");
  }

  {
    let calls = 0;
    globalThis.fetch = ((_: string, init?: RequestInit) =>
      new Promise<Response>((_, reject) => {
        calls += 1;
        const signal = init?.signal;
        if (signal) {
          signal.addEventListener("abort", () => {
            const error = new Error("aborted");
            (error as Error & { name: string }).name = "AbortError";
            reject(error);
          });
        }
      })) as typeof fetch;

    await assert.rejects(
      getText("https://example.invalid/timeout"),
      /IPFS fetch timeout/,
    );
    assert.equal(calls, 2, "timeout should retry up to max attempts");
  }
} finally {
  process.env = originalEnv;
  globalThis.fetch = originalFetch;
}

console.log("fetch resilience tests passed");
