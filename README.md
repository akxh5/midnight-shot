# Midnight Drop

> A cryptographic whistleblower platform utilizing zero-knowledge proofs.

## Live Demo

[PASTE LIVE URL AFTER DEPLOYING FRONTEND]

## Contract Address

| Network  | Address                          |
|----------|----------------------------------|
| Preprod  | `1e773bbc8d2e7a6af104d1ade8f3a2bd32fb4d5b2cc507c5f38ca43dfe861751` |

---

## What This Does

A decentralized platform allowing users to verify document authenticity and organizational access without revealing user identity or raw document content.

---

## Privacy Model

- **What is PUBLIC:** The verification status and access tier.
- **What is PRIVATE:** The user's identity and the raw document data.
- **What the user PROVES without revealing:** That they possess a valid organizational credential and the document matches the cryptographic hash.

---

## Privacy Claim

On-chain observers can see that a valid disclosure was submitted and verified by the circuit, but it is mathematically impossible to reconstruct the original document or identify the submitter from the ledger state.

---

## Tech Stack

Midnight network, Compact, Midnight.js SDK, React/Vite, Lace wallet

---

## Prerequisites

- Lace wallet installed
- Node.js v22

---

## Run Locally

### 1. Clone the Repository
```bash
git clone https://github.com/akxh5/midnight-shot.git
cd midnight-shot
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Run Development Server
```bash
npm run dev
```

### 4. Build for Production
```bash
npm run vite-build
```

---

## Demo Video

[PLACEHOLDER — I will add the link after recording]
