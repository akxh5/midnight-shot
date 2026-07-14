# Privacy Architecture — mn-demo

This document explains the privacy model of this Midnight contract in depth,
covering what data lives where, how zero-knowledge proofs enforce it, and
how this pattern extends to real-world use cases.

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

## This Contract's Privacy Choices

### hello-world.compact

```compact
export ledger message: Opaque<"string">;  // PUBLIC on-chain

export circuit storeMessage(customMessage: Opaque<"string">): [] {
    message = disclose(customMessage);    // EXPLICITLY made public
}
```

Here, `customMessage` is a **public circuit parameter** (not a witness), meaning the
caller passes it openly. `disclose()` is still required — it tells the compiler
and verifier: *"I am deliberately making this value part of the public proof output."*

This prevents accidental leakage: the compiler rejects any ledger write of a value that
could be witness-derived without an explicit `disclose()`.

---

## The Witness Pattern (Next Level)

To keep inputs private, replace public parameters with `witness` declarations:

```compact
// Private: the caller supplies this locally; it never touches the chain
witness secretValue(): Uint<64>;

export circuit increment(): [] {
  const v = secretValue();          // private — stays on prover's machine
  assert(v > 0, "must be positive");
  round.increment(disclose(v));     // disclose(v) = "I consent to publishing v"
}
```

The ZK proof guarantees:
- The prover knows a `v > 0`
- The ledger was updated correctly by `v`
- But the actual value of `v` is only public because `disclose(v)` was called

If you wanted to keep `v` hidden and only publish the *result*, you'd disclose
only the new counter value, not `v` itself.

---

## Future Direction: ZK Whitelisting / Land Registry

In a decentralized land registry built on this pattern:

```compact
witness applicantData(): Bytes<256>;  // name, parcel coords, doc hash — PRIVATE
witness govtKey(): Bytes<32>;         // approval authority key — PRIVATE

export ledger approvedParcels: Counter;    // PUBLIC: how many parcels approved
export ledger registryRoot: Bytes<32>;     // PUBLIC: Merkle root of approvals

export circuit registerParcel(): [] {
  const data = applicantData();          // never leaves prover
  const key  = govtKey();                // never leaves prover

  // Prove the data is valid without revealing it
  assert(isValidParcel(data), "invalid parcel data");
  assert(key == authorizedGovt, "unauthorized registrar");

  // Only publish a commitment (hash), not the raw data
  const commitment = hash(data);
  disclose(commitment);                  // commitment goes on-chain
  approvedParcels.increment(1);
}
```

Result: **anyone can verify a parcel is registered** (commitment is public),
but **the applicant's personal data never touches the blockchain**.

---

## Summary

| Property | This Contract | ZK Registry (future) |
|---|---|---|
| Input visibility | Public (parameter) | Private (witness) |
| Output visibility | Public (via disclose) | Commitment only |
| Privacy guarantee | None (intentional) | Full ZK |
| Use case | Hello world / demo | KYC, land title, whitelist |
