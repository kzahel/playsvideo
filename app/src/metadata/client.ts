import {
  TMDB_READ_ACCESS_TOKEN_KEY,
  directTmdbMetadataClient,
  refreshLibraryMetadata as refreshLibraryMetadataDirect,
} from './direct-tmdb.js';
import { sendMetadataRequest } from './host.js';
import type {
  MetadataClient,
  RefreshLibraryMetadataOptions,
  RefreshSeriesSeasonsOptions,
} from './types.js';
import type {
  MetadataGetTransportStateSuccess,
  MetadataInvalidateSuccess,
  MetadataRefreshLibrarySuccess,
  MetadataRefreshSeriesSeasonsSuccess,
} from '../../../src/metadata-protocol.js';
import type { MetadataTransportStateEntry } from '../db.js';

export const metadataClient: MetadataClient = {
  refreshLibraryMetadata(options?: RefreshLibraryMetadataOptions): Promise<void> {
    return sendMetadataRequest<MetadataRefreshLibrarySuccess>({
      type: 'metadata:refresh-library',
      options,
    }).then(() => undefined);
  },
  refreshSeriesSeasons(options: RefreshSeriesSeasonsOptions): Promise<void> {
    return sendMetadataRequest<MetadataRefreshSeriesSeasonsSuccess>({
      type: 'metadata:refresh-series-seasons',
      options,
    }).then(() => undefined);
  },
  invalidateMetadata(keys?: string[]): Promise<void> {
    return sendMetadataRequest<MetadataInvalidateSuccess>({
      type: 'metadata:invalidate',
      keys,
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

export function refreshSeriesSeasons(options: RefreshSeriesSeasonsOptions): Promise<void> {
  return metadataClient.refreshSeriesSeasons(options);
}

export function invalidateMetadata(keys?: string[]): Promise<void> {
  return metadataClient.invalidateMetadata(keys);
}

export function getMetadataTransportState(): Promise<MetadataTransportStateEntry[]> {
  return metadataClient.getTransportState();
}

export const directMetadataClient = {
  refreshLibraryMetadata: refreshLibraryMetadataDirect,
};
