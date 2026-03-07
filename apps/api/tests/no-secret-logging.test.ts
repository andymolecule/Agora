import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const SECRET_ENV_PATTERN =
  /console\.(log|info|warn|error)\([\s\S]{0,400}?process\.env\.(AGORA_PRIVATE_KEY|AGORA_ORACLE_KEY|PRIVATE_KEY)/m;

function collectSourceFiles(rootDir: string): string[] {
  const queue = [rootDir];
  const files: string[] = [];

  while (queue.length > 0) {
    const current = queue.pop();
    if (!current) continue;

    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      const relativePath = path.relative(rootDir, fullPath);

      if (entry.isDirectory()) {
        if (
          entry.name === "node_modules" ||
          entry.name === "dist" ||
          entry.name === ".git" ||
          relativePath.startsWith(`packages${path.sep}contracts`)
        ) {
          continue;
        }
        queue.push(fullPath);
        continue;
      }

      if (!entry.isFile()) continue;
      if (!/\.(ts|tsx|js|mjs)$/.test(entry.name)) continue;
      files.push(relativePath);
    }
  }

  return files;
}

test("source does not log private key env values", () => {
  const repoRoot = path.resolve(process.cwd(), "../..");
  const files = [
    ...collectSourceFiles(path.join(repoRoot, "apps")).map((value) =>
      path.posix.join("apps", value.split(path.sep).join(path.posix.sep)),
    ),
    ...collectSourceFiles(path.join(repoRoot, "packages")).map((value) =>
      path.posix.join("packages", value.split(path.sep).join(path.posix.sep)),
    ),
  ];

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
