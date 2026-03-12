import type {
  MetadataRequestEnvelope,
  MetadataResponseEnvelope,
} from '../../../src/metadata-protocol.js';
import { handleMetadataRequest } from './protocol-handler.js';
import { isMetadataErrorResponse } from '../../../src/metadata-protocol.js';

export async function sendWebMetadataRequest<TMessage extends MetadataResponseEnvelope['message']>(
  message: MetadataRequestEnvelope['message'],
): Promise<TMessage> {
  const envelope = await handleMetadataRequest({
    id: crypto.randomUUID(),
    message,
  } satisfies MetadataRequestEnvelope);

  if (isMetadataErrorResponse(envelope)) {
    throw new Error(envelope.message.message);
  }

  return envelope.message as TMessage;
}
