import {
  TMDB_READ_ACCESS_TOKEN_KEY,
  directTmdbMetadataClient,
  refreshLibraryMetadata as refreshLibraryMetadataDirect,
} from './direct-tmdb.js';
import { sendMetadataRequest } from './host.js';
import type { MetadataClient, RefreshLibraryMetadataOptions } from './types.js';
import type {
  MetadataGetTransportStateSuccess,
  MetadataRefreshLibrarySuccess,
} from '../../../src/metadata-protocol.js';
import type { MetadataTransportStateEntry } from '../db.js';

export const metadataClient: MetadataClient = {
  refreshLibraryMetadata(options?: RefreshLibraryMetadataOptions): Promise<void> {
    return sendMetadataRequest<MetadataRefreshLibrarySuccess>({
      type: 'metadata:refresh-library',
      options,
    }).then(() => undefined);
  },
  getTransportState(): Promise<MetadataTransportStateEntry[]> {
    return sendMetadataRequest<MetadataGetTransportStateSuccess>({
      type: 'metadata:get-transport-state',
      transport: 'direct',
    }).then((response) => response.entries);
  },
};

export { TMDB_READ_ACCESS_TOKEN_KEY };
export type { MetadataClient, RefreshLibraryMetadataOptions };

export function refreshLibraryMetadata(options?: RefreshLibraryMetadataOptions): Promise<void> {
  return metadataClient.refreshLibraryMetadata(options);
}

export function getMetadataTransportState(): Promise<MetadataTransportStateEntry[]> {
  return metadataClient.getTransportState();
}

export const directMetadataClient = {
  refreshLibraryMetadata: refreshLibraryMetadataDirect,
};
