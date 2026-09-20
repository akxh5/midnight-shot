/**
 * disclosure.test.ts
 *
 * Real tests against the compiled disclosure.compact contract — not a
 * hand-written reimplementation. These run the actual generated
 * `contracts/managed/disclosure/contract/index.js` through
 * @midnight-ntwrk/compact-runtime's pure (no-proof) execution path, the
 * same runtime the deployed contract executes against.
 *
 * Contract shape under test:
 *   witness disclosureSecret(): Bytes<32>                     — private
 *   export ledger commitments: Set<Bytes<32>>                 — public
 *   export ledger disclosureCount: Counter                    — public
 *   export circuit submitDisclosure(): []                     — writes a commitment
 *   export circuit proveAuthorship(): Boolean                 — proves preimage knowledge
 *
 * Covers:
 *   a) circuit logic is correct
 *   b) ledger state transitions as expected
 *   c) the private witness value never appears in any ledger state or
 *      circuit output — asserted explicitly
 */

import * as rt from '@midnight-ntwrk/compact-runtime';
import { sampleCoinPublicKey } from '@midnight-ntwrk/ledger-v8';
import { Contract, ledger, type Ledger } from '../contracts/managed/disclosure/contract/index.js';

// A validly-formatted CoinPublicKey (hex-encoded 35-byte string), sampled
// once for reproducible local (non-network) testing.
const COIN_PUBLIC_KEY = sampleCoinPublicKey();

type PrivateState = Record<string, never>;

function bytes32(fill: number): Uint8Array {
  const b = new Uint8Array(32);
  b.fill(fill);
  return b;
}

function hex(b: Uint8Array): string {
  return Buffer.from(b).toString('hex');
}

// Witnesses object required by the Contract constructor. Returns whatever
// secret the test asked for, unmodified private state (we don't use any).
function witnessesFor(secret: Uint8Array) {
  return {
    disclosureSecret: (_context: rt.WitnessContext<Ledger, PrivateState>): [PrivateState, Uint8Array] => {
      return [{}, secret];
    },
  };
}

function deploy(secret: Uint8Array) {
  const contract = new Contract(witnessesFor(secret));
  const constructorContext = rt.createConstructorContext<PrivateState>({}, COIN_PUBLIC_KEY);
  const init = contract.initialState(constructorContext);
  return { contract, contractState: init.currentContractState, privateState: init.currentPrivateState };
}

function call(
  contract: Contract<PrivateState>,
  contractState: rt.ContractState,
  privateState: PrivateState,
  circuit: 'submitDisclosure' | 'proveAuthorship',
) {
  const circuitContext = rt.createCircuitContext<PrivateState>(
    rt.dummyContractAddress(),
    COIN_PUBLIC_KEY,
    contractState.data,
    privateState,
  );
  const callResult = contract.circuits[circuit](circuitContext);
  const nextContractState = new rt.ContractState();
  nextContractState.data = new rt.ChargedState(callResult.context.currentQueryContext.state.state);
  return {
    result: callResult.result,
    contractState: nextContractState,
    privateState: callResult.context.currentPrivateState as PrivateState,
    proofData: callResult.proofData,
  };
}

function readLedger(contractState: rt.ContractState): Ledger {
  return ledger(contractState.data);
}

function commitmentsOf(l: Ledger): string[] {
  return Array.from(l.commitments).map(hex);
}

// ── (a) Circuit logic is correct ────────────────────────────────────────────

describe('disclosure contract — circuit logic', () => {
  test('submitDisclosure inserts a commitment derived from the witness, not the witness itself', () => {
    const secret = bytes32(0xaa);
    const { contract, contractState, privateState } = deploy(secret);

    const after = call(contract, contractState, privateState, 'submitDisclosure');
    const l = readLedger(after.contractState);

    expect(l.commitments.size()).toBe(1n);
    const [committed] = commitmentsOf(l);
    expect(committed).not.toBe(hex(secret)); // it's a hash, not the raw secret
    expect(committed).toHaveLength(64); // 32 bytes, hex-encoded
  });

  test('proveAuthorship returns true for a secret already submitted, false otherwise', () => {
    const secretA = bytes32(0x01);
    const secretB = bytes32(0x02);

    const { contract, contractState, privateState } = deploy(secretA);
    const afterSubmit = call(contract, contractState, privateState, 'submitDisclosure');

    // Same secret -> knows the preimage of a commitment already in the ledger.
    const proveWithA = call(
      new Contract(witnessesFor(secretA)),
      afterSubmit.contractState,
      afterSubmit.privateState,
      'proveAuthorship',
    );
    expect(proveWithA.result).toBe(true);

    // Different secret -> does not know a preimage that's in the ledger.
    const proveWithB = call(
      new Contract(witnessesFor(secretB)),
      afterSubmit.contractState,
      afterSubmit.privateState,
      'proveAuthorship',
    );
    expect(proveWithB.result).toBe(false);
  });

  test('proveAuthorship does not write to the ledger (read-only proof)', () => {
    const secretA = bytes32(0x01);
    const { contract, contractState, privateState } = deploy(secretA);
    const afterSubmit = call(contract, contractState, privateState, 'submitDisclosure');
    const before = readLedger(afterSubmit.contractState);

    const afterProve = call(
      new Contract(witnessesFor(secretA)),
      afterSubmit.contractState,
      afterSubmit.privateState,
      'proveAuthorship',
    );
    const after = readLedger(afterProve.contractState);

    expect(after.commitments.size()).toBe(before.commitments.size());
    expect(after.disclosureCount).toBe(before.disclosureCount);
  });
});

// ── (b) Ledger state transitions as expected ────────────────────────────────

describe('disclosure contract — ledger state transitions', () => {
  test('initial state is empty: no commitments, counter at 0', () => {
    const { contractState } = deploy(bytes32(0x03));
    const l = readLedger(contractState);

    expect(l.commitments.size()).toBe(0n);
    expect(l.commitments.isEmpty()).toBe(true);
    expect(l.disclosureCount).toBe(0n);
  });

  test('each submitDisclosure with a distinct secret grows the set and the counter together', () => {
    const secrets = [bytes32(0x10), bytes32(0x20), bytes32(0x30)];
    let contract = new Contract(witnessesFor(secrets[0]));
    let { contractState, privateState } = deploy(secrets[0]);

    secrets.forEach((secret, i) => {
      contract = new Contract(witnessesFor(secret));
      const next = call(contract, contractState, privateState, 'submitDisclosure');
      contractState = next.contractState;
      privateState = next.privateState;

      const l = readLedger(contractState);
      expect(l.commitments.size()).toBe(BigInt(i + 1));
      expect(l.disclosureCount).toBe(BigInt(i + 1));
    });
  });

  test('submitting the same secret twice increments the counter but not the set size', () => {
    const secret = bytes32(0x42);
    const { contract, contractState, privateState } = deploy(secret);

    const first = call(contract, contractState, privateState, 'submitDisclosure');
    const second = call(
      new Contract(witnessesFor(secret)),
      first.contractState,
      first.privateState,
      'submitDisclosure',
    );

    const l = readLedger(second.contractState);
    expect(l.commitments.size()).toBe(1n); // Set — duplicate commitment collapses
    expect(l.disclosureCount).toBe(2n); // Counter — every submission still counts
  });

  test('distinct secrets always produce distinct commitments', () => {
    const secret1 = bytes32(0x51);
    const secret2 = bytes32(0x52);
    const { contract, contractState, privateState } = deploy(secret1);

    const afterFirst = call(contract, contractState, privateState, 'submitDisclosure');
    const afterSecond = call(
      new Contract(witnessesFor(secret2)),
      afterFirst.contractState,
      afterFirst.privateState,
      'submitDisclosure',
    );

    const commitments = commitmentsOf(readLedger(afterSecond.contractState));
    expect(commitments).toHaveLength(2);
    expect(new Set(commitments).size).toBe(2); // no collision
  });
});

// ── (c) The private witness value never leaks ───────────────────────────────

describe('disclosure contract — privacy: witness value never leaks', () => {
  test('the raw secret bytes do not appear anywhere in the serialized ledger state', () => {
    const secret = bytes32(0x99);
    const secretHex = hex(secret);
    const { contract, contractState, privateState } = deploy(secret);

    const after = call(contract, contractState, privateState, 'submitDisclosure');

    // Full serialized on-chain state, as it would actually be committed.
    const serialized = Buffer.from(after.contractState.serialize()).toString('hex');
    expect(serialized).not.toContain(secretHex);

    // The commitment IS present (proves the write happened; this isn't
    // trivially passing because nothing was ever stored).
    const l = readLedger(after.contractState);
    const [committed] = commitmentsOf(l);
    expect(serialized).toContain(committed);
  });

  test('no ledger field equals or contains the raw secret', () => {
    const secret = bytes32(0x77);
    const secretHex = hex(secret);
    const { contract, contractState, privateState } = deploy(secret);

    const after = call(contract, contractState, privateState, 'submitDisclosure');
    const l = readLedger(after.contractState);

    for (const committed of commitmentsOf(l)) {
      expect(committed).not.toBe(secretHex);
    }
    expect(String(l.disclosureCount)).not.toContain(secretHex);
  });

  test('circuit call outputs (result + public proof transcript) never contain the raw secret', () => {
    const secret = bytes32(0x88);
    const secretHex = hex(secret);
    const { contract, contractState, privateState } = deploy(secret);

    const submitResult = call(contract, contractState, privateState, 'submitDisclosure');
    // submitDisclosure returns [] — nothing to leak through the return value.
    expect(submitResult.result).toEqual([]);
    const submitTranscript = JSON.stringify(submitResult.proofData.publicTranscript, (_k, v) =>
      typeof v === 'bigint' ? v.toString() : v,
    );
    expect(submitTranscript).not.toContain(secretHex);

    const proveResult = call(
      new Contract(witnessesFor(secret)),
      submitResult.contractState,
      submitResult.privateState,
      'proveAuthorship',
    );
    // proveAuthorship returns only a Boolean — never the secret or the commitment.
    expect(typeof proveResult.result).toBe('boolean');
    const proveTranscript = JSON.stringify(proveResult.proofData.publicTranscript, (_k, v) =>
      typeof v === 'bigint' ? v.toString() : v,
    );
    expect(proveTranscript).not.toContain(secretHex);
  });

  test('the witness function is the only place the secret is read from, and it never writes it to private state', () => {
    const secret = bytes32(0x66);
    let witnessCalls = 0;
    const contract = new Contract({
      disclosureSecret: (context: rt.WitnessContext<Ledger, PrivateState>): [PrivateState, Uint8Array] => {
        witnessCalls += 1;
        // Confirms the witness receives (and can return) private state
        // untouched — nothing about the secret is folded into it.
        return [context.privateState, secret];
      },
    });
    const constructorContext = rt.createConstructorContext<PrivateState>({}, COIN_PUBLIC_KEY);
    const init = contract.initialState(constructorContext);

    const after = call(contract, init.currentContractState, init.currentPrivateState, 'submitDisclosure');

    expect(witnessCalls).toBe(1);
    expect(after.privateState).toEqual({}); // private state carries no trace of the secret
  });
});
