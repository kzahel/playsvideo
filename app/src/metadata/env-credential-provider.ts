import type { MetadataCredentialSlot } from '../db.js';
import { registerRuntimeCredentialProvider } from './runtime-credential-provider.js';

function getToken(slot: MetadataCredentialSlot): string | null {
  const token =
    slot === 'primary'
      ? import.meta.env.VITE_TMDB_READ_ACCESS_TOKEN?.trim()
      : import.meta.env.VITE_TMDB_READ_ACCESS_TOKEN_STANDBY?.trim();
  return token && token.length > 0 ? token : null;
}

export function registerEnvCredentialProvider(): void {
  registerRuntimeCredentialProvider((slot) => {
    const token = getToken(slot);
    return token ? { slot, token } : null;
  });
}
