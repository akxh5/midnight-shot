# Deployment Log

This document records deployment status for `mn-demo`'s contracts across both
Rise In Builder Challenge levels. The two levels use **different contracts on
different networks** — do not conflate their addresses.

---

## Level 2 — `disclosure.compact` — Preprod

**Status: not yet deployed.**

The contract is written, compiled, and tested locally (`npm run compile`,
`npm test` — see `tests/disclosure.test.ts`, 11 passing tests run against the
actual compiled contract via `@midnight-ntwrk/compact-runtime`). It has not
been submitted to the Preprod network yet: deployment requires a local proof
server, which requires Docker, and Docker was not available in the
environment this contract and its frontend rewire were built in.

| Field | Value |
|---|---|
| **Network** | Midnight **Preprod** |
| **Contract** | `contracts/disclosure.compact` |
| **Circuits** | `submitDisclosure`, `proveAuthorship` |
| **Compiler** | Compact `0.31.1` (language version `0.23.0`) |
| **Contract Address** | *pending — not deployed* |

### To deploy once Docker is available

```bash
# 1. Start Docker Desktop (or any OCI-compatible runtime providing `docker`)

# 2. Point the deploy scripts at Preprod
npm run network preprod

# 3. Bring up the local proof server, compile, and deploy
NODE_OPTIONS="--max-old-space-size=12288" npm run setup -- --network preprod
```

This runs, in order: `docker compose up -d --wait` (proof server only — Preprod
uses the real remote node and indexer, not the local devnet ones),
`npm run compile` (`contracts/disclosure.compact` → `contracts/managed/disclosure/`),
then `npm run deploy -- --network preprod`, which funds the wallet from the
Preprod faucet if needed, registers for DUST, and submits the constructor
transaction.

**After a successful deploy, three files need the resulting address filled in** —
grep for the placeholder to find every spot:

```bash
grep -rn "PENDING DEPLOYMENT\|TODO_PENDING_PREPROD_DEPLOYMENT" README.md DEPLOYMENT.md src/hooks/useMidnight.ts
```

That's `README.md`'s Contract Address table, this file's table above, and
`PREPROD_CONTRACT_ADDRESS` in `src/hooks/useMidnight.ts`. Also copy the freshly
compiled `contracts/managed/disclosure/*` into `public/managed/disclosure/`
(the browser's `FetchZkConfigProvider` reads ZK artifacts from `public/`, not
from `contracts/`) if `npm run compile` produced anything new.

### Verification (once deployed)

- **Indexer GraphQL**: `https://indexer.preprod.midnight.network/api/v4/graphql`
- Search by contract address once one exists above.

---

## Level 1 — `hello-world.compact` — Preview (historical, preserved under `examples/`)

This is the original Rise In Level 1 submission. It is **not** the contract
this app runs against anymore — it stored a plaintext message on the public
ledger with no privacy properties (see `examples/hello-world/hello-world.compact`'s
header comment, and `PRIVACY.md`, which now documents this contract
specifically). It is kept for history, not deleted.

| Field | Value |
|---|---|
| **Network** | Midnight **Preview** (not Preprod — this table previously and incorrectly listed Preprod for this deployment; it was always Preview) |
| **Contract Address** | `1e773bbc8d2e7a6af104d1ade8f3a2bd32fb4d5b2cc507c5f38ca43dfe861751` |
| **Circuit** | `storeMessage` |
| **Compiler** | Compact `0.31.1` |
| **Node.js** | v24.7.0 |
| **Deploy Command** | `npm run setup -- --network preview` |

Note on the address format: this is a 64-hex-character (32-byte) value with no
network/type prefix. A real Preprod (or Preview) explorer address is 68 hex
characters — a 2-byte type/network tag followed by the 32-byte hash. This
address is missing that prefix, so it cannot be looked up on an explorer as
written; it is preserved here verbatim as a historical record of what the
Level 1 deploy script printed, not as a corrected, explorer-ready address.

### Original deploy steps (Preview, historical)

```bash
curl --proto '=https' --tlsv1.2 -LsSf \
  https://github.com/midnightntwrk/compact/releases/latest/download/compact-installer.sh | sh
export PATH="$HOME/.local/bin:$PATH"
compact update
docker pull midnightnetwork/proof-server
docker run -d -p 6300:6300 --name proof-server midnightnetwork/proof-server
npm install
NODE_OPTIONS="--max-old-space-size=12288" npm run setup -- --network preview
```

See [deploy mn.png](./deploy%20mn.png) for the original terminal output.
