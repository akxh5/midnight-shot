'use client';

import { useState, useEffect, useCallback } from 'react';
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

export interface UseMidnightResult {
  isConnected: boolean;
  isConnecting: boolean;
  error: string | null;
  unshieldedAddress: string | null;
  currentMessage: string | null;
  isLoadingMessage: boolean;
  isSubmitting: boolean;
  txHash: string | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  storeMessageOnChain: (message: string) => Promise<void>;
  fetchMessage: () => Promise<void>;
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
  const [connectedAPI, setConnectedAPI] = useState<ConnectedAPI | null>(null);

  // Enforce disconnect/clear state
  const disconnect = useCallback(async () => {
    setIsConnected(false);
    setUnshieldedAddress(null);
    setConnectedAPI(null);
    setError(null);
    setCurrentMessage(null);
  }, []);

  const connect = useCallback(async () => {
    setIsConnecting(true);
    setError(null);
    try {
      const midnightWallets = window.midnight;
      const initialAPI = midnightWallets?.lace || midnightWallets?.mnLace;
      if (!initialAPI) {
        throw new Error('Lace Wallet not detected. Please install the Lace extension.');
      }
      
      // Connect to Preprod network
      const api = await initialAPI.connect('preprod');
      setConnectedAPI(api);

      const { unshieldedAddress: address } = await api.getUnshieldedAddress();
      setUnshieldedAddress(address);
      setIsConnected(true);
    } catch (err: any) {
      console.error('Wallet connection error:', err);
      setError(err?.message || 'Failed to connect to Lace Wallet');
      await disconnect();
    } finally {
      setIsConnecting(false);
    }
  }, [disconnect]);

  // Fetch public contract message state from indexer
  const fetchMessage = useCallback(async () => {
    setIsLoadingMessage(true);
    try {
      const publicDataProvider = indexerPublicDataProvider(PREPROD_INDEXER_URL, PREPROD_INDEXER_WS_URL);
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

  // Run initial fetch of the on-chain message state
  useEffect(() => {
    fetchMessage();
  }, [fetchMessage]);

  const storeMessageOnChain = useCallback(async (message: string) => {
    if (!isConnected || !connectedAPI || !unshieldedAddress) {
      throw new Error('Wallet not connected');
    }

    setIsSubmitting(true);
    setError(null);
    setTxHash(null);

    try {
      // 1. Setup ZK config provider to fetch keys from our local Vite static dir /managed/...
      const zkConfigProvider = new FetchZkConfigProvider(`${window.location.origin}/managed/hello-world`);

      // 2. Wrap connected wallet API as Midnight.js wallet provider
      const shieldedAddresses = await connectedAPI.getShieldedAddresses();
      const walletProvider = {
        getCoinPublicKey: () => shieldedAddresses.shieldedCoinPublicKey,
        getEncryptionPublicKey: () => shieldedAddresses.shieldedEncryptionPublicKey,
        balanceTx: async (tx: string) => {
          const result = await connectedAPI.balanceUnsealedTransaction(tx);
          return result.tx;
        },
        submitTx: async (tx: string) => {
          await connectedAPI.submitTransaction(tx);
        }
      };

      // 3. Obtain proof provider from the wallet
      const proofProvider = await connectedAPI.getProvingProvider(zkConfigProvider);

      // 4. In-browser private state provider (using IndexedDB level provider)
      const privateStateProvider = levelPrivateStateProvider({
        privateStateStoreName: 'hello-world-dapp-state',
        accountId: unshieldedAddress,
        privateStoragePasswordProvider: async () => 'DApp-Browser-Encrypted-Private-State-Key-1'
      });

      // 5. Setup complete providers object for the contracts SDK
      const providers = {
        privateStateProvider,
        publicDataProvider: indexerPublicDataProvider(PREPROD_INDEXER_URL, PREPROD_INDEXER_WS_URL),
        zkConfigProvider,
        proofProvider,
        walletProvider,
        midnightProvider: walletProvider
      };

      // 6. Set compiled contract config
      const compiledContract = CompiledContract.make('hello-world', HelloWorld.Contract).pipe(
        CompiledContract.withVacantWitnesses
      );

      // 7. Find the deployed contract
      const contractInstance: any = await findDeployedContract(providers as any, {
        compiledContract: compiledContract as any,
        contractAddress: PREPROD_CONTRACT_ADDRESS
      });

      // 8. Execute the circuit call
      console.log('Generating proof and submitting transaction...');
      const tx = await contractInstance.callTx.storeMessage(message);
      
      // Store transaction hash/result
      setTxHash(tx.public.txId);
      
      // Refresh message from indexer
      await fetchMessage();
    } catch (err: any) {
      console.error('Transaction failed:', err);
      setError(err?.message || 'Transaction execution failed');
      throw err;
    } finally {
      setIsSubmitting(false);
    }
  }, [isConnected, connectedAPI, unshieldedAddress, fetchMessage]);

  return {
    isConnected,
    isConnecting,
    error,
    unshieldedAddress,
    currentMessage,
    isLoadingMessage,
    isSubmitting,
    txHash,
    connect,
    disconnect,
    storeMessageOnChain,
    fetchMessage
  };
}
