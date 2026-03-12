import { isExtension } from '../context.js';
import type {
  MetadataRequestEnvelope,
  MetadataResponseEnvelope,
} from './protocol.js';
import { sendExtensionMetadataRequest } from './extension-host.js';
import { sendWebMetadataRequest } from './web-host.js';

export function sendMetadataRequest<TMessage extends MetadataResponseEnvelope['message']>(
  message: MetadataRequestEnvelope['message'],
): Promise<TMessage> {
  if (isExtension()) {
    return sendExtensionMetadataRequest<TMessage>(message);
  }

  return sendWebMetadataRequest<TMessage>(message);
}
