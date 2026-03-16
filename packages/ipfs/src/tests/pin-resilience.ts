import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resetConfigCache } from "@agora/common";

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;

process.env.AGORA_PINATA_JWT = "test-jwt";
resetConfigCache();

const { pinFile } = await import("../pin");

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "agora-ipfs-pin-"));
const filePath = path.join(tempDir, "submission.csv");
await fs.writeFile(filePath, "id,prediction\nrow-1,1\n", "utf8");

try {
  {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      if (calls === 1) {
        return new Response("temporary", { status: 503 });
      }
      return new Response(
        JSON.stringify({ data: { cid: "bafyretrysuccess" } }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }) as typeof fetch;

    const cid = await pinFile(filePath);
    assert.equal(cid, "ipfs://bafyretrysuccess");
    assert.equal(calls, 2, "should retry once on 503");
  }

  {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response("missing", { status: 404 });
    }) as typeof fetch;

    await assert.rejects(pinFile(filePath), /404/);
    assert.equal(calls, 1, "should not retry non-retryable 4xx status");
  }
} finally {
  globalThis.fetch = originalFetch;
  process.env = originalEnv;
  resetConfigCache();
  await fs.rm(tempDir, { recursive: true, force: true });
}

console.log("pin resilience tests passed");
