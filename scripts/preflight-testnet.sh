#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ -f ".env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source ".env"
  set +a
fi

required_env=(
  AGORA_RPC_URL
  AGORA_CHAIN_ID
  AGORA_FACTORY_ADDRESS
  AGORA_USDC_ADDRESS
  AGORA_PRIVATE_KEY
  AGORA_ORACLE_KEY
  AGORA_PINATA_JWT
  AGORA_SUPABASE_URL
  AGORA_SUPABASE_ANON_KEY
  AGORA_SUPABASE_SERVICE_KEY
  AGORA_API_URL
  AGORA_CORS_ORIGINS
)

required_cmds=(node pnpm docker forge)

failures=0

check_cmd() {
  local cmd="$1"
  if command -v "$cmd" >/dev/null 2>&1; then
    echo "[OK] command available: $cmd"
  else
    echo "[FAIL] missing command: $cmd"
    failures=$((failures + 1))
  fi
}

check_env() {
  local key="$1"
  if [[ -n "${!key:-}" ]]; then
    echo "[OK] env set: $key"
  else
    echo "[FAIL] env missing: $key"
    failures=$((failures + 1))
  fi
}

echo "== Agora Testnet Preflight =="

for cmd in "${required_cmds[@]}"; do
  check_cmd "$cmd"
done

for key in "${required_env[@]}"; do
  check_env "$key"
done

if [[ "$failures" -gt 0 ]]; then
  echo
  echo "Preflight failed with $failures issue(s)."
  exit 1
fi

echo

echo "[STEP] Building workspace"
pnpm turbo build >/dev/null

echo "[STEP] Running CLI doctor"
node apps/cli/dist/index.js doctor --format table

echo "[STEP] Checking API health endpoint"
API_HEALTH_URL="${AGORA_API_URL%/}/healthz"
http_status=$(curl -s -o /tmp/agora_preflight_healthz.json -w "%{http_code}" "$API_HEALTH_URL" || true)
if [[ "$http_status" != "200" ]]; then
  echo "[FAIL] API health check failed ($API_HEALTH_URL => HTTP $http_status)"
  echo "Response:"
  cat /tmp/agora_preflight_healthz.json || true
  exit 1
fi
echo "[OK] API health check passed ($API_HEALTH_URL)"

echo

echo "Preflight passed. Ready for testnet operations."
