import React, { useState } from 'react';
import { UseMidnightResult } from '../hooks/useMidnight';

interface CircuitCallProps {
  midnight: UseMidnightResult;
}

export const CircuitCall: React.FC<CircuitCallProps> = ({ midnight }) => {
  const {
    isConnected,
    isSubmitting,
    txHash,
    currentMessage,
    isLoadingMessage,
    storeMessageOnChain,
    fetchMessage
  } = midnight;

  const [inputMessage, setInputMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputMessage.trim()) return;

    setError(null);
    setSuccess(false);

    try {
      // Execute the storeMessage circuit call
      await storeMessageOnChain(inputMessage);
      setSuccess(true);
      setInputMessage('');
    } catch (err: any) {
      setError(err?.message || 'Failed to submit transaction');
    }
  };

  return (
    <div className="circuit-call-card">
      <h2>2. Cryptographic Disclosure (Circuit Call)</h2>
      <p className="description">
        Submit a disclosure message to the ledger. Proof of execution is generated locally inside the browser.
      </p>

      {error && (
        <div className="alert alert-error">
          <strong>Transaction Error:</strong> {error}
        </div>
      )}

      {success && txHash && (
        <div className="alert alert-success">
          <strong>✓ Transaction Submitted Successfully!</strong>
          <div className="tx-details">
            <div><strong>Transaction ID:</strong> <code>{txHash}</code></div>
            <div className="badge-zk">Proved without revealing your input</div>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="circuit-form">
        <div className="form-group">
          <label htmlFor="message-input">Disclosure Message / Document Hash</label>
          <input
            id="message-input"
            type="text"
            placeholder="Enter public record or document hash to disclose..."
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            disabled={!isConnected || isSubmitting}
            required
          />
        </div>

        <button
          type="submit"
          disabled={!isConnected || isSubmitting || !inputMessage.trim()}
          className="btn btn-primary btn-block"
        >
          {isSubmitting ? (
            <span className="loading-spinner">Generating ZK Proof locally...</span>
          ) : (
            'Generate Proof & Disclose'
          )}
        </button>
      </form>

      <hr className="divider" />

      <div className="ledger-state">
        <div className="ledger-header">
          <h3>On-Chain Ledger State</h3>
          <button
            onClick={fetchMessage}
            disabled={isLoadingMessage}
            className="btn-refresh"
            title="Sync Ledger State"
          >
            {isLoadingMessage ? 'Syncing...' : '↻ Refresh'}
          </button>
        </div>

        <div className="message-box">
          {currentMessage ? (
            <div className="message-content">
              <span className="label">Current Public Message:</span>
              <p className="value">"{currentMessage}"</p>
            </div>
          ) : (
            <p className="placeholder-text">No public message has been stored yet.</p>
          )}
        </div>
      </div>
    </div>
  );
};
export default CircuitCall;
