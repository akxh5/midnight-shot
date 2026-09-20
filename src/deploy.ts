/**
 * Deploy mn-demo contract to a Midnight network (undeployed by default; use --network preview|preprod for public networks).
 *
 * Non-interactive: scaffold → npm run setup runs straight through.
 * No readline prompts, no .midnight-seed file.
 */
import { resolveNetwork, getOrCreateSeed, recordDeployment } from './network';
import { createWallet, persistWalletState, unshieldedToken, type WalletContext } from './wallet';
import { WebSocket } from 'ws';
import * as Rx from 'rxjs';

// Midnight SDK imports
import { deployContract } from '@midnight-ntwrk/midnight-js-contracts';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { EMPTY_DISCLOSURE_PRIVATE_STATE } from './disclosure-witnesses';
import {
  DISCLOSURE_PRIVATE_STATE_ID,
  DISCLOSURE_PRIVATE_STATE_STORE_NAME,
  resolveDisclosureZkConfigPath,
  loadCompiledDisclosureContract,
} from './disclosure-contract';

// @ts-expect-error Required for wallet sync
globalThis.WebSocket = WebSocket;

// ─── Network configuration ─────────────────────────────────────────────────────
//
// Resolved from --network flag, .midnight-state.json, or defaulting to
// 'undeployed' (local devnet). Switch networks with: npm run network <name>

const { network, config: networkConfig } = resolveNetwork();
const SEED = getOrCreateSeed(network);

// Set explicitly here, before any provider is constructed or any address is
// parsed below — don't rely on createWallet() doing this as an internal side
// effect three calls deep in main(). (It does too, redundantly — setNetworkId
// is idempotent — but this call site shouldn't depend on that.)
setNetworkId(networkConfig.networkId);

// ─── Proof server readiness ────────────────────────────────────────────────────
//
// The proof-server image is distroless and has no shell, so it can't run a
// container-side healthcheck. Poll it from the host before we submit anything
// that needs proofs.

async function waitForProofServer(maxAttempts = 60, delayMs = 2000): Promise<boolean> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await fetch(networkConfig.proofServer, {
        method: 'GET',
        signal: AbortSignal.timeout(3000),
      });
      return true;
    } catch (err: any) {
      const code = err?.cause?.code || err?.code || '';
      if (code !== 'ECONNREFUSED' && code !== 'UND_ERR_CONNECT_TIMEOUT' && code !== 'UND_ERR_SOCKET') {
        return true;
      }
    }
    if (attempt < maxAttempts) {
      process.stdout.write(`\r  Waiting for proof server... (${attempt}/${maxAttempts})   `);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return false;
}

// ─── Compiled contract loading ─────────────────────────────────────────────────

const zkConfigPath = resolveDisclosureZkConfigPath(import.meta.url);
let compiledContract: any;
try {
  ({ compiledContract } = await loadCompiledDisclosureContract(zkConfigPath));
} catch (err: any) {
  console.error(`\n❌ ${err.message}\n`);
  process.exit(1);
}

// ─── Providers ─────────────────────────────────────────────────────────────────

async function createProviders(walletCtx: WalletContext) {
  // The SDK requires the private-state password to be at least 16 characters.
  // The default below is a placeholder for local devnet only — set a strong
  // password via PRIVATE_STATE_PASSWORD when you move to a non-local target.
  const privateStatePassword = process.env.PRIVATE_STATE_PASSWORD?.trim() || 'Local-Devnet-Development-Placeholder-1';
  const state = await waitForDeployReadyState(walletCtx.wallet);

  const walletProvider = {
    getCoinPublicKey: () => state.shielded.coinPublicKey.toHexString(),
    getEncryptionPublicKey: () => state.shielded.encryptionPublicKey.toHexString(),
    async balanceTx(tx: any, ttl?: Date) {
      const recipe = await walletCtx.wallet.balanceUnboundTransaction(
        tx,
        { shieldedSecretKeys: walletCtx.shieldedSecretKeys, dustSecretKey: walletCtx.dustSecretKey },
        { ttl: ttl ?? new Date(Date.now() + 30 * 60 * 1000) },
      );
      const signedRecipe = await walletCtx.wallet.signRecipe(recipe, (payload) =>
        walletCtx.unshieldedKeystore.signData(payload),
      );
      return walletCtx.wallet.finalizeRecipe(signedRecipe);
    },
    submitTx: (tx: any) => walletCtx.wallet.submitTransaction(tx) as any,
  };

  const zkConfigProvider = new NodeZkConfigProvider(zkConfigPath);
  const accountId = walletCtx.unshieldedKeystore.getBech32Address().toString();

  return {
    privateStateProvider: levelPrivateStateProvider({
      privateStateStoreName: DISCLOSURE_PRIVATE_STATE_STORE_NAME,
      accountId,
      privateStoragePasswordProvider: () => privateStatePassword,
    }),
    publicDataProvider: indexerPublicDataProvider(networkConfig.indexer, networkConfig.indexerWS),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(networkConfig.proofServer, zkConfigProvider),
    walletProvider,
    midnightProvider: walletProvider,
  };
}

// ─── Deploy-scoped sync wait (skips the shielded rail) ─────────────────────────
//
// wallet.waitForSyncedState() requires ALL THREE rails — shielded, unshielded,
// and dust — to independently reach strict completeness before it resolves
// (wallet-sdk-facade's FacadeState.isSynced ANDs all three; verified by
// reading dist/index.js, not just the .d.ts). This deploy never spends or
// receives shielded (Zswap) coins — the constructor is paid for with an
// unshielded NIGHT UTXO and generated DUST only — but the shielded rail's
// full-chain trial-decryption is exactly what OOM-crashed this process
// (observed: 3.3GB, 2.1GB+, and 9.9GB against a 12GB cap, across three runs).
// Wait only on the two rails this deploy actually touches.

const rawSyncTimeout = Number(process.env.MIDNIGHT_SYNC_TIMEOUT_MS);
const SYNC_TIMEOUT_MS = Number.isFinite(rawSyncTimeout) && rawSyncTimeout > 0 ? rawSyncTimeout : 300_000;

async function waitForDeployReadyState(wallet: WalletContext['wallet']) {
  const start = Date.now();
  let lastLine = '';
  try {
    return await Rx.firstValueFrom(
      wallet.state().pipe(
        Rx.tap((s) => {
          const u = s.unshielded.progress;
          const d = s.dust.state.progress;
          const elapsed = Math.round((Date.now() - start) / 1000);
          // Note: these two SyncProgress types aren't the same shape — the
          // unshielded wallet's is package-local (appliedId/highestTransactionId),
          // the dust wallet's comes from wallet-sdk-abstractions
          // (appliedIndex/highestIndex). Caught by tsc, not assumed.
          const line =
            `unshielded ${u.appliedId}/${u.highestTransactionId}${u.isStrictlyComplete() ? ' ✓' : ''}` +
            `  ·  dust ${d.appliedIndex}/${d.highestIndex}${d.isStrictlyComplete() ? ' ✓' : ''}`;
          if (line !== lastLine) {
            process.stdout.write(`\r  ⏳ [${elapsed}s] ${line}                    `);
            lastLine = line;
          }
        }),
        Rx.filter((s) => s.unshielded.progress.isStrictlyComplete() && s.dust.state.progress.isStrictlyComplete()),
        Rx.timeout(SYNC_TIMEOUT_MS),
      ),
    );
  } catch (err: any) {
    if (err?.name === 'TimeoutError') {
      throw new Error(
        `Timed out after ${Math.round(SYNC_TIMEOUT_MS / 1000)}s waiting for unshielded+dust sync ` +
          `(shielded sync is intentionally skipped — see comment above). ` +
          `Last observed progress: ${lastLine || 'none — no state emitted at all'}. ` +
          `Override with MIDNIGHT_SYNC_TIMEOUT_MS if the network is just slow.`,
      );
    }
    throw err;
  } finally {
    process.stdout.write('\n');
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log(`║  Deploy mn-demo to ${network}`);
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  const seed = SEED;

  console.log('─── Wallet setup ───────────────────────────────────────────────\n');
  console.log('  Creating wallet...');
  const walletCtx = await createWallet({ network, networkConfig, seed });
  const restoredCount = Object.values(walletCtx.restored).filter(Boolean).length;
  if (restoredCount > 0) {
    console.log(`  Restored ${restoredCount}/3 child wallets from .midnight-wallet-state — sync will resume from saved point.`);
  }

  console.log('  Syncing with network (unshielded + dust only — shielded sync is skipped, see waitForDeployReadyState)...');
  console.log('  ℹ  This may take a while depending on network size.');
  console.log('     RPC disconnection messages during sync are normal and can be safely ignored.\n');
  const state = await waitForDeployReadyState(walletCtx.wallet);
  console.log('  ✓ Unshielded + dust synced.');

  // Persist sync state now so a later deploy failure doesn't waste the sync work.
  await persistWalletState(network, walletCtx);

  const address = walletCtx.unshieldedKeystore.getBech32Address();
  let balance = state.unshielded.balances[unshieldedToken().raw] ?? 0n;
  console.log(`\n  Wallet Address: ${address}`);
  console.log(`  Balance: ${balance.toLocaleString()} tNight\n`);

  if (network === 'undeployed' && balance === 0n) {
    console.error(
      '\n❌ Genesis-seed wallet has zero NIGHT. The devnet preset may not have minted to it.\n' +
        '   Check `docker compose ps` and `docker compose logs node`. Then `docker compose down -v` and retry.\n',
    );
    await walletCtx.wallet.stop();
    process.exit(1);
  }

  // Faucet poll for public networks. The wallet has 0 tNIGHT until the user
  // funds the address from the network's faucet. The display balance is
  // authoritative here (unlike DUST, tNIGHT shows up immediately once the
  // faucet tx lands).
  if (network !== 'undeployed' && networkConfig.faucet) {
    // Same balance idiom used by check-balance.ts:
    //   state.unshielded.balances[unshieldedToken().raw] ?? 0n
    const initialBalance = await Rx.firstValueFrom(walletCtx.wallet.state().pipe(
      Rx.filter((s) => s.isSynced),
    ));
    const initialTNight = initialBalance.unshielded.balances[unshieldedToken().raw] ?? 0n;
    if (initialTNight === 0n) {
      console.log('─── Fund Wallet ────────────────────────────────────────────────\n');
      console.log(`  Wallet address: ${address}`);
      console.log(`  Faucet:         ${networkConfig.faucet}`);
      console.log('');
      console.log('  Waiting for tNIGHT to arrive (poll every 10s)...');
      const rawTimeout = Number(process.env.MIDNIGHT_FAUCET_TIMEOUT_MS);
      const timeoutMs = Number.isFinite(rawTimeout) && rawTimeout > 0 ? rawTimeout : 600_000;
      const start = Date.now();
      while (true) {
        await new Promise((r) => setTimeout(r, 10_000));
        const s = await Rx.firstValueFrom(walletCtx.wallet.state().pipe(Rx.filter((x) => x.isSynced)));
        const tn = s.unshielded.balances[unshieldedToken().raw] ?? 0n;
        if (tn > 0n) {
          console.log(`\n  Funded! tNIGHT balance: ${tn.toLocaleString()}\n`);
          break;
        }
        if (Date.now() - start > timeoutMs) {
          console.log(`\n  ❌ Funding not received within ${Math.round(timeoutMs / 60_000)} min.`);
          console.log(`  Address: ${address}`);
          console.log(`  Faucet:  ${networkConfig.faucet}`);
          console.log('  Re-run setup after funding — your seed is preserved.\n');
          await walletCtx.wallet.stop();
          process.exit(1);
        }
        const elapsed = Math.round((Date.now() - start) / 1000);
        process.stdout.write(`\r  ...still waiting (${elapsed}s elapsed)`);
      }
    }
  }

  // Register for DUST.
  console.log('─── DUST Token Setup ───────────────────────────────────────────\n');
  const dustState = await Rx.firstValueFrom(walletCtx.wallet.state().pipe(Rx.filter((s) => s.isSynced)));

  const unregisteredUtxos = dustState.unshielded.availableCoins.filter(
    (c: any) => !c.meta?.registeredForDustGeneration,
  );
  if (unregisteredUtxos.length > 0) {
    console.log(`  Registering ${unregisteredUtxos.length} NIGHT UTXOs for DUST generation...`);
    // The signDustRegistration callback (3rd arg) already produces a recipe
    // with N signatures matching N inputs. Do NOT call signRecipe again — that
    // would double-sign and the chain rejects with InputsSignaturesLengthMismatch
    // (Custom error 192). Matches upstream example-counter and example-bboard.
    const recipe = await walletCtx.wallet.registerNightUtxosForDustGeneration(
      unregisteredUtxos,
      walletCtx.unshieldedKeystore.getPublicKey(),
      (payload) => walletCtx.unshieldedKeystore.signData(payload),
    );
    const finalized = await walletCtx.wallet.finalizeRecipe(recipe);
    await walletCtx.wallet.submitTransaction(finalized);
  }

  if (dustState.dust.balance(new Date()) === 0n) {
    console.log('  Waiting for DUST tokens...');
    await Rx.firstValueFrom(
      walletCtx.wallet.state().pipe(
        Rx.throttleTime(5000),
        Rx.filter((s) => s.isSynced),
        Rx.filter((s) => s.dust.balance(new Date()) > 0n),
      ),
    );
  }
  console.log('  DUST tokens ready!\n');

  // Deploy.
  console.log('─── Deploy Contract ────────────────────────────────────────────\n');

  console.log('  Checking proof server...');
  const proofServerReady = await waitForProofServer();
  if (!proofServerReady) {
    console.log('\n  ❌ Proof server not responding. Run: docker compose up -d\n');
    await walletCtx.wallet.stop();
    process.exit(1);
  }
  process.stdout.write('\r  Proof server ready!                                 \n');

  console.log('  Setting up providers...');
  const providers = await createProviders(walletCtx);

  // The wallet's reported DUST balance is a *time-projection* of what its
  // registered NIGHT will eventually generate; the tx-builder spends only
  // what the next block's timestamp accounts for, which lags wall-clock by
  // ~1 block on a fresh devnet. Sleeping ~1 block-time before attempt 1
  // closes that gap in the common case; the retry loop covers outliers.
  process.stdout.write('  Generating DUST...');
  await new Promise((r) => setTimeout(r, 6000));
  process.stdout.write(' done.\n');

  console.log('  Deploying contract...\n');

  // Fallback timing. The 6s pre-pause above handles the common case; this
  // loop covers genuine outliers (slow blocks, proof-server worker-pool
  // settling). Earlier 2s retries caused CI flakes where attempt 2's /prove
  // hit the proof-server before it had drained attempt 1's state — 5s gives
  // it room to settle between attempts. 20 × 5 = 100s total budget.
  const MAX_RETRIES = 20;
  const RETRY_DELAY_MS = 5000;
  let deployed: Awaited<ReturnType<typeof deployContract>> | undefined;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      deployed = await deployContract(providers, {
        compiledContract: compiledContract as any,
        args: [],
        privateStateId: DISCLOSURE_PRIVATE_STATE_ID,
        initialPrivateState: EMPTY_DISCLOSURE_PRIVATE_STATE,
      });
      break;
    } catch (err: any) {
      const errMsg = err?.message || err?.toString() || '';
      const errCause = err?.cause?.message || err?.cause?.toString() || '';
      const fullError = `${errMsg} ${errCause}`;

      // DUST shortage is the most common transient failure on a fresh devnet —
      // check it BEFORE proof-server connectivity, because dust-balancing errors
      // can surface through proof-server-shaped messages (the wallet talks to
      // the proof-server while building the dust portion of the tx).
      const isDustShortage =
        fullError.includes('Not enough Dust') ||
        fullError.includes('Insufficient Funds') ||
        fullError.includes('could not balance dust');

      // Quiet the first DUST-shortage retry: it's the expected race between
      // wall-clock projection and block-timestamp accounting and the loud
      // `Insufficient Funds: <huge number>` message scares first-time users.
      // Real failures still get the full diagnostic from attempt 2 onward.
      if (!(isDustShortage && attempt === 1)) {
        console.error(`\n  Attempt ${attempt} error: ${errMsg}`);
        if (errCause && errCause !== errMsg) console.error(`  Cause: ${errCause}`);
      }

      if (
        !isDustShortage &&
        (fullError.includes('Failed to connect to Proof Server') ||
          fullError.includes('connect ECONNREFUSED 127.0.0.1:6300'))
      ) {
        console.log('  ❌ Proof server unreachable. Run: docker compose up -d\n');
        await walletCtx.wallet.stop();
        process.exit(1);
      }

      if (isDustShortage) {
        const currentState = await waitForDeployReadyState(walletCtx.wallet);
        const dustBalance = currentState.dust.balance(new Date());
        if (attempt < MAX_RETRIES) {
          if (attempt === 1) {
            console.log(`  Still generating DUST, retrying in ${RETRY_DELAY_MS / 1000}s...`);
          } else {
            console.log(`  ⏳ DUST balance: ${dustBalance.toLocaleString()} (attempt ${attempt}/${MAX_RETRIES}); retrying in ${RETRY_DELAY_MS / 1000}s...`);
          }
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        } else {
          console.log(`  ❌ Not enough DUST after ${MAX_RETRIES} retries (current: ${dustBalance.toLocaleString()})`);
          await walletCtx.wallet.stop();
          process.exit(1);
        }
      } else {
        throw err;
      }
    }
  }

  if (!deployed) throw new Error('Deployment failed after all retries');

  const contractAddress = deployed.deployTxData.public.contractAddress;
  console.log('  ✅ Contract deployed successfully!\n');
  console.log(`  Contract Address: ${contractAddress}\n`);

  recordDeployment(network, contractAddress, address.toString());
  console.log('  Saved to .midnight-state.json\n');

  await persistWalletState(network, walletCtx);
  await walletCtx.wallet.stop();
  console.log('─── Deployment complete ────────────────────────────────────────\n');
  console.log('  Next: npm run cli\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
