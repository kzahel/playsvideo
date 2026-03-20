import type { CatalogEntry, MetadataTransportStateEntry } from '../db.js';

export interface RefreshCatalogMetadataOptions {
  entries?: CatalogEntry[];
  force?: boolean;
}

export type MetadataRequestTier = 'essential' | 'nice-to-have';

export interface RefreshSeriesSeasonsOptions {
  seriesKey: string;
  force?: boolean;
  seasonNumbers?: number[];
}

export function buildSeasonMetadataCacheKey(seriesKey: string, seasonNumber: number): string {
  return `tv-season:${seriesKey}:${seasonNumber}`;
}

export interface MetadataClient {
  refreshCatalogMetadata(options?: RefreshCatalogMetadataOptions): Promise<void>;
  refreshSeriesSeasons(options: RefreshSeriesSeasonsOptions): Promise<void>;
  invalidateMetadata(keys?: string[]): Promise<void>;
  getTransportState(): Promise<MetadataTransportStateEntry[]>;
}
