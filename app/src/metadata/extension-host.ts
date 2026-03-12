import type {
  MetadataRequestEnvelope,
  MetadataResponseEnvelope,
} from '../../../src/metadata-protocol.js';
import { isMetadataErrorResponse } from '../../../src/metadata-protocol.js';

export async function sendExtensionMetadataRequest<TMessage extends MetadataResponseEnvelope['message']>(
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
