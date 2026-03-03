import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";

const SECRET_ENV_PATTERN =
  /console\.(log|info|warn|error)\([\s\S]{0,400}?process\.env\.(HERMES_PRIVATE_KEY|HERMES_ORACLE_KEY|PRIVATE_KEY)/m;

test("source does not log private key env values", () => {
  const repoRoot = path.resolve(process.cwd(), "../..");
  const filesRaw = execFileSync("rg", ["--files", "apps", "packages"], {
    encoding: "utf8",
    cwd: repoRoot,
  });
  const files = filesRaw
    .split("\n")
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((filePath) => /\.(ts|tsx|js|mjs)$/.test(filePath))
    .filter((filePath) => !filePath.includes("/dist/"))
    .filter((filePath) => !filePath.includes("/node_modules/"))
    .filter((filePath) => !filePath.startsWith("packages/contracts/"));

  const violations: string[] = [];
  for (const relativePath of files) {
    const absolutePath = path.resolve(repoRoot, relativePath);
    const content = fs.readFileSync(absolutePath, "utf8");
    if (SECRET_ENV_PATTERN.test(content)) {
      violations.push(relativePath);
    }
  }

  assert.deepEqual(
    violations,
    [],
    `Found potential secret logging in:\n${violations.join("\n")}`,
  );
});
