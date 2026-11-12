#!/usr/bin/env bash
# SwarmSettle — NEAR Testnet Deployment & Live On-Chain Run Script
# Builds the Rust contract, deploys to NEAR Testnet, writes app/.env.local,
# and executes the live agent workflow to produce proof/testnet-run.json.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [ ! -f .env ]; then
  echo "Error: .env file not found. Copy .env.example to .env and fill in your NEAR Testnet account IDs and keys."
  exit 1
fi

set -a
source .env
set +a

: "${NEAR_CONTRACT_ID:?Missing NEAR_CONTRACT_ID in .env}"
: "${CUSTOMER_ACCOUNT_ID:?Missing CUSTOMER_ACCOUNT_ID in .env}"

echo "[1/4] Running Rust contract unit tests (cargo test)..."
(cd contract && cargo test)

echo "[2/4] Building WASM contract (cargo near build)..."
(cd contract && cargo near build)

WASM_PATH=$(find contract/target -name "*.wasm" | head -n 1)
if [ -z "$WASM_PATH" ]; then
  echo "Error: Compiled WASM file not found in contract/target"
  exit 1
fi

echo "[3/4] Deploying $WASM_PATH to $NEAR_CONTRACT_ID on NEAR Testnet..."
near deploy "$NEAR_CONTRACT_ID" "$WASM_PATH" --initFunction new --initArgs '{}' --networkId testnet || \
  near deploy "$NEAR_CONTRACT_ID" "$WASM_PATH" --networkId testnet

cat > app/.env.local << ENVEOF
VITE_NEAR_NETWORK=testnet
VITE_NEAR_RPC_URL=${NEAR_RPC_URL:-https://rpc.testnet.near.org}
VITE_NEAR_CONTRACT_ID=${NEAR_CONTRACT_ID}
VITE_NEAR_WALLET_URL=https://testnet.mynearwallet.com
VITE_NEAR_EXPLORER_URL=https://testnet.nearblocks.io
VITE_DEFAULT_LIVE=true
ENVEOF

mkdir -p proof
echo "[4/4] Running live Testnet workflow and saving transaction hashes to proof/testnet-run.json..."
node agents/agent-runner.mjs --live --out proof/testnet-run.json
echo "Done! Inspect proof/testnet-run.json and start the frontend with: cd app && npm install && npm run dev"
