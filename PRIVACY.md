# Privacy Architecture — mn-demo

This document explains the privacy model of each Midnight contract in this
repo, covering what data lives where, how zero-knowledge proofs enforce it,
and the tradeoffs each design makes. Two contracts are covered:

- `contracts/disclosure.compact` — the live Level 2 contract. Full privacy
  properties: commitments only, salted, never a bare hash of the message.
- `examples/hello-world/hello-world.compact` — the Level 1 contract, kept for
  history. **No privacy properties** — it stores the message in plaintext on
  the public ledger. It is not deployed by this app and is not referenced by
  `src/hooks/useMidnight.ts`.

---

## The Three Contexts of a Midnight Contract

Every Midnight dApp operates across three distinct execution contexts:

| Context | Where it runs | Who sees it |
|---|---|---|
| **Public Ledger** | On-chain | Everyone |
| **ZK Circuit** | Inside the proof | Verifier sees only proof outputs |
| **Local / Off-chain (Witness)** | Prover's machine | Prover only |

The key Midnight primitive is `disclose()` — it is the **explicit gateway** between
private computation and public output. Nothing becomes public unless you call `disclose()`.

---

## `disclosure.compact` (live contract)

```compact
export ledger commitments: Set<Bytes<32>>;
export ledger disclosureCount: Counter;

witness disclosureSecret(): Bytes<32>;

export circuit submitDisclosure(): [] {
    const secret = disclosureSecret();
    const commitment = persistentHash<Vector<2, Bytes<32>>>([pad(32, "disclosure:commit:"), secret]);
    commitments.insert(disclose(commitment));
    disclosureCount.increment(1);
}

export circuit proveAuthorship(): Boolean {
    const secret = disclosureSecret();
    const commitment = persistentHash<Vector<2, Bytes<32>>>([pad(32, "disclosure:commit:"), secret]);
    return commitments.member(disclose(commitment));
}
```

**Privacy guarantee: full.** No plaintext field exists anywhere in this
contract's ledger. `disclose()` is applied only to the derived commitment —
never to `disclosureSecret()`'s return value.

**The witness itself is salted before it ever reaches the circuit.** The
witness provider (`src/disclosure-witnesses.ts`) computes
`H(message || nonce)` — a random 32-byte nonce, generated fresh per
disclosure, client-side — and it is *that* salted value, not a bare hash of
the message, that `disclosureSecret()` returns. A bare `H(message)` would be
brute-forceable: anyone could hash a list of guessed messages and check the
result against the public `commitments` set. Salting defeats that. The nonce
and the salted secret are persisted in this browser's encrypted private state
(via the Midnight private state provider) — never in `localStorage`, never
on-chain — so the discloser can reconstruct the same secret later to call
`proveAuthorship`.

**`.member()` needing `disclose()` is not a special case — it's the same rule
as `.insert()`.** The Compact compiler treats any ledger operation that could
disclose a hash of a witness value as requiring `disclose()`, whether it's a
write (`insert`) or a read (`member`). Checking membership necessarily reveals
*which* commitment is being checked, so the compiler makes you say so
explicitly, exactly as it does for a ledger write.

**Two disclosures this design makes on purpose, worth naming:**
1. `proveAuthorship()` reveals *which* commitment the caller is claiming.
   Calling it from a connected wallet links that commitment to that wallet
   address — intentionally, since the whole point of the circuit is to let
   someone claim authorship of a specific past disclosure.
2. `disclosureCount` can exceed `commitments.size()`. Since `commitments` is a
   `Set`, re-inserting an existing commitment is a no-op for its membership,
   but `disclosureCount` increments unconditionally on every call. The gap
   between the two numbers is a public, observable signal that some secret
   was submitted more than once — without revealing which one.

---

## `hello-world.compact` (`examples/hello-world/`, Level 1, historical)

```compact
export ledger message: Opaque<"string">;  // PUBLIC on-chain, PLAINTEXT

export circuit storeMessage(customMessage: Opaque<"string">): [] {
    message = disclose(customMessage);    // discloses the raw input directly
}
```

**Privacy guarantee: none (intentional, for this contract).** `customMessage`
is a public circuit parameter, not a witness — the caller passes it openly,
and `disclose()` here is only satisfying the compiler's requirement to mark
the ledger write explicit; it isn't concealing anything, because there was
never anything private to conceal. Anyone querying the indexer for this
contract's state gets the exact message text back. This is a "hello world"
exercise in the mechanics of `disclose()`, not a privacy-preserving pattern,
and it is not deployed or used anywhere in the live app.

---

## Summary

| Property | `disclosure.compact` (live) | `hello-world.compact` (`examples/`) |
|---|---|---|
| Input visibility | Private (witness, salted) | Public (parameter) |
| Output visibility | Commitment only | Full plaintext |
| Privacy guarantee | Full | None (intentional, historical only) |
| Use case | Whistleblower disclosure (Level 2) | Language mechanics demo (Level 1) |
