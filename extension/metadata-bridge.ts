import {
  handleMetadataRequest,
  isMetadataRequestEnvelope,
  toMetadataErrorResponse,
} from '../app/src/metadata/protocol-handler.js';

export function registerMetadataBridge(): void {
  chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (!isMetadataRequestEnvelope(message)) {
      return undefined;
    }

    void handleMetadataRequest(message)
      .then((response) => sendResponse(response))
      .catch((error) => sendResponse(toMetadataErrorResponse(message.id, error)));

    return true;
  });
}
