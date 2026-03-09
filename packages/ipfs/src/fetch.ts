import fs from "node:fs/promises";
import path from "node:path";
import { loadIpfsConfig } from "@agora/common";
import { DEFAULT_IPFS_GATEWAY } from "@agora/common";

let warnedSharedGateway = false;

const DEFAULT_FETCH_TIMEOUT_MS = 30_000;
const DEFAULT_FETCH_MAX_ATTEMPTS = 3;
const DEFAULT_FETCH_RETRY_BASE_MS = 500;

function envInt(name: string, fallback: number, min = 0) {
  const raw = process.env[name];
  if (typeof raw !== "string" || raw.length === 0) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  const normalized = Math.floor(parsed);
  if (normalized < min) return fallback;
  return normalized;
}

const FETCH_TIMEOUT_MS = envInt(
  "AGORA_IPFS_FETCH_TIMEOUT_MS",
  DEFAULT_FETCH_TIMEOUT_MS,
  1,
);
const FETCH_MAX_ATTEMPTS = envInt(
  "AGORA_IPFS_FETCH_MAX_ATTEMPTS",
  DEFAULT_FETCH_MAX_ATTEMPTS,
  1,
);
const FETCH_RETRY_BASE_MS = envInt(
  "AGORA_IPFS_FETCH_RETRY_BASE_MS",
  DEFAULT_FETCH_RETRY_BASE_MS,
  0,
);

function isBareIpfsCid(value: string): boolean {
  return value.startsWith("Qm") || value.startsWith("bafy");
}

function resolveGateway(cidOrUrl: string): string {
  const isCid = cidOrUrl.startsWith("ipfs://") || isBareIpfsCid(cidOrUrl);
  if (isCid) {
    const config = loadIpfsConfig();
    const gateway =
      config.AGORA_IPFS_GATEWAY ?? DEFAULT_IPFS_GATEWAY;
    if (
      !warnedSharedGateway
      && process.env.NODE_ENV === "production"
      && gateway === DEFAULT_IPFS_GATEWAY
    ) {
      warnedSharedGateway = true;
      console.warn(
        "Using shared IPFS gateway in production. Set AGORA_IPFS_GATEWAY to a dedicated gateway to reduce rate limiting.",
      );
    }
    const bareHash = cidOrUrl.replace("ipfs://", "");
    return `${gateway}${bareHash}`;
  }
  return cidOrUrl;
}

function isRetryableStatus(status: number) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function isRetryableFetchError(error: unknown) {
  if (!(error instanceof Error)) return false;
  if (error.name === "AbortError") return true;
  return (
    error instanceof TypeError ||
    /network|timed out|ECONNRESET|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|socket/i.test(
      error.message,
    )
  );
}

function normalizeFetchError(url: string, error: unknown) {
  if (error instanceof Error && error.name === "AbortError") {
    return new Error(`IPFS fetch timeout after ${FETCH_TIMEOUT_MS}ms: ${url}`);
  }
  if (error instanceof Error) return error;
  return new Error(String(error));
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchWithTimeoutAndRetry(url: string): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= FETCH_MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let shouldRetry = false;

    try {
      const response = await fetch(url, { signal: controller.signal });
      if (response.ok) {
        return response;
      }

      const message = `Failed to fetch from ${url}: ${response.status}`;
      if (isRetryableStatus(response.status) && attempt < FETCH_MAX_ATTEMPTS) {
        // Drain response body before retrying so the connection can be reused.
        await response.arrayBuffer().catch(() => undefined);
        lastError = new Error(message);
        shouldRetry = true;
      } else {
        throw new Error(message);
      }
    } catch (error) {
      const normalized = normalizeFetchError(url, error);
      if (attempt < FETCH_MAX_ATTEMPTS && isRetryableFetchError(error)) {
        lastError = normalized;
        shouldRetry = true;
      } else {
        throw normalized;
      }
    } finally {
      clearTimeout(timeout);
    }

    if (shouldRetry) {
      const backoffMs = FETCH_RETRY_BASE_MS * 2 ** (attempt - 1);
      if (backoffMs > 0) {
        await sleep(backoffMs);
      }
    }
  }

  throw (
    lastError ??
    new Error(`Failed to fetch from ${url} after ${FETCH_MAX_ATTEMPTS} attempts`)
  );
}

export async function getJSON<T = unknown>(cidOrUrl: string): Promise<T> {
  const url = resolveGateway(cidOrUrl);
  const response = await fetchWithTimeoutAndRetry(url);
  return (await response.json()) as T;
}

export async function getText(cidOrUrl: string): Promise<string> {
  const url = resolveGateway(cidOrUrl);
  const response = await fetchWithTimeoutAndRetry(url);
  return await response.text();
}

export async function getFile(cidOrUrl: string): Promise<ArrayBuffer> {
  const url = resolveGateway(cidOrUrl);
  const response = await fetchWithTimeoutAndRetry(url);
  return await response.arrayBuffer();
}

export async function downloadToPath(
  cidOrUrl: string,
  outPath: string,
): Promise<string> {
  const data = await getFile(cidOrUrl);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, Buffer.from(data));
  return outPath;
}
