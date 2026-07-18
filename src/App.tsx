import React from 'react';
import { useMidnight } from './hooks/useMidnight';
import WalletConnect from './components/WalletConnect';
import CircuitCall from './components/CircuitCall';
import './index.css';

export const App: React.FC = () => {
  const midnight = useMidnight();

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="brand">
          <span className="logo-glow"></span>
          <h1>Midnight Drop</h1>
          <span className="badge-preprod">Preprod Testnet</span>
        </div>
        <p className="subtitle">
          A Cryptographic Whistleblower Platform Powered by Zero-Knowledge Proofs
        </p>
      </header>

      <main className="app-main">
        <div className="grid">
          <div className="col">
            <WalletConnect midnight={midnight} />
          </div>
          <div className="col">
            <CircuitCall midnight={midnight} />
          </div>
        </div>
      </main>

      <footer className="app-footer">
        <p>Built on Midnight Network • Compact • Midnight.js SDK</p>
        <p className="copyright">© 2026 Midnight Drop. All rights reserved.</p>
      </footer>
    </div>
  );
};
export default App;
