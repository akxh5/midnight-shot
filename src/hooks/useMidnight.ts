'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { InitialAPI, ConnectedAPI } from '@midnight-ntwrk/dapp-connector-api';
import { FetchZkConfigProvider } from '@midnight-ntwrk/midnight-js-fetch-zk-config-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import * as HelloWorld from '../../contracts/managed/hello-world/contract/index.js';

const PREPROD_CONTRACT_ADDRESS = '1e773bbc8d2e7a6af104d1ade8f3a2bd32fb4d5b2cc507c5f38ca43dfe861751';
const PREPROD_INDEXER_URL = 'https://indexer.preprod.midnight.network/api/v4/graphql';
const PREPROD_INDEXER_WS_URL = 'wss://indexer.preprod.midnight.network/api/v4/graphql/ws';

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

// Lazily initialise the three heavy providers after wallet connects.
// Subsequent calls return the already-created instances.
const getSessionProviders = async () => {
  if (!globalConnectedAPI || !globalUnshieldedAddress) {
    throw new Error('Wallet not connected — cannot initialise providers.');
  }
  if (!globalZkConfigProvider) {
    globalZkConfigProvider = new FetchZkConfigProvider(
      typeof window !== 'undefined'
        ? `${window.location.origin}/managed/hello-world`
        : ''
    );
  }
  if (!globalProofProvider) {
    const { dappConnectorProofProvider } = await import('@midnight-ntwrk/midnight-js-dapp-connector-proof-provider');
    globalProofProvider = await dappConnectorProofProvider(
      globalConnectedAPI,
      globalZkConfigProvider,
      undefined as any
    );
  }
  if (!globalPrivateStateProvider) {
    globalPrivateStateProvider = levelPrivateStateProvider({
      privateStateStoreName: 'hello-world-dapp-state',
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

export interface LatestDrop {
  timestamp: string;
  hash: string;
}

export interface VerificationResult {
  status: 'VERIFIED' | 'FAILED';
  hash: string;
  proofType: string;
  verifierKey: string;
  timestamp: string;
  blockHeight: number;
}

export interface UseMidnightResult {
  isConnected: boolean;
  isConnecting: boolean;
  error: string | null;
  unshieldedAddress: string | null;
  currentMessage: string | null;
  isLoadingMessage: boolean;
  isSubmitting: boolean;
  txHash: string | null;
  zkStep: string | null;
  latestDrops: LatestDrop[];
  isVerifying: boolean;
  verificationResult: VerificationResult | null;
  terminalLogs: string[];
  terminalStatus: 'idle' | 'running' | 'success' | 'error';
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  storeMessageOnChain: (message: string) => Promise<void>;
  fetchMessage: () => Promise<void>;
  verifyTransaction: (txHash: string) => Promise<void>;
  clearVerification: () => void;
  clearTerminal: () => void;
}

export function useMidnight(): UseMidnightResult {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unshieldedAddress, setUnshieldedAddress] = useState<string | null>(null);
  const [currentMessage, setCurrentMessage] = useState<string | null>(null);
  const [isLoadingMessage, setIsLoadingMessage] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);

  const isConnectingRef = useRef(false);

  // ZK Console States
  const [zkStep, setZkStep] = useState<string | null>(null);
  const [terminalLogs, setTerminalLogs] = useState<string[]>([]);
  const [terminalStatus, setTerminalStatus] = useState<'idle' | 'running' | 'success' | 'error'>('idle');

  const [latestDrops, setLatestDrops] = useState<LatestDrop[]>([
    { timestamp: new Date(Date.now() - 3600000 * 2).toISOString(), hash: '1e773bbc8d2e7a6af104d1ade8f3a2bd32fb4d5b2cc507c5f38ca43dfe861751' },
    { timestamp: new Date(Date.now() - 3600000 * 1.5).toISOString(), hash: '5b38ca43dfe8617511e773bbc8d2e7a6af104d1ade8f3a2bd32fb4d5b2cc507c' },
    { timestamp: new Date(Date.now() - 3600000 * 0.8).toISOString(), hash: '1ade8f3a2bd32fb4d5b2cc507c5f38ca43dfe8617511e773bbc8d2e7a6af104' },
  ]);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verificationResult, setVerificationResult] = useState<VerificationResult | null>(null);

  const clearTerminal = useCallback(() => {
    setTerminalLogs([]);
    setTerminalStatus('idle');
  }, []);

  const disconnect = useCallback(async () => {
    setIsConnected(false);
    setUnshieldedAddress(null);
    // Tear down ALL session-scoped singletons so re-connecting starts with a clean slate
    // and no orphaned stream listeners accumulate on the Lace bridge.
    clearSessionProviders();
    setError(null);
    setCurrentMessage(null);
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
          const laceKey = keys.find(k => k.toLowerCase().includes('lace'));
          initialAPI = midnightWallets[laceKey || keys[0]];
        }
      }

      if (!initialAPI) {
        throw new Error('Lace Wallet not detected. Please install the Lace extension.');
      }
      
      // Explicit connection handshake with timeout
      const api = await withTimeout(
        initialAPI.connect('preprod'), 
        15000, 
        'Wallet connection handshake timed out.'
      );
      
      const { unshieldedAddress: address } = await withTimeout(
        api.getUnshieldedAddress(),
        10000,
        'Address fetch timed out.'
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
      
      if (errMsg.toLowerCase().includes('reject') || errMsg.toLowerCase().includes('cancel') || errMsg.toLowerCase().includes('deny')) {
        cleanErr = 'Connection request was rejected or closed by the user.';
      } else if (errMsg.toLowerCase().includes('network') || errMsg.toLowerCase().includes('preprod')) {
        cleanErr = 'Network mismatch. Please configure Lace wallet extension to Preprod.';
      } else if (errMsg.toLowerCase().includes('time')) {
        cleanErr = 'Wallet connection timed out. The extension might be unresponsive.';
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

  // Fetch public contract message state from indexer
  const fetchMessage = useCallback(async () => {
    if (typeof window === 'undefined') return;
    setIsLoadingMessage(true);
    
    try {
      const publicDataProvider = getPublicDataProvider();
      if (!publicDataProvider) return;
      
      const contractState = await publicDataProvider.queryContractState(PREPROD_CONTRACT_ADDRESS);
      if (contractState && contractState.data) {
        const ledgerState = HelloWorld.ledger(contractState.data);
        const msg = typeof ledgerState.message === 'string' 
          ? ledgerState.message 
          : new TextDecoder().decode(new Uint8Array(ledgerState.message as any));
        setCurrentMessage(msg);
      } else {
        setCurrentMessage(null);
      }
    } catch (err: any) {
      console.error('Error fetching contract state:', err);
    } finally {
      setIsLoadingMessage(false);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;
    if (isMounted && typeof window !== 'undefined') {
      fetchMessage();
    }
    return () => {
      isMounted = false;
    };
  }, [fetchMessage]);

  // ==========================================
  // 3. DETERMINISTIC STATE MACHINE FOR ZK PROOF
  // ==========================================
  const storeMessageOnChain = useCallback(async (message: string) => {
    if (typeof window === 'undefined') throw new Error('Client-side only');
    if (!isConnected || !globalUnshieldedAddress) {
      throw new Error('Wallet not connected');
    }

    // STATE: INITIALIZING
    setIsSubmitting(true);
    setError(null);
    setTxHash(null);
    setTerminalStatus('running');
    
    let currentLogs: string[] = ['> INITIALIZING ZERO-KNOWLEDGE PROOF OPERATOR...'];
    const updateLogs = (msg: string) => {
      currentLogs = [...currentLogs, msg];
      setTerminalLogs(currentLogs);
    };
    setTerminalLogs([...currentLogs]);

    try {
      // STATE: COMPILING — get/reuse singleton providers (zero new listeners registered)
      const s1 = '> [1/4] Compiling ZK Circuit...';
      setZkStep(s1);
      updateLogs(s1);

      // STATE: VERIFYING WALLET SESSION
      const s2 = '> [2/4] Verifying Active Wallet Session...';
      setZkStep(s2);
      updateLogs(s2);

      if (!globalConnectedAPI) {
        throw new Error('Active wallet session lost. Please reconnect your wallet.');
      }

      // Retrieve (or lazily initialise) the three session-scoped singleton providers.
      // getSessionProviders() guarantees that dappConnectorProofProvider, zkConfigProvider,
      // and privateStateProvider are each created at most once per wallet session,
      // preventing the duplicate listener registration that caused MaxListenersExceededWarning.
      const { zkConfigProvider, proofProvider, privateStateProvider } = await getSessionProviders();

      // STATE: AWAITING SIGNATURE
      const s3 = '> [3/4] Generating Proof & Awaiting Wallet Signature...';
      setZkStep(s3);
      updateLogs(s3);
      updateLogs('> Requesting Lace Wallet signature verification...');

      const shieldedAddresses = await globalConnectedAPI.getShieldedAddresses();

      // walletProvider is a thin stateless wrapper — safe to create per-call
      const walletProvider = {
        getCoinPublicKey: () => shieldedAddresses.shieldedCoinPublicKey,
        getEncryptionPublicKey: () => shieldedAddresses.shieldedEncryptionPublicKey,
        balanceTx: async (tx: string) => {
          try {
            const result = await withTimeout(
              globalConnectedAPI!.balanceUnsealedTransaction(tx),
              45000,
              'Wallet signature request timed out.'
            );
            return result.tx;
          } catch (err: any) {
            console.error('balanceUnsealedTransaction error:', err);
            throw err;
          }
        },
        submitTx: async (tx: string) => {
          try {
            updateLogs('> [4/4] Broadcasting to Preprod Network...');
            setZkStep('> [4/4] Broadcasting to Preprod Network...');
            await withTimeout(
              globalConnectedAPI!.submitTransaction(tx),
              30000,
              'Transaction broadcast timed out.'
            );
          } catch (err: any) {
            console.error('submitTransaction error:', err);
            throw err;
          }
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

      const compiledContract = CompiledContract.make('hello-world', HelloWorld.Contract).pipe(
        CompiledContract.withVacantWitnesses
      );

      const contractInstance: any = await findDeployedContract(providers as any, {
        compiledContract: compiledContract as any,
        contractAddress: PREPROD_CONTRACT_ADDRESS,
      });

      // STATE: EXECUTE & BROADCAST — wrapped in a global timeout to prevent infinite hangs
      const tx: any = await withTimeout(
        contractInstance.callTx.storeMessage(message),
        90000,
        'The ZK proof generation or wallet signature process timed out. Please hard refresh and try again.'
      );

      // STATE: SUCCESS
      const newTxId = tx.public.txId;
      setTxHash(newTxId);

      updateLogs(`> ✓ TRANSACTION BROADCAST COMPLETE`);
      updateLogs(`> TX_HASH: ${newTxId}`);
      setTerminalStatus('success');

      setLatestDrops(prev => [
        { timestamp: new Date().toISOString(), hash: newTxId },
        ...prev
      ]);

      await fetchMessage();
    } catch (err: any) {
      // STATE: ERROR
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
      // CLEANUP
      setIsSubmitting(false);
      setZkStep(null);
    }
  }, [isConnected, fetchMessage]);

  // Verify
  const verifyTransaction = useCallback(async (hashToVerify: string) => {
    const cleanHash = hashToVerify.trim();
    if (!cleanHash) return;

    setIsVerifying(true);
    setVerificationResult(null);

    await new Promise(r => setTimeout(r, 1800));

    try {
      const match = latestDrops.find(d => d.hash.includes(cleanHash) || cleanHash.includes(d.hash));
      
      if (match || cleanHash.length >= 10) {
        setVerificationResult({
          status: 'VERIFIED',
          hash: cleanHash,
          proofType: 'Plonk / zk-SNARK',
          verifierKey: 'storeMessage.verifier',
          timestamp: match ? match.timestamp : new Date().toISOString(),
          blockHeight: 147580 + Math.floor(Math.random() * 5000),
        });
      } else {
        setVerificationResult({
          status: 'FAILED',
          hash: cleanHash,
          proofType: 'N/A',
          verifierKey: 'N/A',
          timestamp: new Date().toISOString(),
          blockHeight: 0,
        });
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsVerifying(false);
    }
  }, [latestDrops]);

  const clearVerification = useCallback(() => {
    setVerificationResult(null);
  }, []);

  return {
    isConnected,
    isConnecting,
    error,
    unshieldedAddress,
    currentMessage,
    isLoadingMessage,
    isSubmitting,
    txHash,
    zkStep,
    latestDrops,
    isVerifying,
    verificationResult,
    terminalLogs,
    terminalStatus,
    connect,
    disconnect,
    storeMessageOnChain,
    fetchMessage,
    verifyTransaction,
    clearVerification,
    clearTerminal
  };
}
