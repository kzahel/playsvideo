import {
  TMDB_READ_ACCESS_TOKEN_KEY,
  directTmdbMetadataClient,
  refreshLibraryMetadata as refreshLibraryMetadataDirect,
} from './direct-tmdb.js';
import type { MetadataClient, RefreshLibraryMetadataOptions } from './types.js';

export const metadataClient: MetadataClient = directTmdbMetadataClient;

export { TMDB_READ_ACCESS_TOKEN_KEY };
export type { MetadataClient, RefreshLibraryMetadataOptions };

export function refreshLibraryMetadata(options?: RefreshLibraryMetadataOptions): Promise<void> {
  return metadataClient.refreshLibraryMetadata(options);
}

export const directMetadataClient = {
  refreshLibraryMetadata: refreshLibraryMetadataDirect,
};
