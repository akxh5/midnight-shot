#!/usr/bin/env bash
# ============================================================
# check-deploy.sh — Verify the deployed contract is reachable
# on a Midnight network (Preview by default).
#
# Usage:
#   ./scripts/check-deploy.sh                  # reads from .midnight-state.json
#   ./scripts/check-deploy.sh <contract-addr>  # explicit address
#
# Requirements: curl, jq (optional for pretty print)
# ============================================================

set -euo pipefail

NETWORK="${MIDNIGHT_NETWORK:-preview}"
STATE_FILE=".midnight-state.json"

# ── Resolve contract address ─────────────────────────────────
if [[ $# -ge 1 ]]; then
  CONTRACT_ADDRESS="$1"
else
  if [[ ! -f "$STATE_FILE" ]]; then
    # Fallback to the known Preview address from DEPLOYMENT.md
    CONTRACT_ADDRESS="1e773bbc8d2e7a6af104d1ade8f3a2bd32fb4d5b2cc507c5f38ca43dfe861751"
    echo "⚠️  .midnight-state.json not found — using hardcoded Preview address."
  else
    CONTRACT_ADDRESS=$(node -e "
      const s = JSON.parse(require('fs').readFileSync('$STATE_FILE','utf8'));
      const addr = s?.deployments?.['$NETWORK']?.contractAddress;
      if (!addr) { console.error('No deployment found for network: $NETWORK'); process.exit(1); }
      console.log(addr);
    " 2>&1)
  fi
fi

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  Midnight Deployment Check                                   ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "  Network  : $NETWORK"
echo "  Address  : $CONTRACT_ADDRESS"
echo ""

# ── Indexer endpoint ─────────────────────────────────────────
case "$NETWORK" in
  preview)   INDEXER="https://indexer.preview.midnight.network/api/v1/graphql" ;;
  preprod)   INDEXER="https://indexer.preprod.midnight.network/api/v1/graphql" ;;
  *)         echo "❌ Unknown network: $NETWORK"; exit 1 ;;
esac

# ── GraphQL query ────────────────────────────────────────────
QUERY=$(cat <<EOF
{"query":"{ contract(address: \"$CONTRACT_ADDRESS\") { address } }"}
EOF
)

echo "  Querying indexer..."
RESPONSE=$(curl -sf -X POST "$INDEXER" \
  -H 'Content-Type: application/json' \
  -d "$QUERY" \
  --max-time 15 2>&1) || {
  echo "  ❌ Could not reach indexer at $INDEXER"
  echo "     Check your network connection or try again later."
  exit 1
}

if command -v jq &>/dev/null; then
  echo "$RESPONSE" | jq .
else
  echo "$RESPONSE"
fi

if echo "$RESPONSE" | grep -q "\"address\""; then
  echo ""
  echo "  ✅ Contract is live on $NETWORK!"
else
  echo ""
  echo "  ⚠️  Contract address not found in indexer response."
  echo "     It may still be indexing. Try again in a few seconds."
fi

echo ""
