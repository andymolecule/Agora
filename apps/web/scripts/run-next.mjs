import { spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyAgoraRuntimeEnv } from "../../../scripts/runtime-env.mjs";

const require = createRequire(import.meta.url);
const nextBin = require.resolve("next/dist/bin/next");
const args = process.argv.slice(2);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.join(scriptDir, "..");
const nextOutputDir = path.join(appRoot, ".next");
const nextOutputPackageJsonPath = path.join(nextOutputDir, "package.json");

applyAgoraRuntimeEnv();

if (args[0] === "build" && fs.existsSync(nextOutputDir)) {
  fs.rmSync(nextOutputDir, { recursive: true, force: true });
}

if (!fs.existsSync(nextOutputDir)) {
  fs.mkdirSync(nextOutputDir, { recursive: true });
}
fs.writeFileSync(
  nextOutputPackageJsonPath,
  `${JSON.stringify({ type: "commonjs" }, null, 2)}\n`,
  "utf8",
);

const child = spawn(process.execPath, [nextBin, ...args], {
  stdio: "inherit",
  env: process.env,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
