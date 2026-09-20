/**
 * Witness provider for disclosure.compact.
 *
 * The `disclosureSecret` witness must NEVER return a bare hash of the raw
 * message — that would be brute-forceable by anyone hashing guessed
 * messages and checking membership against the public `commitments` set.
 * Instead it returns H(message || nonce): a random 32-byte nonce, generated
 * fresh per disclosure, salts the commitment so it can't be dictionary-attacked.
 *
 * The nonce is the one piece of information a caller needs to later prove
 * authorship of a past disclosure (alongside the original message text,
 * which this module never persists — only the salted secret and nonce are
 * kept, in the contract's private state, via the private state provider).
 * Private state is encrypted at rest by the private state provider; nothing
 * here is ever written to localStorage.
 */

import * as rt from '@midnight-ntwrk/compact-runtime';
import type { Witnesses } from '../contracts/managed/disclosure/contract/index.js';
import type { Ledger } from '../contracts/managed/disclosure/contract/index.js';

export interface DisclosureRecord {
  /** hex-encoded on-chain commitment: persistentHash(domain, secret) */
  commitmentHex: string;
  /** hex-encoded random 32-byte salt used for this disclosure */
  nonceHex: string;
  /** hex-encoded H(message || nonce) — the witness's return value */
  secretHex: string;
  submittedAt: string;
}

export interface DisclosurePrivateState {
  disclosures: DisclosureRecord[];
}

export const EMPTY_DISCLOSURE_PRIVATE_STATE: DisclosurePrivateState = { disclosures: [] };

// Must byte-for-byte match `pad(32, "disclosure:commit:")` as compiled into
// contracts/managed/disclosure/contract/index.js (_persistentHash_0's first
// argument) — copied directly from the compiler's own output rather than
// re-implementing Compact's `pad()` semantics by hand.
const DOMAIN_TAG = new Uint8Array([
  100, 105, 115, 99, 108, 111, 115, 117, 114, 101, 58, 99, 111, 109, 109, 105, 116, 58, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0,
]);

const COMMITMENT_DESCRIPTOR = new rt.CompactTypeVector(2, new rt.CompactTypeBytes(32));

function toHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex');
}

/** The exact on-chain commitment persistentHash(domain, secret) will produce for `secret`. */
export function computeCommitment(secret: Uint8Array): Uint8Array {
  return rt.persistentHash(COMMITMENT_DESCRIPTOR, [DOMAIN_TAG, secret]);
}

/** H(message || nonce) — never a bare hash of the message alone. */
async function saltedSecret(message: string, nonce: Uint8Array): Promise<Uint8Array> {
  const messageBytes = new TextEncoder().encode(message);
  const combined = new Uint8Array(messageBytes.length + nonce.length);
  combined.set(messageBytes, 0);
  combined.set(nonce, messageBytes.length);
  const digest = await crypto.subtle.digest('SHA-256', combined);
  return new Uint8Array(digest);
}

/** Builds a fresh salted secret + the record to persist for a new disclosure. */
export async function prepareSubmission(message: string): Promise<{ secret: Uint8Array; record: DisclosureRecord }> {
  const nonce = crypto.getRandomValues(new Uint8Array(32));
  const secret = await saltedSecret(message, nonce);
  const commitment = computeCommitment(secret);
  return {
    secret,
    record: {
      commitmentHex: toHex(commitment),
      nonceHex: toHex(nonce),
      secretHex: toHex(secret),
      submittedAt: new Date().toISOString(),
    },
  };
}

// ── Pending-call handoff ────────────────────────────────────────────────────
//
// The compiled circuit's `disclosureSecret` witness takes no arguments (per
// disclosure.compact) and must return synchronously, but the salted secret
// above is computed asynchronously (crypto.subtle.digest). So the secret for
// the *next* circuit call is computed ahead of time and handed to the witness
// through this module-level slot, set immediately before invoking
// `contractInstance.callTx.submitDisclosure()` / `.proveAuthorship()`.

type PendingCall =
  | { kind: 'submit'; secret: Uint8Array; record: DisclosureRecord }
  | { kind: 'prove'; secret: Uint8Array };

let pending: PendingCall | null = null;

export function setPendingSubmit(secret: Uint8Array, record: DisclosureRecord): void {
  pending = { kind: 'submit', secret, record };
}

export function setPendingProve(secret: Uint8Array): void {
  pending = { kind: 'prove', secret };
}

export function makeDisclosureWitnesses(): Witnesses<DisclosurePrivateState> {
  return {
    disclosureSecret: (
      context: rt.WitnessContext<Ledger, DisclosurePrivateState>,
    ): [DisclosurePrivateState, Uint8Array] => {
      const call = pending;
      pending = null;
      if (!call) {
        throw new Error(
          'disclosureSecret witness invoked with no pending call queued — call setPendingSubmit/setPendingProve first.',
        );
      }
      const current = context.privateState ?? EMPTY_DISCLOSURE_PRIVATE_STATE;
      if (call.kind === 'submit') {
        return [{ disclosures: [...current.disclosures, call.record] }, call.secret];
      }
      // proveAuthorship — read-only replay of a previously persisted secret;
      // private state passes through unchanged.
      return [current, call.secret];
    },
  };
}
