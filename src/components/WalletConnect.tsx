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
    <div className="wallet-connect-card">
      <h2>1. Wallet Connection</h2>
      <p className="description">
        Connect to your Lace Wallet to authenticate and manage zero-knowledge proofs.
      </p>

      {error && (
        <div className="alert alert-error">
          <strong>Connection Error:</strong> {error}
        </div>
      )}

      {isConnected && unshieldedAddress ? (
        <div className="wallet-info">
          <div className="status status-connected">
            <span className="dot"></span> Connected to Preprod
          </div>
          <div className="address-display">
            <strong>Unshielded Address:</strong>
            <code>{unshieldedAddress}</code>
          </div>
          <button onClick={disconnect} className="btn btn-secondary">
            Disconnect Wallet
          </button>
        </div>
      ) : (
        <div className="wallet-actions">
          <div className="status status-disconnected">
            <span className="dot"></span> Disconnected
          </div>
          <button
            onClick={connect}
            disabled={isConnecting}
            className="btn btn-primary"
          >
            {isConnecting ? 'Connecting...' : 'Connect Lace Wallet'}
          </button>
        </div>
      )}
    </div>
  );
};
export default WalletConnect;
