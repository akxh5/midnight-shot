/**
 * Pre-flight check for `npm run setup -- --network preprod` / `npm run deploy`.
 *
 * Exercises everything the real deploy path does EXCEPT the parts that need
 * Docker (the local proof server) or an actual funded, synced wallet:
 *   1. Compiles contracts/disclosure.compact fresh, against the installed toolchain.
 *   2. Loads the compiled contract + attaches disclosure-witnesses.ts, via the
 *      exact same helper (src/disclosure-contract.ts) deploy.ts/cli.ts/e2e-check.ts use.
 *   3. Sets the network id explicitly and confirms it actually took.
 *   4. Round-trips the disclosureSecret witness end-to-end (salt → hash →
 *      pending-call handoff → witness invocation → private-state update),
 *      the same code path a real submitDisclosure call runs.
 *   5. Constructs every provider deployContract() needs (indexer, zk config,
 *      proof provider client, private state provider) — construction only,
 *      no proof-server or chain I/O.
 *   6. Derives a throwaway keystore and encodes its address, exercising the
 *      same network-id-dependent address encoding path createWallet() uses,
 *      without touching the real wallet seed or .midnight-state.json.
 *
 * Run: npx tsx scripts/preflight-deploy.ts [--network preprod]
 * Exits non-zero and prints exactly which step failed.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';

import { setNetworkId, getNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { sampleContractAddress } from '@midnight-ntwrk/compact-runtime';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { HDWallet, Roles } from '@midnight-ntwrk/wallet-sdk-hd';
import { createKeystore } from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';

import { resolveNetwork } from '../src/network';
import {
  DISCLOSURE_PRIVATE_STATE_ID,
  DISCLOSURE_PRIVATE_STATE_STORE_NAME,
  resolveDisclosureZkConfigPath,
  loadCompiledDisclosureContract,
} from '../src/disclosure-contract';
import {
  makeDisclosureWitnesses,
  prepareSubmission,
  setPendingSubmit,
  EMPTY_DISCLOSURE_PRIVATE_STATE,
} from '../src/disclosure-witnesses';

let stepNum = 0;
function step(name: string): void {
  stepNum += 1;
  process.stdout.write(`\n[${stepNum}] ${name}\n`);
}
function ok(msg: string): void {
  process.stdout.write(`    ✓ ${msg}\n`);
}
function fail(step: string, err: unknown): never {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`\n❌ Pre-flight FAILED at: ${step}\n   ${msg}\n`);
  if (err instanceof Error && err.stack) {
    process.stderr.write(`\n${err.stack}\n`);
  }
  process.exit(1);
}

async function main() {
  const { network, config: networkConfig } = resolveNetwork({ argv: process.argv });
  process.stdout.write(`Pre-flighting the deploy path for network: ${network}\n`);
  if (network !== 'preprod') {
    process.stdout.write(
      `⚠ Target network is "${network}", not "preprod". Pass --network preprod to check the actual deploy target.\n`,
    );
  }

  // ── 1. Compile fresh ────────────────────────────────────────────────────
  step('Compile contracts/disclosure.compact against the installed toolchain');
  try {
    execFileSync('compact', ['compile', 'contracts/disclosure.compact', 'contracts/managed/disclosure'], {
      stdio: 'pipe',
    });
    ok('compactc compiled disclosure.compact with no errors');
  } catch (err: any) {
    fail('compile', new Error(err.stderr?.toString() || err.stdout?.toString() || err.message));
  }

  // ── 2. Load compiled contract + attach witnesses ────────────────────────
  step('Load the compiled contract and attach disclosure-witnesses.ts');
  const zkConfigPath = resolveDisclosureZkConfigPath(import.meta.url);
  let compiledContract: any;
  try {
    ({ compiledContract } = await loadCompiledDisclosureContract(zkConfigPath));
    if (!compiledContract) throw new Error('loadCompiledDisclosureContract returned no compiledContract');
    ok(`Loaded from ${zkConfigPath}`);
    ok('CompiledContract.make → withWitnesses(makeDisclosureWitnesses()) → withCompiledFileAssets: no errors');
  } catch (err) {
    fail('contract load / witness attach', err);
  }

  // ── 3. Network id ────────────────────────────────────────────────────────
  step('Set and verify the global network id — before any provider or address code');
  try {
    setNetworkId(networkConfig.networkId);
    const got = getNetworkId();
    if (got !== networkConfig.networkId) {
      throw new Error(`setNetworkId('${networkConfig.networkId}') did not stick — getNetworkId() returned '${got}'`);
    }
    ok(`getNetworkId() === '${got}'`);
  } catch (err) {
    fail('setNetworkId', err);
  }

  // ── 4. Witness round-trip ───────────────────────────────────────────────
  step('Round-trip the disclosureSecret witness (salt → hash → handoff → invoke)');
  try {
    const witnesses = makeDisclosureWitnesses();
    const { secret, record } = await prepareSubmission('preflight dry-run message — never submitted anywhere');
    setPendingSubmit(secret, record);

    const fakeContext = {
      ledger: {} as any,
      privateState: EMPTY_DISCLOSURE_PRIVATE_STATE,
      contractAddress: 'preflight-dummy-address' as any,
    };
    const [nextPrivateState, returnedSecret] = witnesses.disclosureSecret(fakeContext);

    if (!(returnedSecret instanceof Uint8Array) || returnedSecret.length !== 32) {
      throw new Error(`witness returned a value that isn't a 32-byte Uint8Array: ${returnedSecret}`);
    }
    if (Buffer.from(returnedSecret).toString('hex') !== Buffer.from(secret).toString('hex')) {
      throw new Error('witness returned a different secret than the one queued via setPendingSubmit');
    }
    if (nextPrivateState.disclosures.length !== 1 || nextPrivateState.disclosures[0].commitmentHex !== record.commitmentHex) {
      throw new Error('witness did not append the new disclosure record to private state as expected');
    }
    ok(`disclosureSecret() returned a valid Bytes<32>: ${Buffer.from(returnedSecret).toString('hex').slice(0, 16)}…`);
    ok(`commitment computed: ${record.commitmentHex}`);
    ok('private state updated with the new disclosure record');

    // Confirm the "no pending call" guard actually fires (defensive — this is
    // the failure mode if a caller forgets setPendingSubmit/setPendingProve).
    let guardFired = false;
    try {
      witnesses.disclosureSecret(fakeContext);
    } catch {
      guardFired = true;
    }
    if (!guardFired) throw new Error('calling the witness twice without re-queuing a pending call did not throw');
    ok('calling the witness with no pending call correctly throws (internal-bug guard works)');
  } catch (err) {
    fail('witness round-trip', err);
  }

  // ── 5. Provider construction ────────────────────────────────────────────
  step('Construct every provider deployContract() needs (no proof-server / chain I/O)');
  const tmpDbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'midnight-preflight-'));
  try {
    const publicDataProvider = indexerPublicDataProvider(networkConfig.indexer, networkConfig.indexerWS);
    if (!publicDataProvider) throw new Error('indexerPublicDataProvider returned nullish');
    ok(`indexerPublicDataProvider constructed for ${networkConfig.indexer}`);

    const zkConfigProvider = new NodeZkConfigProvider(zkConfigPath);
    ok(`NodeZkConfigProvider constructed for ${zkConfigPath}`);

    const proofProvider = httpClientProofProvider(networkConfig.proofServer, zkConfigProvider);
    if (!proofProvider) throw new Error('httpClientProofProvider returned nullish');
    ok(`httpClientProofProvider constructed for ${networkConfig.proofServer} (not contacted yet)`);

    const privateStateProvider = levelPrivateStateProvider({
      privateStateStoreName: DISCLOSURE_PRIVATE_STATE_STORE_NAME,
      accountId: 'preflight-check-account',
      privateStoragePasswordProvider: () => 'Preflight-Dry-Run-Placeholder-Password-1',
      midnightDbName: path.join(tmpDbDir, 'midnight-level-db'),
    } as any);
    // The real deploy/findDeployedContract calls setContractAddress()
    // internally before touching private state (confirmed by grepping
    // midnight-js-contracts's dist output) — do the same here with a sample
    // address so this standalone check exercises the provider the same way.
    privateStateProvider.setContractAddress(sampleContractAddress());
    // Exercise a real read against the on-disk store, not just construction.
    const existing = await privateStateProvider.get(DISCLOSURE_PRIVATE_STATE_ID);
    if (existing !== null) throw new Error('expected a fresh temp private-state store to read back null');
    ok('levelPrivateStateProvider constructed and a real get() round-tripped against a throwaway on-disk store');
  } catch (err) {
    fail('provider construction', err);
  } finally {
    fs.rmSync(tmpDbDir, { recursive: true, force: true });
  }

  // ── 6. Address encoding ─────────────────────────────────────────────────
  step('Derive a throwaway keystore and encode its address under the target network id');
  try {
    const seed = randomBytes(32).toString('hex');
    const hdWallet = HDWallet.fromSeed(Buffer.from(seed, 'hex'));
    if (hdWallet.type !== 'seedOk') throw new Error('HDWallet.fromSeed rejected a fresh random 32-byte seed');
    const derived = hdWallet.hdWallet.selectAccount(0).selectRoles([Roles.NightExternal]).deriveKeysAt(0);
    if (derived.type !== 'keysDerived') throw new Error('Key derivation failed for a fresh random seed');
    hdWallet.hdWallet.clear();

    const networkId = getNetworkId();
    const keystore = createKeystore(derived.keys[Roles.NightExternal], networkId as any);
    const address = keystore.getBech32Address().toString();
    if (!address || typeof address !== 'string' || address.length < 10) {
      throw new Error(`Encoded address looks malformed: ${JSON.stringify(address)}`);
    }
    if (!address.toLowerCase().includes(networkId)) {
      process.stdout.write(
        `    ⚠ Encoded address does not visibly contain the network id "${networkId}" — not necessarily wrong, but worth eyeballing: ${address}\n`,
      );
    }
    ok(`Bech32 address encoded under networkId='${networkId}': ${address}`);
  } catch (err) {
    fail('address encoding', err);
  }

  process.stdout.write(
    '\n✅ Pre-flight passed. Everything short of the proof server and a funded/synced wallet is wired correctly.\n' +
      '   Once Docker is up: npm run setup -- --network preprod\n\n',
  );
}

main().catch((err) => fail('unexpected', err));
