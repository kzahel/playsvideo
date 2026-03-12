import type { LibraryEntry } from '../db.js';

export interface RefreshLibraryMetadataOptions {
  entries?: LibraryEntry[];
  force?: boolean;
}

export interface MetadataClient {
  refreshLibraryMetadata(options?: RefreshLibraryMetadataOptions): Promise<void>;
}
