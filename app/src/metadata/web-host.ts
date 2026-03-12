import type {
  MetadataRequestEnvelope,
  MetadataResponseEnvelope,
} from '../../../src/metadata-protocol.js';
import { isMetadataErrorResponse } from '../../../src/metadata-protocol.js';
import { getActiveAppServiceWorker } from '../service-worker.js';

export async function sendWebMetadataRequest<TMessage extends MetadataResponseEnvelope['message']>(
  message: MetadataRequestEnvelope['message'],
): Promise<TMessage> {
  const worker = await getActiveAppServiceWorker();

  const envelope = await new Promise<MetadataResponseEnvelope>((resolve, reject) => {
    const channel = new MessageChannel();
    const timeout = window.setTimeout(() => {
      reject(new Error('Metadata service worker timed out'));
    }, 15_000);

    channel.port1.onmessage = (event) => {
      window.clearTimeout(timeout);
      resolve(event.data as MetadataResponseEnvelope);
    };
    channel.port1.onmessageerror = () => {
      window.clearTimeout(timeout);
      reject(new Error('Metadata service worker returned an invalid response'));
    };

    worker.postMessage(
      {
        id: crypto.randomUUID(),
        message,
      } satisfies MetadataRequestEnvelope,
      [channel.port2],
    );
  });

  if (isMetadataErrorResponse(envelope)) {
    throw new Error(envelope.message.message);
  }

  return envelope.message as TMessage;
}
