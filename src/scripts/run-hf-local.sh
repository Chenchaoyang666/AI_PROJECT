#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

export POOL_CRYPTO_KEY="${POOL_CRYPTO_KEY:-test-crypto-key}"
export ADMIN_SESSION_SECRET="${ADMIN_SESSION_SECRET:-test-admin-session-secret}"
export ADMIN_HF_USERNAMES="${ADMIN_HF_USERNAMES:-local-admin}"
export HF_LOCAL_BYPASS_AUTH="${HF_LOCAL_BYPASS_AUTH:-1}"
export HF_LOCAL_BYPASS_USER="${HF_LOCAL_BYPASS_USER:-${ADMIN_HF_USERNAMES}}"
export CODEX_ACCOUNT_PROXY_KEY="${CODEX_ACCOUNT_PROXY_KEY:-acc-proxy-key}"
export CODEX_API_PROXY_KEY="${CODEX_API_PROXY_KEY:-codex-api-proxy-key}"
export CLAUDE_API_PROXY_KEY="${CLAUDE_API_PROXY_KEY:-claude-api-proxy-key}"

export POOL_STORAGE_BACKEND="${POOL_STORAGE_BACKEND:-local-fs}"
export DATA_DIR="${DATA_DIR:-/tmp/hf-space-local-data}"
export PORT="${PORT:-7860}"

cd "${REPO_ROOT}"

echo "Building UI for local HF remote-mode simulation..."
npm run ui:build

echo "Starting local HF remote-mode server..."
echo "POOL_STORAGE_BACKEND=${POOL_STORAGE_BACKEND}"
echo "DATA_DIR=${DATA_DIR}"
echo "PORT=${PORT}"
echo "ADMIN_HF_USERNAMES=${ADMIN_HF_USERNAMES}"
echo "HF_LOCAL_BYPASS_AUTH=${HF_LOCAL_BYPASS_AUTH}"
echo "http://127.0.0.1:7860/admin"
exec node src/hf-space/server.mjs
