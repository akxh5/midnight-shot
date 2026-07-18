'use client';

import React from 'react';
import { UseMidnightResult } from '../hooks/useMidnight';

interface WalletConnectProps {
  midnight: UseMidnightResult;
}

export const WalletConnect: React.FC<WalletConnectProps> = ({ midnight }) => {
  const {
    isConnected,
    isConnecting,
    error,
    unshieldedAddress,
    connect,
    disconnect
  } = midnight;

  return (
    <div className="bg-white border-4 border-black p-8 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] rounded-none">
      <h2 className="text-3xl font-black uppercase tracking-tight mb-4 border-b-4 border-black pb-2">
        1. WALLET CONNECTION
      </h2>
      <p className="text-sm font-medium mb-6 text-neutral-600">
        Connect your Lace wallet extension to compile and verify zero-knowledge proofs locally in your browser.
      </p>

      {error && (
        <div className="bg-red-100 border-4 border-red-500 p-4 mb-6 text-sm font-bold text-red-900 rounded-none">
          [ERROR] {error}
        </div>
      )}

      {isConnected && unshieldedAddress ? (
        <div className="space-y-6">
          <div className="inline-flex items-center gap-2 border-2 border-black bg-emerald-100 px-3 py-1 font-bold text-xs uppercase rounded-none">
            <span className="w-2.5 h-2.5 bg-emerald-500 border border-black"></span> 
            CONNECTED TO PREPROD
          </div>
          
          <div className="border-4 border-black p-4 bg-neutral-50 rounded-none">
            <strong className="block text-xs uppercase tracking-wider mb-1 font-black">
              UNSHIELDED ACCOUNT ADDRESS
            </strong>
            <code className="block text-xs font-mono font-bold break-all bg-white border-2 border-black p-2">
              {unshieldedAddress}
            </code>
          </div>

          <button 
            onClick={disconnect} 
            className="w-full bg-white text-black border-4 border-black px-6 py-3 font-black uppercase tracking-wider hover:bg-black hover:text-white transition-all duration-150 rounded-none"
          >
            DISCONNECT WALLET
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="inline-flex items-center gap-2 border-2 border-black bg-neutral-200 px-3 py-1 font-bold text-xs uppercase rounded-none">
            <span className="w-2.5 h-2.5 bg-neutral-500 border border-black"></span> 
            DISCONNECTED
          </div>
          
          <button
            onClick={connect}
            disabled={isConnecting}
            className="w-full bg-black text-white border-4 border-black px-6 py-3 font-black uppercase tracking-wider hover:bg-white hover:text-black hover:-translate-x-1 hover:-translate-y-1 hover:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] active:translate-x-0 active:translate-y-0 active:shadow-none transition-all duration-150 disabled:bg-neutral-300 disabled:text-neutral-500 disabled:border-neutral-300 disabled:cursor-not-allowed rounded-none"
          >
            {isConnecting ? 'CONNECTING...' : 'CONNECT LACE WALLET'}
          </button>
        </div>
      )}
    </div>
  );
};

export default WalletConnect;
