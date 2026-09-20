/**
 * Shared "load the compiled disclosure contract" logic for every Node-side
 * script that talks to it (deploy, cli, e2e-check, preflight). Centralized so
 * the contract path, tag, and witness wiring can't drift between scripts the
 * way hello-world's did across deploy.ts/cli.ts/e2e-check.ts.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import { makeDisclosureWitnesses } from './disclosure-witnesses';

export const DISCLOSURE_PRIVATE_STATE_ID = 'disclosure-private-state';
export const DISCLOSURE_PRIVATE_STATE_STORE_NAME = 'disclosure-state';

/** Resolves contracts/managed/disclosure relative to a caller one directory below repo root (src/*.ts or scripts/*.ts). */
export function resolveDisclosureZkConfigPath(importMetaUrl: string): string {
  const callerDir = path.dirname(fileURLToPath(importMetaUrl));
  return path.resolve(callerDir, '..', 'contracts', 'managed', 'disclosure');
}

export interface LoadedDisclosureContract {
  Disclosure: any;
  compiledContract: any;
  zkConfigPath: string;
  contractPath: string;
}

export async function loadCompiledDisclosureContract(zkConfigPath: string): Promise<LoadedDisclosureContract> {
  const contractPath = path.join(zkConfigPath, 'contract', 'index.js');
  if (!fs.existsSync(contractPath)) {
    throw new Error(`Contract not compiled at ${contractPath}. Run: npm run compile`);
  }

  const Disclosure = await import(pathToFileURL(contractPath).href);

  // `Disclosure` comes from a dynamic import (dynamic so callers can check
  // contracts/managed exists and report a clean error before importing it),
  // so TS sees `Disclosure.Contract` as `any` and can't infer CompiledContract's
  // generic params from it, which breaks inference inside `withWitnesses`'s
  // curried overload. Cast through `any` at each stage rather than fighting
  // inference — verified against the compiler; the runtime shape is correct.
  const compiledContract = (CompiledContract.make('disclosure', Disclosure.Contract) as any).pipe(
    (CompiledContract.withWitnesses as any)(makeDisclosureWitnesses()),
    (CompiledContract.withCompiledFileAssets as any)(zkConfigPath),
  );

  return { Disclosure, compiledContract, zkConfigPath, contractPath };
}
