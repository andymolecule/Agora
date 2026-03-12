import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "../src/app/api/version/route";

test("api/version reports web runtime version", async () => {
  const response = await GET();
  assert.equal(response.status, 200);

  const payload = (await response.json()) as {
    ok: boolean;
    service: string;
    runtimeVersion: string;
    checkedAt: string;
  };

  assert.equal(payload.ok, true);
  assert.equal(payload.service, "web");
  assert.equal(typeof payload.runtimeVersion, "string");
  assert.ok(payload.runtimeVersion.length > 0);
  assert.equal(typeof payload.checkedAt, "string");
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("api/version auto-detects runtime version from Vercel git metadata", async () => {
  const originalAgoraRuntimeVersion = process.env.AGORA_RUNTIME_VERSION;
  const originalVercelCommitSha = process.env.VERCEL_GIT_COMMIT_SHA;

  process.env.AGORA_RUNTIME_VERSION = "dev";
  process.env.VERCEL_GIT_COMMIT_SHA =
    "19B3A2207D9B0A1B2C3D4E5F60718293ABCDEF12";

  try {
    const response = await GET();
    const payload = (await response.json()) as {
      runtimeVersion: string;
    };

    assert.equal(payload.runtimeVersion, "19b3a2207d9b");
  } finally {
    process.env.AGORA_RUNTIME_VERSION = originalAgoraRuntimeVersion;
    process.env.VERCEL_GIT_COMMIT_SHA = originalVercelCommitSha;
  }
});
