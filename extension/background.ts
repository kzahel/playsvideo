import { registerMetadataBridge } from './metadata-bridge.js';

registerMetadataBridge();

chrome.action.onClicked.addListener(() => {
  chrome.windows.create({
    url: chrome.runtime.getURL('index.html'),
    type: 'popup',
    width: 1280,
    height: 800,
  });
});
