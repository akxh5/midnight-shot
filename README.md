# mn-demo — Midnight Hello World

> A hello-world smart contract on the Midnight Network that stores a message on the public ledger, demonstrating how `disclose()` explicitly gates what data becomes visible on-chain.

## Contract Address

| Network | Address |
|---------|---------|
| Preview | `1e773bbc8d2e7a6af104d1ade8f3a2bd32fb4d5b2cc507c5f38ca43dfe861751` |

---

## What This Does

The contract (`contracts/hello-world.compact`) has a single public ledger field called `message` and one circuit called `storeMessage`. When a user calls `storeMessage("Hello, Midnight!")`, the message is written directly to the on-chain ledger and is visible to anyone reading the blockchain via the Midnight indexer.

The key Midnight primitive demonstrated here is **`disclose()`**: even for a fully public value, the Compact compiler requires you to explicitly call `disclose(customMessage)` before assigning it to ledger state. This is intentional — it forces every developer to consciously declare which values leave the privacy boundary. Nothing becomes on-chain by accident.

```compact
export ledger message: Opaque<"string">;

export circuit storeMessage(customMessage: Opaque<"string">): [] {
    message = disclose(customMessage);   // explicit public declaration
}
```

---

## Privacy Model

- **What is PUBLIC (on-chain, visible to anyone):**
  - `message` — the string stored on the ledger. Readable by anyone via the Midnight indexer GraphQL API. Updated every time `storeMessage` is called.

- **What is PRIVATE (private witness, never on-chain):**
  - Nothing in this hello-world contract — `customMessage` is a **public circuit parameter**, not a private witness. The contract intentionally makes everything public as a starting demonstration.

- **What `disclose()` does here:**
  - `disclose(customMessage)` is used deliberately to satisfy the Compact compiler's privacy enforcement. It is the explicit gateway between circuit computation and public ledger state. Without it, the compiler rejects any ledger write — even of a public parameter — because it cannot distinguish intentional disclosure from accidental leakage.
  - In future contracts (e.g., a ZK whitelist or land registry), you would replace the public `customMessage` parameter with a `witness()` call, and use `disclose()` only on derived commitment values — keeping the raw input fully private.

---

## Tech Stack

- **Midnight Network** — privacy-first L1 blockchain
- **Compact Language** — ZK-native smart contract language (compiled to zkIR)
- **Node.js v22** — runtime for dApp and deployment scripts
- **Docker** — local devnet (node + indexer + proof-server via `docker-compose.yml`)
- **TypeScript** — all scripting, deployment, and CLI tooling

---

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Node.js | v22+ | [nodejs.org](https://nodejs.org) |
| Docker | Latest + Compose v2 | [docker.com](https://docker.com) |
| Compact toolchain | v0.31.1 | See Setup below |

---

## Setup

```bash
# 1. Clone the repo
git clone https://github.com/akxh5/midnight-shot.git
cd midnight-shot

# 2. Install the Compact compiler (one-time global install)
curl --proto '=https' --tlsv1.2 -LsSf \
  https://github.com/midnightntwrk/compact/releases/latest/download/compact-installer.sh | sh
export PATH="$HOME/.local/bin:$PATH"
compact update      # installs compactc 0.31.1 and sets it as default

# 3. Install npm dependencies
npm install

# 4. One-shot: start devnet, compile contract, deploy
npm run setup

# To deploy to Preview testnet instead:
npm run setup -- --network preview
# (Fund the wallet at the faucet URL printed by the script, then re-run if it times out)
```

---

## Run Tests

```bash
npm test
```

The test suite (`tests/hello-world.test.ts`) covers:
- **Circuit logic** — `storeMessage` updates ledger state correctly
- **State transitions** — message changes across multiple calls
- **Privacy model** — `disclose()` semantics and public output correctness

---

## Available Scripts

| Script | Description |
|---|---|
| `npm run setup` | One-shot: start devnet, compile, deploy |
| `npm run compile` | Compile `contracts/hello-world.compact` → `contracts/managed/hello-world/` |
| `npm run deploy` | Deploy (requires devnet up + compiled) |
| `npm run cli` | Interactive CLI to call circuits |
| `npm run check-balance` | Print NIGHT and DUST balances |
| `npm run test:e2e` | Smoke + read-back check against deployed contract |
| `npm run verify:deploy` | Query indexer to confirm contract is live |
| `npm run clean` | Remove compiled artifacts and state |

---

## Local Devnet

The project ships its own devnet via `docker-compose.yml`:

| Service | Port | Purpose |
|---|---|---|
| `node` | 9944 | Midnight node, `dev` chain preset |
| `indexer` | 8088 | GraphQL indexer for chain state |
| `proof-server` | 6300 | Generates ZK proofs for contract transactions |

Tear down with:
```bash
docker compose down -v
```

---

## Networks

| Network | When to use |
|---|---|
| `undeployed` | Local devnet (default). Genesis seed hardcoded, no funding needed. |
| `preview` | Public preview testnet. Faucet at `https://midnight-tmnight-preview.nethermind.dev` |
| `preprod` | Public preprod testnet. Faucet at `https://midnight-tmnight-preprod.nethermind.dev` |

---

## Project Structure

```
mn-demo/
├── contracts/
│   ├── hello-world.compact          # Compact smart contract source
│   └── managed/
│       └── hello-world/             # Auto-generated by: npm run compile
│           ├── compiler/            # Compiler metadata (contract-info.json)
│           ├── contract/            # TypeScript bindings (index.d.ts, index.js)
│           ├── keys/                # Proving & verifying keys (storeMessage.prover/verifier)
│           └── zkir/                # Compiled ZK IR files (storeMessage.zkir)
├── scripts/
│   ├── e2e-check.ts                 # End-to-end smoke test
│   └── check-deploy.sh              # Indexer verification helper
├── src/
│   ├── network.ts                   # Network selection + state management
│   ├── wallet.ts                    # Wallet construction + sync-state cache
│   ├── setup.ts                     # Orchestrator for npm run setup
│   ├── deploy.ts                    # Deploy the contract
│   ├── cli.ts                       # Interact with deployed contract
│   └── check-balance.ts             # NIGHT / DUST balance checker
├── tests/
│   └── hello-world.test.ts          # 9-test suite for circuit + privacy model
├── docker-compose.yml               # node + indexer + proof-server
├── PRIVACY.md                       # Deep dive: Midnight's three execution contexts
├── DEPLOYMENT.md                    # Step-by-step deploy log with contract address
├── package.json
└── tsconfig.json
```

---

## Initial Idea

This project was originally conceived as a foundation for a **Zero-Knowledge Whitelisting or Decentralized Land Registry** system on Midnight. The core insight is that real-world compliance and ownership verification requires two conflicting properties: the public needs to be able to verify that a participant *is* compliant or *does* own an asset, without the participant having to expose their private personal data or sensitive details on a public ledger.

Using Midnight's ZK-native Compact language, we can model a land registry where the **public ledger state** stores only a commitment (e.g., a hash or a merkle root of approved registrations) that proves compliance at scale — while the **private witness** holds the actual user data: their name, parcel coordinates, document hash, or government ID. A circuit then generates a proof that says "this user's data satisfies the registry rules" without ever writing that data on-chain. The `disclose()` primitive is used deliberately to surface only what the verifier *needs* — for example, a boolean flag or a parcel ID — while the sensitive inputs remain locked to the prover's machine. This model can extend to KYC whitelisting, DAO membership gating, or any scenario where compliance must be publicly provable but the underlying data must remain private.

---

## Screenshots

### Deployment Output — Preview Network

The screenshot below shows the successful `npm run setup -- --network preview` output, including the proof-server startup, contract compilation, wallet funding prompt, and the final deployed contract address on Midnight Preview.

![Midnight Preview Deployment](./deploy%20mn.png)

---

## Compact Compiler Version

To upgrade your local compiler:

```bash
compact update <version>
compact use <version>
```
