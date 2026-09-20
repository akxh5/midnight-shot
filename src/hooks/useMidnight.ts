'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { InitialAPI, ConnectedAPI } from '@midnight-ntwrk/dapp-connector-api';
import { FetchZkConfigProvider } from '@midnight-ntwrk/midnight-js-fetch-zk-config-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import * as Disclosure from '../../contracts/managed/disclosure/contract/index.js';
import {
  makeDisclosureWitnesses,
  prepareSubmission,
  setPendingSubmit,
  setPendingProve,
  EMPTY_DISCLOSURE_PRIVATE_STATE,
  type DisclosurePrivateState,
  type DisclosureRecord,
} from '../disclosure-witnesses';

// Must run before any provider is constructed or any address is parsed —
// midnight-js and compact-runtime read this global to know how to encode
// and decode addresses, keys, and tokens. Calling it here, at module load,
// guarantees it runs before every function below (all of which are lazily
// invoked closures) ever executes.
setNetworkId('preprod');

// TODO(deploy): replace with the real Preprod contract address once
// `npm run setup -- --network preprod` has been run against
// contracts/disclosure.compact and a local proof server (Docker was
// unavailable in the environment this rewire was written in — see
// DEPLOYMENT.md). This is a placeholder, not a real address — every
// network call below is written to fail loudly rather than silently
// pretend to work against it.
const PREPROD_CONTRACT_ADDRESS = 'TODO_PENDING_PREPROD_DEPLOYMENT';
const PREPROD_INDEXER_URL = 'https://indexer.preprod.midnight.network/api/v4/graphql';
const PREPROD_INDEXER_WS_URL = 'wss://indexer.preprod.midnight.network/api/v4/graphql/ws';
const DISCLOSURE_PRIVATE_STATE_ID = 'disclosure-private-state';

function isDeployed(): boolean {
  return !PREPROD_CONTRACT_ADDRESS.startsWith('TODO_');
}

// ==========================================
// 1. STRICT SINGLETON PATTERN FOR ALL PROVIDERS
// ==========================================
// Every provider that opens a stream to the Lace extension or a WebSocket must be
// instantiated ONCE per wallet session. Re-creating them on every transaction call
// registers duplicate event listeners, causing MaxListenersExceededWarning and
// ObjectMultiplex orphaned-stream errors.
let globalPublicDataProvider: any = null;
const getPublicDataProvider = () => {
  if (typeof window === 'undefined') return null;
  if (!globalPublicDataProvider) {
    globalPublicDataProvider = indexerPublicDataProvider(PREPROD_INDEXER_URL, PREPROD_INDEXER_WS_URL);
  }
  return globalPublicDataProvider;
};

let globalConnectedAPI: ConnectedAPI | null = null;
let globalUnshieldedAddress: string | null = null;

// These three are also singletons — they each register listeners on the Lace bridge
let globalZkConfigProvider: any = null;
let globalProofProvider: any = null;
let globalPrivateStateProvider: any = null;

const compiledContract = CompiledContract.make('disclosure', Disclosure.Contract).pipe(
  CompiledContract.withWitnesses(makeDisclosureWitnesses()),
);

// Lazily initialise the three heavy providers after wallet connects.
// Subsequent calls return the already-created instances.
const getSessionProviders = async () => {
  if (!globalConnectedAPI || !globalUnshieldedAddress) {
    throw new Error('Wallet not connected — cannot initialise providers.');
  }
  if (!globalZkConfigProvider) {
    globalZkConfigProvider = new FetchZkConfigProvider(
      typeof window !== 'undefined' ? `${window.location.origin}/managed/disclosure` : '',
    );
  }
  if (!globalProofProvider) {
    const { dappConnectorProofProvider } = await import('@midnight-ntwrk/midnight-js-dapp-connector-proof-provider');
    globalProofProvider = await dappConnectorProofProvider(globalConnectedAPI, globalZkConfigProvider, undefined as any);
  }
  if (!globalPrivateStateProvider) {
    globalPrivateStateProvider = levelPrivateStateProvider({
      privateStateStoreName: 'disclosure-dapp-state',
      accountId: globalUnshieldedAddress,
      privateStoragePasswordProvider: async () => 'DApp-Browser-Encrypted-Private-State-Key-1',
    });
  }
  return {
    zkConfigProvider: globalZkConfigProvider,
    proofProvider: globalProofProvider,
    privateStateProvider: globalPrivateStateProvider,
  };
};

// Tear down all session-scoped singletons on disconnect so the next connect starts clean.
const clearSessionProviders = () => {
  globalConnectedAPI = null;
  globalUnshieldedAddress = null;
  globalZkConfigProvider = null;
  globalProofProvider = null;
  globalPrivateStateProvider = null;
};

// ==========================================
// 2. TIMEOUT WRAPPER FOR DETERMINISTIC FAILURE
// ==========================================
const withTimeout = <T,>(promise: Promise<T>, timeoutMs: number, errorMessage: string): Promise<T> => {
  let timeoutId: NodeJS.Timeout;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(errorMessage));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timeoutId);
  });
};

export interface LedgerSummary {
  commitmentCount: number;
  disclosureCount: bigint;
  commitments: string[];
}

export interface UseMidnightResult {
  isConnected: boolean;
  isConnecting: boolean;
  error: string | null;
  unshieldedAddress: string | null;
  ledgerSummary: LedgerSummary | null;
  isLoadingLedger: boolean;
  isSubmitting: boolean;
  txHash: string | null;
  zkStep: string | null;
  terminalLogs: string[];
  terminalStatus: 'idle' | 'running' | 'success' | 'error';
  lastCommitmentHex: string | null;
  myDisclosures: DisclosureRecord[];
  isProvingAuthorship: boolean;
  authorshipResult: { commitmentHex: string; proved: boolean } | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  submitDisclosure: (message: string) => Promise<void>;
  fetchLedgerSummary: () => Promise<void>;
  proveAuthorship: (record: DisclosureRecord) => Promise<void>;
  clearAuthorshipResult: () => void;
  clearTerminal: () => void;
}

export function useMidnight(): UseMidnightResult {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unshieldedAddress, setUnshieldedAddress] = useState<string | null>(null);
  const [ledgerSummary, setLedgerSummary] = useState<LedgerSummary | null>(null);
  const [isLoadingLedger, setIsLoadingLedger] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [lastCommitmentHex, setLastCommitmentHex] = useState<string | null>(null);
  const [myDisclosures, setMyDisclosures] = useState<DisclosureRecord[]>([]);
  const [isProvingAuthorship, setIsProvingAuthorship] = useState(false);
  const [authorshipResult, setAuthorshipResult] = useState<{ commitmentHex: string; proved: boolean } | null>(null);

  const isConnectingRef = useRef(false);

  // ZK Console States
  const [zkStep, setZkStep] = useState<string | null>(null);
  const [terminalLogs, setTerminalLogs] = useState<string[]>([]);
  const [terminalStatus, setTerminalStatus] = useState<'idle' | 'running' | 'success' | 'error'>('idle');

  const clearTerminal = useCallback(() => {
    setTerminalLogs([]);
    setTerminalStatus('idle');
  }, []);

  const clearAuthorshipResult = useCallback(() => {
    setAuthorshipResult(null);
  }, []);

  const disconnect = useCallback(async () => {
    setIsConnected(false);
    setUnshieldedAddress(null);
    // Tear down ALL session-scoped singletons so re-connecting starts with a clean slate
    // and no orphaned stream listeners accumulate on the Lace bridge.
    clearSessionProviders();
    setError(null);
    setMyDisclosures([]);
    if (typeof window !== 'undefined') {
      localStorage.removeItem('midnight_reconnect_lace');
    }
    clearTerminal();
  }, [clearTerminal]);

  const connect = useCallback(async () => {
    if (typeof window === 'undefined') return;
    if (isConnectingRef.current) return;

    isConnectingRef.current = true;
    setIsConnecting(true);
    setError(null);

    try {
      if (!window.midnight) {
        throw new Error('Lace Wallet not detected. Please install the Lace extension.');
      }

      const midnightWallets = window.midnight;
      let initialAPI = midnightWallets?.lace || midnightWallets?.mnLace;

      if (!initialAPI) {
        const keys = Object.keys(midnightWallets);
        if (keys.length > 0) {
          const laceKey = keys.find((k) => k.toLowerCase().includes('lace'));
          initialAPI = midnightWallets[laceKey || keys[0]];
        }
      }

      if (!initialAPI) {
        throw new Error('Lace Wallet not detected. Please install the Lace extension.');
      }

      // Explicit connection handshake with timeout
      const api = await withTimeout(initialAPI.connect('preprod'), 15000, 'Wallet connection handshake timed out.');

      // Explicit network check: compare the wallet's actual configured network
      // against 'preprod', rather than inferring a mismatch from error text.
      const configuration = await withTimeout(
        api.getConfiguration(),
        10000,
        'Failed to read wallet network configuration.',
      );
      if (configuration.networkId !== 'preprod') {
        throw new Error(
          `Network mismatch: wallet is connected to "${configuration.networkId}", but this app requires "preprod". Switch your Lace wallet to the Preprod network and reconnect.`,
        );
      }

      const { unshieldedAddress: address } = await withTimeout(
        api.getUnshieldedAddress(),
        10000,
        'Address fetch timed out.',
      );

      globalConnectedAPI = api;
      globalUnshieldedAddress = address;

      setUnshieldedAddress(address);
      setIsConnected(true);

      localStorage.setItem('midnight_reconnect_lace', 'true');
    } catch (err: any) {
      console.error('Wallet connection error:', err);
      const errMsg = err?.message || '';
      let cleanErr = 'Failed to connect to Lace Wallet';

      if (errMsg.toLowerCase().includes('network mismatch')) {
        cleanErr = errMsg;
      } else if (
        errMsg.toLowerCase().includes('reject') ||
        errMsg.toLowerCase().includes('cancel') ||
        errMsg.toLowerCase().includes('deny')
      ) {
        cleanErr = 'Connection request was rejected or closed by the user.';
      } else if (errMsg.toLowerCase().includes('time')) {
        cleanErr = 'Wallet connection timed out. The extension might be unresponsive.';
      } else if (errMsg) {
        cleanErr = errMsg;
      }

      setError(cleanErr);
      await disconnect();
    } finally {
      isConnectingRef.current = false;
      setIsConnecting(false);
    }
  }, [disconnect]);

  // Auto-reconnect check on mount with strict cleanup
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let timer: NodeJS.Timeout;

    const shouldReconnect = localStorage.getItem('midnight_reconnect_lace') === 'true';
    if (shouldReconnect) {
      timer = setTimeout(() => {
        connect();
      }, 600);
    }

    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [connect]);

  // Public ledger read — commitment count + commitment list only. No plaintext
  // ever existed on this ledger to read: `commitments` is a Set<Bytes<32>> of
  // persistentHash commitments, `disclosureCount` a Counter. Works without a
  // wallet connection (visitors have no local proof server) since it only
  // talks to the public indexer.
  const fetchLedgerSummary = useCallback(async () => {
    if (typeof window === 'undefined') return;
    if (!isDeployed()) return;
    setIsLoadingLedger(true);

    try {
      const publicDataProvider = getPublicDataProvider();
      if (!publicDataProvider) return;

      const contractState = await publicDataProvider.queryContractState(PREPROD_CONTRACT_ADDRESS);
      if (contractState && contractState.data) {
        const ledgerState = Disclosure.ledger(contractState.data);
        const commitments = Array.from(ledgerState.commitments).map((c) => Buffer.from(c).toString('hex'));
        setLedgerSummary({
          commitmentCount: commitments.length,
          disclosureCount: ledgerState.disclosureCount,
          commitments,
        });
      } else {
        setLedgerSummary({ commitmentCount: 0, disclosureCount: 0n, commitments: [] });
      }
    } catch (err: any) {
      console.error('Error fetching ledger state:', err);
    } finally {
      setIsLoadingLedger(false);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;
    if (isMounted && typeof window !== 'undefined') {
      fetchLedgerSummary();
    }
    return () => {
      isMounted = false;
    };
  }, [fetchLedgerSummary]);

  const getContractInstance = useCallback(async () => {
    const { zkConfigProvider, proofProvider, privateStateProvider } = await getSessionProviders();

    const shieldedAddresses = await globalConnectedAPI!.getShieldedAddresses();
    const walletProvider = {
      getCoinPublicKey: () => shieldedAddresses.shieldedCoinPublicKey,
      getEncryptionPublicKey: () => shieldedAddresses.shieldedEncryptionPublicKey,
      balanceTx: async (tx: string) => {
        const result = await withTimeout(
          globalConnectedAPI!.balanceUnsealedTransaction(tx),
          45000,
          'Wallet signature request timed out.',
        );
        return result.tx;
      },
      submitTx: async (tx: string) => {
        await withTimeout(globalConnectedAPI!.submitTransaction(tx), 30000, 'Transaction broadcast timed out.');
      },
    };

    const publicDataProvider = getPublicDataProvider();
    if (!publicDataProvider) throw new Error('Public Data Provider not initialized');

    const providers = {
      privateStateProvider,
      publicDataProvider,
      zkConfigProvider,
      proofProvider,
      walletProvider,
      midnightProvider: walletProvider,
    };

    // The private state provider requires setContractAddress() before any
    // get/set — normally findDeployedContract() does this internally, but
    // here we need to read private state *before* calling it (to decide
    // whether to pass initialPrivateState), so call it explicitly first.
    // findDeployedContract() calling it again afterward with the same
    // address is harmless.
    privateStateProvider.setContractAddress(PREPROD_CONTRACT_ADDRESS);

    // Only seed `initialPrivateState` the first time this browser profile
    // talks to this contract — passing it on every connect would overwrite
    // (and wipe) whatever disclosure history is already stored.
    const priorPrivateState: DisclosurePrivateState | null = await privateStateProvider.get(
      DISCLOSURE_PRIVATE_STATE_ID,
    );
    const findOptions =
      priorPrivateState === null
        ? {
            compiledContract,
            contractAddress: PREPROD_CONTRACT_ADDRESS,
            privateStateId: DISCLOSURE_PRIVATE_STATE_ID,
            initialPrivateState: EMPTY_DISCLOSURE_PRIVATE_STATE,
          }
        : {
            compiledContract,
            contractAddress: PREPROD_CONTRACT_ADDRESS,
            privateStateId: DISCLOSURE_PRIVATE_STATE_ID,
          };

    const contractInstance: any = await findDeployedContract(providers as any, findOptions as any);
    setMyDisclosures((priorPrivateState ?? EMPTY_DISCLOSURE_PRIVATE_STATE).disclosures);
    return contractInstance;
  }, []);

  // ==========================================
  // 3. DETERMINISTIC STATE MACHINE FOR ZK PROOF
  // ==========================================
  const submitDisclosure = useCallback(
    async (message: string) => {
      if (typeof window === 'undefined') throw new Error('Client-side only');
      if (!isDeployed()) throw new Error('Contract not yet deployed to Preprod — see DEPLOYMENT.md.');
      if (!isConnected || !globalUnshieldedAddress) {
        throw new Error('Wallet not connected');
      }

      setIsSubmitting(true);
      setError(null);
      setTxHash(null);
      setLastCommitmentHex(null);
      setTerminalStatus('running');

      let currentLogs: string[] = ['> INITIALIZING ZERO-KNOWLEDGE PROOF OPERATOR...'];
      const updateLogs = (msg: string) => {
        currentLogs = [...currentLogs, msg];
        setTerminalLogs(currentLogs);
      };
      setTerminalLogs([...currentLogs]);

      try {
        const s1 = '> [1/4] Salting & hashing disclosure locally (H(message || nonce))...';
        setZkStep(s1);
        updateLogs(s1);

        // The raw message is consumed here to derive the salted secret, and
        // is never referenced again — it does not get stored, logged, or
        // passed to any provider beyond this point.
        const { secret, record } = await prepareSubmission(message);

        const s2 = '> [2/4] Verifying Active Wallet Session...';
        setZkStep(s2);
        updateLogs(s2);

        if (!globalConnectedAPI) {
          throw new Error('Active wallet session lost. Please reconnect your wallet.');
        }

        setPendingSubmit(secret, record);
        const contractInstance = await getContractInstance();

        const s3 = '> [3/4] Generating Proof & Awaiting Wallet Signature...';
        setZkStep(s3);
        updateLogs(s3);
        updateLogs('> Requesting Lace Wallet signature verification...');

        const tx: any = await withTimeout(
          contractInstance.callTx.submitDisclosure(),
          90000,
          'The ZK proof generation or wallet signature process timed out. Please hard refresh and try again.',
        );

        updateLogs('> [4/4] Broadcasting to Preprod Network...');
        setZkStep('> [4/4] Broadcasting to Preprod Network...');

        const newTxId = tx.public.txId;
        setTxHash(newTxId);
        setLastCommitmentHex(record.commitmentHex);
        setMyDisclosures((prev) => [...prev, record]);

        updateLogs(`> ✓ COMMITMENT WRITTEN TO LEDGER`);
        updateLogs(`> TX_HASH: ${newTxId}`);
        updateLogs(`> COMMITMENT: ${record.commitmentHex}`);
        setTerminalStatus('success');

        await fetchLedgerSummary();
      } catch (err: any) {
        console.error('Transaction flow failed:', err);
        const rawMsg = err?.message || 'Transaction execution failed';
        let cleanError = rawMsg;

        if (rawMsg.toLowerCase().includes('reject') || rawMsg.toLowerCase().includes('cancel') || rawMsg.toLowerCase().includes('deny')) {
          cleanError = 'Wallet signature request was rejected by the user.';
        } else if (rawMsg.toLowerCase().includes('fund') || rawMsg.toLowerCase().includes('balance') || rawMsg.toLowerCase().includes('fee') || rawMsg.toLowerCase().includes('value')) {
          cleanError = 'Insufficient gas fees (tNIGHT tokens) to sign and balance the transaction.';
        } else if (rawMsg.toLowerCase().includes('time')) {
          cleanError = 'Transaction timed out. The Lace extension or ZK provider may be unresponsive.';
        }

        setError(cleanError);
        updateLogs(`> [ERROR] ${cleanError}`);
        setTerminalStatus('error');
      } finally {
        setIsSubmitting(false);
        setZkStep(null);
      }
    },
    [isConnected, getContractInstance, fetchLedgerSummary],
  );

  // Prove knowledge of the preimage of a commitment already on the ledger,
  // without revealing the secret. Only ever runs against a disclosure this
  // browser profile itself submitted (from its local private state).
  const proveAuthorship = useCallback(
    async (record: DisclosureRecord) => {
      if (typeof window === 'undefined') throw new Error('Client-side only');
      if (!isDeployed()) throw new Error('Contract not yet deployed to Preprod — see DEPLOYMENT.md.');
      if (!isConnected || !globalUnshieldedAddress) {
        throw new Error('Wallet not connected');
      }

      setIsProvingAuthorship(true);
      setError(null);

      try {
        const secretBytes = Buffer.from(record.secretHex, 'hex');
        setPendingProve(secretBytes);
        const contractInstance = await getContractInstance();

        const tx: any = await withTimeout(
          contractInstance.callTx.proveAuthorship(),
          90000,
          'Proof generation timed out. Please try again.',
        );

        const proved: boolean = tx.private.result;
        setAuthorshipResult({ commitmentHex: record.commitmentHex, proved });
      } catch (err: any) {
        console.error('proveAuthorship failed:', err);
        setError(err?.message || 'Failed to prove authorship');
      } finally {
        setIsProvingAuthorship(false);
      }
    },
    [isConnected, getContractInstance],
  );

  return {
    isConnected,
    isConnecting,
    error,
    unshieldedAddress,
    ledgerSummary,
    isLoadingLedger,
    isSubmitting,
    txHash,
    zkStep,
    terminalLogs,
    terminalStatus,
    lastCommitmentHex,
    myDisclosures,
    isProvingAuthorship,
    authorshipResult,
    connect,
    disconnect,
    submitDisclosure,
    fetchLedgerSummary,
    proveAuthorship,
    clearAuthorshipResult,
    clearTerminal,
  };
}
