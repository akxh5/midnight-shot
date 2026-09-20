/**
 * hello-world.test.ts
 *
 * Test suite for the Midnight hello-world contract.
 *
 * The hello-world contract has one circuit: storeMessage(customMessage)
 * which writes a message to the public ledger state using disclose().
 *
 * Tests cover:
 *   1. Circuit logic  — storeMessage updates ledger state correctly
 *   2. State transitions — message changes from initial to new value
 *   3. Privacy model — disclose() marks values public; no private witnesses leak
 */

// ── Simulated ledger state ────────────────────────────────────────────────────
// (Mirrors what the Compact contract maintains on-chain)

type LedgerState = {
  message: string; // Public on-chain — visible to anyone via indexer
};

// ── Circuit simulators ────────────────────────────────────────────────────────

/**
 * Simulates the `storeMessage` circuit.
 *
 * In the real Compact contract:
 *   export circuit storeMessage(customMessage: Opaque<"string">): [] {
 *     message = disclose(customMessage);
 *   }
 *
 * `disclose()` is the explicit privacy gateway: it marks customMessage as a
 * public output of the ZK proof. Nothing becomes on-chain without disclose().
 * Here customMessage is a public circuit parameter (not a witness), so the
 * caller is deliberately making it public.
 */
function simulateStoreMessage(
  state: LedgerState,
  customMessage: string    // public circuit parameter — not a private witness
): { newState: LedgerState; publicOutputs: Record<string, unknown> } {
  // disclose() equivalent: customMessage is explicitly made public
  const disclosed = customMessage;

  return {
    newState: { message: disclosed },
    publicOutputs: {
      message: disclosed, // this is what appears in the proof public output
    },
  };
}

// ── Test Suite ────────────────────────────────────────────────────────────────

const INITIAL_STATE: LedgerState = { message: "" };

describe("hello-world Contract — Circuit Logic", () => {
  test("1. storeMessage writes the message to public ledger state", () => {
    const { newState } = simulateStoreMessage(INITIAL_STATE, "Hello, Midnight!");

    expect(newState.message).toBe("Hello, Midnight!");
  });

  test("2. storeMessage overwrites any previous message (last-write wins)", () => {
    let state = INITIAL_STATE;

    ({ newState: state } = simulateStoreMessage(state, "First message"));
    expect(state.message).toBe("First message");

    ({ newState: state } = simulateStoreMessage(state, "Second message"));
    expect(state.message).toBe("Second message");
  });

  test("3. storeMessage with an empty string clears the ledger state", () => {
    let state: LedgerState = { message: "existing content" };
    ({ newState: state } = simulateStoreMessage(state, ""));
    expect(state.message).toBe("");
  });
});

describe("hello-world Contract — State Transitions", () => {
  test("4. Initial state has empty message before any circuit call", () => {
    expect(INITIAL_STATE.message).toBe("");
  });

  test("5. Message transitions correctly across multiple calls", () => {
    const messages = ["Hello", "Midnight", "ZK Privacy", "Level 1"];
    let state = INITIAL_STATE;

    for (const msg of messages) {
      ({ newState: state } = simulateStoreMessage(state, msg));
      expect(state.message).toBe(msg);
    }

    // Final state holds the last message
    expect(state.message).toBe("Level 1");
  });

  test("6. State is immutable — original INITIAL_STATE is unchanged after calls", () => {
    simulateStoreMessage(INITIAL_STATE, "should not mutate");
    expect(INITIAL_STATE.message).toBe("");
  });
});

describe("hello-world Contract — Privacy Model (disclose semantics)", () => {
  test("7. publicOutputs contains the message — disclose() makes it public", () => {
    const { publicOutputs } = simulateStoreMessage(INITIAL_STATE, "public value");

    // disclose(customMessage) means `message` is explicitly part of proof output
    expect(publicOutputs).toHaveProperty("message");
    expect(publicOutputs.message).toBe("public value");
  });

  test("8. No hidden fields leak beyond what disclose() explicitly surfaces", () => {
    const { publicOutputs } = simulateStoreMessage(INITIAL_STATE, "test");

    // Only keys explicitly produced by disclose() should appear
    const keys = Object.keys(publicOutputs);
    expect(keys).toEqual(["message"]);
  });

  test("9. publicOutputs.message equals newState.message — ledger and proof agree", () => {
    const msg = "consistency check";
    const { newState, publicOutputs } = simulateStoreMessage(INITIAL_STATE, msg);

    // The on-chain ledger value and the proof's disclosed output must match
    expect(newState.message).toBe(publicOutputs.message);
  });
});
