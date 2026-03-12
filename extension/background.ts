import { registerEnvCredentialProvider } from '../app/src/metadata/env-credential-provider.js';
import { registerMetadataBridge } from './metadata-bridge.js';

registerEnvCredentialProvider();
registerMetadataBridge();

chrome.action.onClicked.addListener(() => {
  chrome.windows.create({
    url: chrome.runtime.getURL('index.html'),
    type: 'popup',
    width: 1280,
    height: 800,
  });
});
