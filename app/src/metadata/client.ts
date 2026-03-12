import {
  TMDB_READ_ACCESS_TOKEN_KEY,
  directTmdbMetadataClient,
  refreshLibraryMetadata as refreshLibraryMetadataDirect,
} from './direct-tmdb.js';
import { sendMetadataRequest } from './host.js';
import type { MetadataClient, RefreshLibraryMetadataOptions } from './types.js';
import type { MetadataRefreshLibrarySuccess } from '../../../src/metadata-protocol.js';

export const metadataClient: MetadataClient = {
  refreshLibraryMetadata(options?: RefreshLibraryMetadataOptions): Promise<void> {
    return sendMetadataRequest<MetadataRefreshLibrarySuccess>({
      type: 'metadata:refresh-library',
      options,
    }).then(() => undefined);
  },
};

export { TMDB_READ_ACCESS_TOKEN_KEY };
export type { MetadataClient, RefreshLibraryMetadataOptions };

export function refreshLibraryMetadata(options?: RefreshLibraryMetadataOptions): Promise<void> {
  return metadataClient.refreshLibraryMetadata(options);
}

export const directMetadataClient = {
  refreshLibraryMetadata: refreshLibraryMetadataDirect,
};
