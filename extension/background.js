// Service worker — minimal. State and logic live in the content script.
// Listens for messages from the popup to open the live page or relay settings.

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'openLivePage') {
    const url = msg.serverUrl
      ? msg.serverUrl.replace(/^ws/, 'http').replace('/ws/live', '/live')
      : 'http://localhost:5000/live';
    chrome.tabs.create({ url });
    sendResponse({ ok: true });
  }
  return false;
});
