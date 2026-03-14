#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP_NAME="${AGORA_WORKER_PM2_NAME:-agora-worker}"

cd "$ROOT_DIR"

read_pm2_status() {
  pm2 jlist | node -e 'const fs = require("node:fs"); const app = JSON.parse(fs.readFileSync(0, "utf8")).find((entry) => entry.name === process.argv[1]); process.stdout.write(app?.pm2_env?.status ?? "missing");' "$APP_NAME"
}

status="$(read_pm2_status)"

case "$status" in
  online|launching|waiting*)
    echo "[watchdog-worker] Worker status is '$status'; no action required."
    exit 0
    ;;
  errored|stopped|missing)
    echo "[watchdog-worker] Worker status is '$status'; restarting via PM2 ecosystem."
    pm2 startOrRestart scripts/ops/ecosystem.config.cjs --only "$APP_NAME" --update-env
    pm2 save >/dev/null
    exit 0
    ;;
  *)
    echo "[watchdog-worker] Worker status is '$status'; leaving unchanged."
    exit 0
    ;;
esac
