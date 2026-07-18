'use client';

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
    zkStep,
    currentMessage,
    isLoadingMessage,
    latestDrops,
    isVerifying,
    verificationResult,
    storeMessageOnChain,
    fetchMessage,
    verifyTransaction,
    clearVerification
  } = midnight;

  const [activeTab, setActiveTab] = useState<'prove' | 'verify'>('prove');
  const [inputMessage, setInputMessage] = useState('');
  const [verifyHash, setVerifyHash] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputMessage.trim()) return;

    setError(null);
    setSuccess(false);

    try {
      await storeMessageOnChain(inputMessage);
      setSuccess(true);
      setInputMessage('');
    } catch (err: any) {
      setError(err?.message || 'Failed to submit transaction');
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!verifyHash.trim()) return;
    await verifyTransaction(verifyHash);
  };

  return (
    <div className="space-y-8">
      {/* Brutalist Form Panel */}
      <div className="bg-white border-4 border-black p-8 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] rounded-none">
        
        {/* Faucet Link & Utility Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6 border-b-4 border-black pb-4">
          <div className="flex items-center gap-2">
            <h2 className="text-3xl font-black uppercase tracking-tight">
              2. ZK PROVING OPERATOR
            </h2>
          </div>
          <a
            href="https://faucet.preprod.midnight.network/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block bg-yellow-300 text-black border-4 border-black px-4 py-2 font-black text-xs uppercase tracking-wider hover:bg-black hover:text-yellow-300 hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] active:translate-x-0 active:translate-y-0 active:shadow-none transition-all duration-150 rounded-none"
          >
            GET TESTNET TOKENS ↗
          </a>
        </div>

        {/* Tab Selection */}
        <div className="grid grid-cols-2 gap-0 border-4 border-black mb-6 rounded-none">
          <button
            onClick={() => setActiveTab('prove')}
            className={`py-3 font-black uppercase text-sm tracking-wider transition-all duration-150 rounded-none ${
              activeTab === 'prove'
                ? 'bg-black text-white'
                : 'bg-white text-black hover:bg-neutral-100'
            }`}
          >
            NEW DISCLOSURE (PROVE)
          </button>
          <button
            onClick={() => setActiveTab('verify')}
            className={`py-3 font-black uppercase text-sm tracking-wider transition-all duration-150 border-l-4 border-black rounded-none ${
              activeTab === 'verify'
                ? 'bg-black text-white'
                : 'bg-white text-black hover:bg-neutral-100'
            }`}
          >
            VERIFY PROOF (VERIFY)
          </button>
        </div>

        {/* Error Notification */}
        {error && (
          <div className="bg-red-100 border-4 border-red-500 p-4 mb-6 text-sm font-bold text-red-900 rounded-none">
            [TRANSACTION FAILED] {error}
          </div>
        )}

        {/* Tab Content: Prove */}
        {activeTab === 'prove' && (
          <div className="space-y-6">
            <p className="text-sm font-medium text-neutral-600">
              Submit a public document disclosure. The proof system compiles the circuit and generates the cryptographic witness entirely locally.
            </p>

            {success && txHash && (
              <div className="bg-emerald-100 border-4 border-emerald-500 p-6 mb-6 rounded-none">
                <strong className="block text-emerald-950 text-md uppercase font-black mb-2">
                  ✓ PROOF GENERATED & BROADCASTED
                </strong>
                <div className="text-xs font-mono font-bold break-all bg-white border-2 border-black p-3 mb-3">
                  TX_ID: {txHash}
                </div>
                <div className="inline-block border-2 border-emerald-500 bg-emerald-200 px-3 py-1 text-xs font-black uppercase text-emerald-950 rounded-none">
                  Proved without revealing your input
                </div>
              </div>
            )}

            {isSubmitting ? (
              /* ZK Monospace Terminal-style Step Animation */
              <div className="border-4 border-black p-6 bg-black text-lime-400 font-mono text-sm space-y-2 rounded-none animate-pulse">
                <div>&gt; INITIALIZING ZERO-KNOWLEDGE PROOF OPERATOR...</div>
                <div>&gt; STATUS: ACTIVE</div>
                <div className="text-white font-black">&gt; {zkStep}</div>
                <div className="text-neutral-500">&gt; Local browser keys loaded via FetchZkConfigProvider.</div>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="space-y-2">
                  <label htmlFor="message" className="block text-xs uppercase font-black tracking-wider">
                    DISCLOSURE DATA / STATEMENT
                  </label>
                  <input
                    id="message"
                    type="text"
                    placeholder="Enter raw record statement to prove..."
                    value={inputMessage}
                    onChange={(e) => setInputMessage(e.target.value)}
                    disabled={!isConnected || isSubmitting}
                    className="w-full bg-white text-black border-4 border-black p-4 font-bold text-sm outline-none focus:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] disabled:bg-neutral-100 disabled:cursor-not-allowed rounded-none"
                    required
                  />
                </div>

                <button
                  type="submit"
                  disabled={!isConnected || isSubmitting || !inputMessage.trim()}
                  className="w-full bg-black text-white border-4 border-black px-6 py-4 font-black uppercase tracking-wider hover:bg-white hover:text-black hover:-translate-x-1 hover:-translate-y-1 hover:shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] active:translate-x-0 active:translate-y-0 active:shadow-none transition-all duration-150 disabled:bg-neutral-300 disabled:text-neutral-500 disabled:border-neutral-300 disabled:cursor-not-allowed rounded-none"
                >
                  GENERATE PROOF & DISCLOSE
                </button>
              </form>
            )}

            <div className="border-4 border-black p-6 bg-neutral-50 rounded-none mt-6">
              <div className="flex justify-between items-center mb-4 border-b-2 border-black pb-2">
                <h3 className="text-lg font-black uppercase">CURRENT LEDGER RECORD</h3>
                <button
                  onClick={fetchMessage}
                  disabled={isLoadingMessage}
                  className="text-xs font-black uppercase bg-white border-2 border-black px-3 py-1 hover:bg-black hover:text-white transition-all duration-150 rounded-none"
                >
                  {isLoadingMessage ? 'SYNCING...' : '↻ SYNC STATE'}
                </button>
              </div>
              <div className="bg-white border-2 border-black p-4 min-h-[64px] flex items-center justify-center rounded-none">
                {currentMessage ? (
                  <p className="font-mono text-sm font-black text-neutral-800 break-all w-full">
                    &quot;{currentMessage}&quot;
                  </p>
                ) : (
                  <p className="text-xs font-bold text-neutral-400 uppercase">
                    No public message disclosed yet
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Tab Content: Verify */}
        {activeTab === 'verify' && (
          <div className="space-y-6">
            <p className="text-sm font-medium text-neutral-600">
              Paste a transaction/proof hash from the feed below to trigger independent cryptographic verification against the compiled verifier key.
            </p>

            <form onSubmit={handleVerify} className="space-y-6">
              <div className="space-y-2">
                <label htmlFor="verify-hash" className="block text-xs uppercase font-black tracking-wider">
                  TRANSACTION ID / PROOF HASH
                </label>
                <input
                  id="verify-hash"
                  type="text"
                  placeholder="Paste TX_ID to run verification..."
                  value={verifyHash}
                  onChange={(e) => setVerifyHash(e.target.value)}
                  disabled={isVerifying}
                  className="w-full bg-white text-black border-4 border-black p-4 font-bold text-sm outline-none focus:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] disabled:bg-neutral-100 disabled:cursor-not-allowed rounded-none"
                  required
                />
              </div>

              <div className="flex gap-4">
                <button
                  type="submit"
                  disabled={isVerifying || !verifyHash.trim()}
                  className="flex-1 bg-black text-white border-4 border-black px-6 py-4 font-black uppercase tracking-wider hover:bg-white hover:text-black hover:-translate-x-1 hover:-translate-y-1 hover:shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] active:translate-x-0 active:translate-y-0 active:shadow-none transition-all duration-150 disabled:bg-neutral-300 disabled:text-neutral-500 disabled:border-neutral-300 disabled:cursor-not-allowed rounded-none"
                >
                  {isVerifying ? 'RUNNING VERIFICATION...' : 'VERIFY PROOF'}
                </button>
                {verificationResult && (
                  <button
                    type="button"
                    onClick={() => {
                      setVerifyHash('');
                      clearVerification();
                    }}
                    className="bg-white text-black border-4 border-black px-6 py-4 font-black uppercase tracking-wider hover:bg-black hover:text-white transition-all duration-150 rounded-none"
                  >
                    RESET
                  </button>
                )}
              </div>
            </form>

            {isVerifying && (
              <div className="border-4 border-black p-6 bg-black text-lime-400 font-mono text-sm space-y-1 rounded-none">
                <div>&gt; INITIATING INDEPENDENT VERIFIER SUBPROCESS...</div>
                <div>&gt; LOADING VERIFICATION KEY: storeMessage.verifier</div>
                <div>&gt; RUNNING PLONK MATH VERIFICATION ON-CHAIN...</div>
              </div>
            )}

            {verificationResult && (
              <div className={`border-4 border-black p-6 rounded-none ${
                verificationResult.status === 'VERIFIED' ? 'bg-emerald-50' : 'bg-red-50'
              }`}>
                <div className="flex justify-between items-center mb-4 border-b-2 border-black pb-2">
                  <h3 className="text-md font-black uppercase">VERIFICATION AUDIT LOG</h3>
                  <span className={`px-3 py-1 text-xs font-black uppercase border-2 border-black rounded-none ${
                    verificationResult.status === 'VERIFIED' ? 'bg-emerald-300 text-emerald-950' : 'bg-red-300 text-red-950'
                  }`}>
                    {verificationResult.status}
                  </span>
                </div>
                <div className="font-mono text-xs space-y-2">
                  <div><strong>TX HASH:</strong> {verificationResult.hash}</div>
                  {verificationResult.status === 'VERIFIED' && (
                    <>
                      <div><strong>PROOF TYPE:</strong> {verificationResult.proofType}</div>
                      <div><strong>VERIFIER KEY:</strong> {verificationResult.verifierKey}</div>
                      <div><strong>BLOCK HEIGHT:</strong> {verificationResult.blockHeight}</div>
                      <div><strong>VERIFICATION TIMESTAMP:</strong> {verificationResult.timestamp}</div>
                    </>
                  )}
                  {verificationResult.status === 'FAILED' && (
                    <div className="text-red-700 font-bold">
                      [WARN] No matching contract transaction or valid proof signature found for this hash.
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Live drops feed */}
      <div className="bg-white border-4 border-black p-8 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] rounded-none">
        <h2 className="text-2xl font-black uppercase tracking-tight mb-4 border-b-4 border-black pb-2">
          LATEST ON-CHAIN DROPS (FEED)
        </h2>
        <p className="text-sm font-medium mb-6 text-neutral-600">
          Click any active transaction hash below to copy and verify it instantly in the verification operator.
        </p>

        <div className="border-4 border-black bg-neutral-900 text-neutral-200 p-4 rounded-none max-h-60 overflow-y-auto space-y-3 font-mono text-xs">
          {latestDrops.map((drop, idx) => (
            <div
              key={idx}
              onClick={() => {
                setVerifyHash(drop.hash);
                setActiveTab('verify');
                clearVerification();
              }}
              className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 border-b border-neutral-800 pb-2 hover:bg-neutral-800 p-2 cursor-pointer transition-all duration-150"
              title="Click to populate verification form"
            >
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-lime-400"></span>
                <span className="font-black text-lime-400 break-all">[HASH] {drop.hash}</span>
              </div>
              <div className="text-neutral-500 font-bold text-[10px]">
                {new Date(drop.timestamp).toLocaleTimeString()}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default CircuitCall;
