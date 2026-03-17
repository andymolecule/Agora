import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const cliDir = path.resolve(testsDir, "..");
const walletModuleUrl = pathToFileURL(
  path.join(cliDir, "src/lib/wallet.ts"),
).href;

function createTempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "agora-cli-home-"));
}

function withTempHome(fn: (homeDir: string) => void) {
  const homeDir = createTempHome();
  try {
    fn(homeDir);
  } finally {
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
}

function runNode(
  homeDir: string,
  args: string[],
  extraEnv: Record<string, string | undefined> = {},
) {
  return spawnSync(process.execPath, args, {
    cwd: cliDir,
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: homeDir,
      ...extraEnv,
    },
  });
}

function runCli(
  homeDir: string,
  args: string[],
  extraEnv: Record<string, string | undefined> = {},
) {
  return runNode(
    homeDir,
    ["--import", "tsx", "src/index.ts", ...args],
    extraEnv,
  );
}

test("config set stores private_key env refs without validating them as raw keys", () => {
  withTempHome((homeDir) => {
    const result = runCli(homeDir, [
      "config",
      "set",
      "private_key",
      "env:AGORA_PRIVATE_KEY",
      "--format",
      "json",
    ]);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.deepEqual(JSON.parse(result.stdout), {
      key: "private_key",
      value: "env:AGORA_PRIVATE_KEY",
    });

    const configPath = path.join(homeDir, ".agora", "config.json");
    const stored = JSON.parse(fs.readFileSync(configPath, "utf8")) as {
      private_key?: string;
    };
    assert.equal(stored.private_key, "env:AGORA_PRIVATE_KEY");
  });
});

test("config get keeps the stored env ref while runtime commands resolve the real key", () => {
  withTempHome((homeDir) => {
    const privateKey = `0x${"11".repeat(32)}`;

    const setResult = runCli(homeDir, [
      "config",
      "set",
      "private_key",
      "env:AGORA_PRIVATE_KEY",
    ]);
    assert.equal(setResult.status, 0, setResult.stderr || setResult.stdout);

    const getResult = runCli(homeDir, ["config", "get", "private_key"], {
      AGORA_PRIVATE_KEY: privateKey,
    });
    assert.equal(getResult.status, 0, getResult.stderr || getResult.stdout);
    assert.equal(getResult.stdout.trim(), "env:AGORA_PRIVATE_KEY");

    const resolveResult = runNode(
      homeDir,
      [
        "--input-type=module",
        "--import",
        "tsx",
        "--eval",
        `const { ensurePrivateKey } = await import(${JSON.stringify(walletModuleUrl)}); process.stdout.write(ensurePrivateKey());`,
      ],
      { AGORA_PRIVATE_KEY: privateKey },
    );

    assert.equal(
      resolveResult.status,
      0,
      resolveResult.stderr || resolveResult.stdout,
    );
    assert.equal(resolveResult.stdout.trim(), privateKey);
  });
});
