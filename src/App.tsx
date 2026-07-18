'use client';

import React from 'react';
import { useMidnight } from './hooks/useMidnight';
import WalletConnect from './components/WalletConnect';
import CircuitCall from './components/CircuitCall';
import './index.css';

export const App: React.FC = () => {
  const midnight = useMidnight();

  return (
    <div className="min-h-screen bg-[#f3f4f6] text-black selection:bg-black selection:text-white p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-12">
        
        {/* Header Block */}
        <header className="border-4 border-black p-8 md:p-12 bg-white shadow-[12px_12px_0px_0px_rgba(0,0,0,1)] rounded-none space-y-4">
          <div className="flex flex-col md:flex-row justify-between items-start gap-4">
            <div>
              <div className="inline-block bg-black text-white px-3 py-1 text-xs font-black uppercase tracking-widest mb-4 rounded-none">
                BUILDER CHALLENGE : LEVEL 2
              </div>
              <h1 className="text-5xl md:text-8xl font-black tracking-tighter uppercase leading-none">
                MIDNIGHT DROP
              </h1>
            </div>
            <div className="border-4 border-black bg-yellow-300 px-4 py-2 font-black uppercase text-sm tracking-wider shadow-[4px_4px_0px_0px_#000000] rounded-none">
              PREPROD TESTNET
            </div>
          </div>
          
          <p className="text-lg md:text-xl font-bold tracking-tight text-neutral-800 max-w-4xl border-t-2 border-black pt-4">
            A cryptographic whistleblower disclosure and verification client powered by zero-knowledge proofs. Proving is completed entirely client-side.
          </p>
        </header>

        {/* Core Layout Grid */}
        <main className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Wallet Block */}
          <div className="lg:col-span-4 space-y-8">
            <WalletConnect midnight={midnight} />
            
            {/* Tech Stack Info Block */}
            <div className="bg-white border-4 border-black p-6 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] rounded-none space-y-4">
              <h3 className="text-xl font-black uppercase tracking-tight border-b-2 border-black pb-1">
                SYSTEM SPECS
              </h3>
              <ul className="space-y-2 text-xs font-mono font-bold">
                <li>&gt; PLATFORM: MIDNIGHT COMPACT</li>
                <li>&gt; ENGINE: NEXT.JS APP ROUTER</li>
                <li>&gt; PROOF SCHEME: PLONK ZK-SNARK</li>
                <li>&gt; CONTRACT VERIFIER KEY: STOREMESSAGE.VERIFIER</li>
                <li>&gt; RUNTIME: IN-BROWSER FETCHZKCONFIGPROVIDER</li>
              </ul>
            </div>
          </div>

          {/* Interactive Proving/Verifying Operator Block */}
          <div className="lg:col-span-8">
            <CircuitCall midnight={midnight} />
          </div>
        </main>

        {/* Footer */}
        <footer className="border-4 border-black p-6 bg-white text-center font-black uppercase tracking-widest text-xs shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] rounded-none flex flex-col md:flex-row justify-between items-center gap-4">
          <div>
            MIDNIGHT DROP // MOONSHOT HACKATHON SOLUTION
          </div>
          <div className="font-mono font-bold text-[10px] text-neutral-500">
            COMPACT RUNTIME VER. 0.16.0
          </div>
        </footer>
      </div>
    </div>
  );
};

export default App;
