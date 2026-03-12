import { isExtension } from '../context.js';
import {
  TMDB_READ_ACCESS_TOKEN_KEY,
  directTmdbMetadataClient,
  refreshLibraryMetadata as refreshLibraryMetadataDirect,
} from './direct-tmdb.js';
import type { MetadataClient, RefreshLibraryMetadataOptions } from './types.js';
import type {
  MetadataRefreshLibrarySuccess,
  MetadataRequestEnvelope,
  MetadataResponseEnvelope,
} from '../../../src/metadata-protocol.js';
import { isMetadataErrorResponse } from '../../../src/metadata-protocol.js';

export const metadataClient: MetadataClient = {
  refreshLibraryMetadata(options?: RefreshLibraryMetadataOptions): Promise<void> {
    if (!isExtension()) {
      return directTmdbMetadataClient.refreshLibraryMetadata(options);
    }

    return sendExtensionMetadataRequest<MetadataRefreshLibrarySuccess>({
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

async function sendExtensionMetadataRequest<TMessage extends MetadataResponseEnvelope['message']>(
  message: MetadataRequestEnvelope['message'],
): Promise<TMessage> {
  if (!chrome?.runtime?.sendMessage) {
    throw new Error('Chrome runtime messaging is unavailable');
  }

  const response = await chrome.runtime.sendMessage({
    id: crypto.randomUUID(),
    message,
  } satisfies MetadataRequestEnvelope);

  if (!response || typeof response !== 'object') {
    throw new Error('Metadata bridge returned an invalid response');
  }

  const envelope = response as MetadataResponseEnvelope;
  if (isMetadataErrorResponse(envelope)) {
    throw new Error(envelope.message.message);
  }

  return envelope.message as TMessage;
}
