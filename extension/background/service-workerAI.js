// service-worker.js
//
// Purpose: the ONLY part of the extension allowed to (a) call chrome.tabs.*
// APIs and (b) make network requests to the backend. Content scripts message
// this worker instead of doing either directly:
//
//   - CAPTURE_TAB: takes a screenshot of the visible tab (used to crop raster
//     chart images without ever loading them into a same-page <img>/<canvas>,
//     which would risk cross-origin canvas tainting).
//   - ANALYZE_CANDIDATE: forwards one candidate's context (+ optional image)
//     to the local backend, which holds the Gemini API key. The key never
//     exists anywhere in the extension's own code.
//
// Used by: content.js.

const BACKEND_URL = 'http://localhost:8787';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'CAPTURE_TAB') {
    const windowId = sender.tab ? sender.tab.windowId : chrome.windows.WINDOW_ID_CURRENT;
    chrome.tabs.captureVisibleTab(windowId, { format: 'png' }, (dataUrl) => {
      if (chrome.runtime.lastError) {
        sendResponse({ error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ dataUrl });
      }
    });
    return true;
  }

  if (message.type === 'ANALYZE_CANDIDATE') {
    (async () => {
      try {
        const response = await fetch(`${BACKEND_URL}/analyze`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(message.payload)
        });
        const json = await response.json();
        if (!response.ok) {
          sendResponse({ error: json.error || `Backend returned HTTP ${response.status}` });
          return;
        }
        sendResponse({ data: json });
      } catch (err) {
        sendResponse({ error: `Could not reach backend at ${BACKEND_URL}. Is it running? (${err.message})` });
      }
    })();
    return true;
  }

  return false;
});
