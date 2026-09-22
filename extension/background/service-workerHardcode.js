// service-worker.js  (HARDCODE PIPELINE — no AI involved)
//
// The hardcoded pipeline makes no network calls at all, so this worker only
// needs to do the one thing content scripts genuinely cannot do themselves:
// capture a screenshot of the tab (chrome.tabs.* is not available to content
// scripts), used to crop and pixel-analyze raster chart images locally.
//
// The AI-pipeline equivalent of this file is service-workerAI.js (unchanged) —
// there, this same CAPTURE_TAB handler exists alongside an ANALYZE_CANDIDATE
// handler that forwards requests to the local backend/Gemini.

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
  return false;
});
