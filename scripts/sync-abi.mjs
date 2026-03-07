import fs from "node:fs";
import path from "node:path";

const pairs = [
  {
    from: "packages/contracts/out/AgoraFactory.sol/AgoraFactory.json",
    to: "packages/common/src/abi/AgoraFactory.json",
    label: "AgoraFactory",
  },
  {
    from: "packages/contracts/out/AgoraChallenge.sol/AgoraChallenge.json",
    to: "packages/common/src/abi/AgoraChallenge.json",
    label: "AgoraChallenge",
  },
];

for (const pair of pairs) {
  const srcPath = path.resolve(pair.from);
  const dstPath = path.resolve(pair.to);

  if (!fs.existsSync(srcPath)) {
    throw new Error(
      `Missing forge artifact for ${pair.label}: ${srcPath}. Run 'pnpm --filter @agora/contracts build' first.`,
    );
  }

  const artifact = JSON.parse(fs.readFileSync(srcPath, "utf8"));
  if (!Array.isArray(artifact.abi)) {
    throw new Error(`Invalid artifact ABI for ${pair.label}: ${srcPath}`);
  }

  fs.writeFileSync(dstPath, `${JSON.stringify(artifact.abi, null, 2)}\n`);
  console.log(`synced ${pair.label} ABI (${artifact.abi.length} entries)`);
}
