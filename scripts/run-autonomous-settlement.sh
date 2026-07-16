#!/usr/bin/env bash
# Post-submission: load operator env for autonomous Escrow V2 release.
# Keys stay on the operator host — never on the public browser frontend.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1091
if [[ -f "$ROOT/.env" ]]; then set -a; source "$ROOT/.env"; set +a; fi

export PROOFLET_API_URL="${PROOFLET_API_URL:-https://prooflet-api.onrender.com}"
export USEFUL_WAITING_API_URL="${USEFUL_WAITING_API_URL:-$PROOFLET_API_URL}"
# Prefer public hosted API for operator ticks even if .env points at localhost.
if [[ "$PROOFLET_API_URL" == *"127.0.0.1"* ]] || [[ "$PROOFLET_API_URL" == *"localhost"* ]]; then
  export PROOFLET_API_URL="https://prooflet-api.onrender.com"
  export USEFUL_WAITING_API_URL="$PROOFLET_API_URL"
fi

export ESCROW_V2_ADDRESS="${ESCROW_V2_ADDRESS:-0x55bde7d3546f3e6e534a508a9b96d4e8d839eee9}"
export ARC_RPC_URL="${ARC_RPC_URL:-https://arc-testnet.drpc.org}"
# Default execute for autonomous operator; CLI --dry-run still wins inside the worker.
export ESCROW_V2_AUTO_RELEASE_MODE="${ESCROW_V2_AUTO_RELEASE_MODE:-execute}"
export ESCROW_V2_AUTO_RELEASE_INTERVAL_MS="${ESCROW_V2_AUTO_RELEASE_INTERVAL_MS:-60000}"

if [[ -f /root/.hermes/secure/escrow-operator-api-key ]]; then
  export ESCROW_OPERATOR_API_KEY="$(tr -d '\n' < /root/.hermes/secure/escrow-operator-api-key)"
fi

# SETTLEMENT_OPERATOR_PRIVATE_KEY preferred; fall back to TREASURY from .env
export SETTLEMENT_OPERATOR_PRIVATE_KEY="${SETTLEMENT_OPERATOR_PRIVATE_KEY:-${TREASURY_PRIVATE_KEY:-}}"

cd "$ROOT"
exec node --no-warnings --env-file-if-exists=.env workers/escrow-v2-auto-release.mjs "$@"
