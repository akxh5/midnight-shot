'use client';

import React, { useState } from 'react';
import { UseMidnightResult } from '../hooks/useMidnight';

interface CircuitCallProps {
  midnight: UseMidnightResult;
}

function truncate(hex: string, lead = 10, tail = 8): string {
  if (hex.length <= lead + tail + 3) return hex;
  return `${hex.slice(0, lead)}…${hex.slice(-tail)}`;
}

export const CircuitCall: React.FC<CircuitCallProps> = ({ midnight }) => {
  const {
    isConnected,
    isSubmitting,
    txHash,
    terminalLogs,
    terminalStatus,
    lastCommitmentHex,
    ledgerSummary,
    isLoadingLedger,
    myDisclosures,
    isProvingAuthorship,
    authorshipResult,
    submitDisclosure,
    fetchLedgerSummary,
    proveAuthorship,
    clearAuthorshipResult,
    clearTerminal,
  } = midnight;

  const [inputMessage, setInputMessage] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputMessage.trim()) return;

    setError(null);

    try {
      // submitDisclosure salts + hashes this locally; the raw text is never
      // stored anywhere and is discarded the instant the ZK operator below
      // takes over.
      await submitDisclosure(inputMessage);
      setInputMessage('');
    } catch (err: any) {
      setError(err?.message || 'Failed to submit transaction');
    }
  };

  const handleResetConsole = () => {
    clearTerminal();
    setError(null);
  };

  return (
    <div className="space-y-8">
      {/* Brutalist Form Panel */}
      <div className="bg-white border-4 border-black p-8 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] rounded-none">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6 border-b-4 border-black pb-4">
          <h2 className="text-3xl font-black uppercase tracking-tight">2. ZK PROVING OPERATOR</h2>
          <a
            href="https://faucet.preprod.midnight.network/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block bg-yellow-300 text-black border-4 border-black px-4 py-2 font-black text-xs uppercase tracking-wider hover:bg-black hover:text-yellow-300 hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] active:translate-x-0 active:translate-y-0 active:shadow-none transition-all duration-150 rounded-none"
          >
            GET TESTNET TOKENS ↗
          </a>
        </div>

        {error && (
          <div className="bg-red-100 border-4 border-red-500 p-4 mb-6 text-sm font-bold text-red-900 rounded-none">
            [TRANSACTION FAILED] {error}
          </div>
        )}

        <div className="space-y-6">
          <p className="text-sm font-medium text-neutral-600">
            Submit a disclosure. Your message is salted with a random nonce and hashed to a commitment entirely in
            your browser — only the commitment and proof are ever sent anywhere.
          </p>

          {terminalStatus !== 'idle' ? (
            <div className="space-y-4">
              <div
                className={`border-4 border-black p-6 bg-black font-mono text-sm space-y-2 rounded-none ${
                  terminalStatus === 'running'
                    ? 'text-lime-400 animate-pulse'
                    : terminalStatus === 'success'
                      ? 'text-emerald-400'
                      : 'text-red-500'
                }`}
              >
                <div className="flex justify-between items-center border-b border-neutral-800 pb-2 mb-3">
                  <span className="font-black">ZK OPERATOR CONSOLE</span>
                  <span
                    className={`text-[10px] px-2 py-0.5 border font-black uppercase ${
                      terminalStatus === 'running'
                        ? 'bg-lime-950 text-lime-400 border-lime-400'
                        : terminalStatus === 'success'
                          ? 'bg-emerald-950 text-emerald-400 border-emerald-400'
                          : 'bg-red-950 text-red-500 border-red-500'
                    }`}
                  >
                    {terminalStatus}
                  </span>
                </div>

                {terminalLogs.map((log, idx) => (
                  <div
                    key={idx}
                    className={
                      log.startsWith('> [ERROR]')
                        ? 'text-red-400 font-black whitespace-pre-wrap'
                        : log.startsWith('> ✓')
                          ? 'text-emerald-400 font-black'
                          : 'text-neutral-300'
                    }
                  >
                    {log}
                  </div>
                ))}
              </div>

              {/* Result after submission — commitment + tx id only. The raw
                  disclosure text is never rendered here or anywhere else. */}
              {terminalStatus === 'success' && lastCommitmentHex && (
                <div className="border-4 border-black p-4 bg-emerald-50 rounded-none space-y-1">
                  <div className="text-xs font-black uppercase text-emerald-800">Commitment recorded</div>
                  <div className="font-mono text-xs break-all">{lastCommitmentHex}</div>
                  {txHash && <div className="font-mono text-[10px] text-neutral-500 break-all">tx: {txHash}</div>}
                </div>
              )}

              {(terminalStatus === 'success' || terminalStatus === 'error') && (
                <button
                  onClick={handleResetConsole}
                  className="w-full bg-black text-white border-4 border-black px-6 py-3 font-black uppercase tracking-wider hover:bg-white hover:text-black hover:-translate-x-1 hover:-translate-y-1 hover:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] active:translate-x-0 active:translate-y-0 active:shadow-none transition-all duration-150 rounded-none"
                >
                  {terminalStatus === 'success' ? 'DISCLOSE ANOTHER STATEMENT' : 'RESET CONSOLE & RETRY'}
                </button>
              )}
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
                {isSubmitting ? 'GENERATING PROOF...' : 'GENERATE PROOF & DISCLOSE'}
              </button>

              {/* MANDATORY Level 2 privacy label */}
              <div className="flex items-center gap-2 border-2 border-black bg-neutral-50 px-4 py-3 rounded-none">
                <span className="font-mono text-xs font-black text-neutral-500 select-none">🔒</span>
                <p className="font-mono text-xs font-bold text-neutral-700">
                  Proved without revealing your input — the raw message never leaves your browser.
                </p>
              </div>
            </form>
          )}
        </div>
      </div>

      {/* Public ledger read — commitments + counter only. Works with no
          wallet connected: it only talks to the public indexer. */}
      <div className="bg-white border-4 border-black p-8 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] rounded-none">
        <div className="flex justify-between items-center mb-4 border-b-4 border-black pb-2">
          <h2 className="text-2xl font-black uppercase tracking-tight">PUBLIC LEDGER — COMMITMENTS</h2>
          <button
            onClick={fetchLedgerSummary}
            disabled={isLoadingLedger}
            className="text-xs font-black uppercase bg-white border-2 border-black px-3 py-1 hover:bg-black hover:text-white transition-all duration-150 rounded-none"
          >
            {isLoadingLedger ? 'SYNCING...' : '↻ SYNC STATE'}
          </button>
        </div>
        <p className="text-sm font-medium mb-4 text-neutral-600">
          Every disclosure ever submitted appears here as a 32-byte commitment — a hash, never the original
          message. Anyone can see a disclosure happened; no one can read what was disclosed from this list.
        </p>

        <div className="grid grid-cols-2 gap-4 mb-4">
          <div className="border-2 border-black p-3 rounded-none">
            <div className="text-[10px] font-black uppercase text-neutral-500">Commitments (set size)</div>
            <div className="text-2xl font-black">{ledgerSummary?.commitmentCount ?? '—'}</div>
          </div>
          <div className="border-2 border-black p-3 rounded-none">
            <div className="text-[10px] font-black uppercase text-neutral-500">Disclosure count</div>
            <div className="text-2xl font-black">{ledgerSummary ? ledgerSummary.disclosureCount.toString() : '—'}</div>
          </div>
        </div>
        {ledgerSummary && ledgerSummary.disclosureCount > BigInt(ledgerSummary.commitmentCount) && (
          <div className="text-[11px] font-bold text-amber-700 mb-4">
            Disclosure count exceeds the commitment set size — at least one duplicate secret was submitted more than
            once.
          </div>
        )}

        <div className="border-4 border-black bg-neutral-900 text-neutral-200 p-4 rounded-none max-h-60 overflow-y-auto space-y-2 font-mono text-xs">
          {!ledgerSummary || ledgerSummary.commitments.length === 0 ? (
            <div className="text-neutral-500">No commitments on-chain yet.</div>
          ) : (
            ledgerSummary.commitments.map((c) => (
              <div key={c} className="flex items-center gap-2 border-b border-neutral-800 pb-2">
                <span className="w-1.5 h-1.5 bg-lime-400" />
                <span className="text-lime-400 break-all">{c}</span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Local-only: this browser's own disclosure history (private state),
          used to prove authorship without re-disclosing anything. */}
      {isConnected && (
        <div className="bg-white border-4 border-black p-8 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] rounded-none">
          <h2 className="text-2xl font-black uppercase tracking-tight mb-4 border-b-4 border-black pb-2">
            MY DISCLOSURES (LOCAL ONLY)
          </h2>
          <p className="text-sm font-medium mb-4 text-neutral-600">
            Stored only in this browser&apos;s encrypted private state — never sent anywhere. Prove you authored one
            of these without revealing your original message again.
          </p>

          {myDisclosures.length === 0 ? (
            <div className="text-xs font-bold text-neutral-400 uppercase">No disclosures from this browser yet.</div>
          ) : (
            <div className="space-y-2">
              {myDisclosures.map((d) => (
                <div
                  key={d.commitmentHex}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-2 border-black p-3 rounded-none"
                >
                  <div className="font-mono text-xs break-all">{truncate(d.commitmentHex)}</div>
                  <button
                    onClick={() => {
                      clearAuthorshipResult();
                      proveAuthorship(d);
                    }}
                    disabled={isProvingAuthorship}
                    className="text-xs font-black uppercase bg-black text-white border-2 border-black px-3 py-1 hover:bg-white hover:text-black transition-all duration-150 rounded-none disabled:opacity-50"
                  >
                    {isProvingAuthorship ? 'PROVING...' : 'PROVE AUTHORSHIP'}
                  </button>
                </div>
              ))}
            </div>
          )}

          {authorshipResult && (
            <div
              className={`mt-4 border-4 border-black p-4 rounded-none ${
                authorshipResult.proved ? 'bg-emerald-50' : 'bg-red-50'
              }`}
            >
              <div className="font-mono text-xs break-all mb-1">{authorshipResult.commitmentHex}</div>
              <div className="font-black text-sm uppercase">
                {authorshipResult.proved ? '✓ Proved — without revealing your input' : '✗ Not proved'}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default CircuitCall;
