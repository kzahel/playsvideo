import type { MetadataCredentialSlot } from '../db.js';
import type { TmdbCredential } from './repository.js';

type RuntimeCredentialProvider = (
  slot: MetadataCredentialSlot,
) => Promise<TmdbCredential | null> | TmdbCredential | null;

let runtimeCredentialProvider: RuntimeCredentialProvider | null = null;

export function registerRuntimeCredentialProvider(provider: RuntimeCredentialProvider): void {
  runtimeCredentialProvider = provider;
}

export async function getRuntimeCredential(
  slot: MetadataCredentialSlot,
): Promise<TmdbCredential | null> {
  return (await runtimeCredentialProvider?.(slot)) ?? null;
}
