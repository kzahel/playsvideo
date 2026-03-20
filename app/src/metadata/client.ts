import { TMDB_READ_ACCESS_TOKEN_KEY } from './settings.js';
import { sendMetadataRequest } from './host.js';
import type {
  MetadataClient,
  RefreshCatalogMetadataOptions,
  RefreshSeriesSeasonsOptions,
} from './types.js';
import type {
  MetadataGetTransportStateSuccess,
  MetadataInvalidateSuccess,
  MetadataRefreshCatalogSuccess,
  MetadataRefreshSeriesSeasonsSuccess,
} from './protocol.js';
import type { MetadataTransportStateEntry } from '../db.js';

export const metadataClient: MetadataClient = {
  refreshCatalogMetadata(options?: RefreshCatalogMetadataOptions): Promise<void> {
    return sendMetadataRequest<MetadataRefreshCatalogSuccess>({
      type: 'metadata:refresh-catalog',
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
export type { MetadataClient, RefreshCatalogMetadataOptions, RefreshSeriesSeasonsOptions };

export function refreshCatalogMetadata(options?: RefreshCatalogMetadataOptions): Promise<void> {
  return metadataClient.refreshCatalogMetadata(options);
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
