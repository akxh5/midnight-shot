# Deployment Log — Midnight Preview Network

This document records the deployment of the `mn-demo` hello-world contract
to the **Midnight Preview** testnet as part of the Rise In Level 1 challenge.

---

## Deployed Contract

| Field | Value |
|---|---|
| **Network** | Midnight Preview |
| **Contract Address** | `1e773bbc8d2e7a6af104d1ade8f3a2bd32fb4d5b2cc507c5f38ca43dfe861751` |
| **Circuit** | `storeMessage` |
| **Compiler** | Compact `0.31.1` |
| **Node.js** | v24.7.0 |
| **Deploy Command** | `npm run setup -- --network preview` |

---

## Prerequisites Used

- **Compact toolchain**: installed via `curl` installer from GitHub releases
- **Proof server**: `midnightnetwork/proof-server` Docker image (local, port 6300)
- **Funding**: tNIGHT received from the Preview faucet

---

## Deploy Steps

### 1. Install Compact compiler
```bash
curl --proto '=https' --tlsv1.2 -LsSf \
  https://github.com/midnightntwrk/compact/releases/latest/download/compact-installer.sh | sh
export PATH="$HOME/.local/bin:$PATH"
compact update          # installs compactc 0.31.1 and sets as default
compact --version       # compact 0.5.1
```

### 2. Pull and start the proof server
```bash
docker pull midnightnetwork/proof-server
docker run -d -p 6300:6300 --name proof-server midnightnetwork/proof-server
```

### 3. Install dependencies
```bash
npm install
```

### 4. Deploy to Preview
```bash
NODE_OPTIONS="--max-old-space-size=12288" npm run setup -- --network preview
```

**What happened:**
1. Script printed the wallet address and the Preview faucet URL
2. Funded the wallet with tNIGHT at the faucet
3. Script polled balance every 10s and continued automatically once funded
4. Contract was compiled (`contracts/hello-world.compact → contracts/managed/hello-world/`)
5. ZK proof generated and transaction submitted
6. Contract address printed: `1e773bbc8d2e7a6af104d1ade8f3a2bd32fb4d5b2cc507c5f38ca43dfe861751`

---

## Verification

The contract can be verified on the Midnight Preview indexer:

- **Indexer GraphQL**: `https://indexer.preview.midnight.network`  
- Search by contract address: `1e773bbc8d2e7a6af104d1ade8f3a2bd32fb4d5b2cc507c5f38ca43dfe861751`

---

## Screenshot

See [deploy mn.png](./deploy%20mn.png) for the full terminal output of the deployment.
