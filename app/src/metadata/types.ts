import type { LibraryEntry, MetadataTransportStateEntry } from '../db.js';

export interface RefreshLibraryMetadataOptions {
  entries?: LibraryEntry[];
  force?: boolean;
}

export interface MetadataClient {
  refreshLibraryMetadata(options?: RefreshLibraryMetadataOptions): Promise<void>;
  getTransportState(): Promise<MetadataTransportStateEntry[]>;
}
