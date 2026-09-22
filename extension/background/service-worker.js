// service-worker.js  (LOCAL VLM PIPELINE)
//
// The only part of the extension that can call chrome.tabs.* or reach the
// network, so content scripts ask it for both.
//
//   CAPTURE_TAB     screenshot of the visible tab (content scripts cannot)
//   ANALYZE_VISUAL  forward one visual to the local backend
//   CHECK_BACKEND   is the local stack up? used by the popup
//
// The backend is on this machine and it in turn talks to Ollama on this
// machine. Nothing here has a route to the internet.
//
// Why not call Ollama (11434) directly and skip the backend? Ollama checks the
// Origin header and its default allowlist does not include chrome-extension://,
// so it answers 403. Going through the local Node proxy avoids making the user
// set OLLAMA_ORIGINS by hand.
//
// Other pipelines: service-workerHardcode.js, service-workerAI.js.

const BACKEND_URL = 'http://localhost:8787';
const ANALYZE_TIMEOUT_MS = 180000; // local inference is slow; be patient

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'CAPTURE_TAB') {
    const windowId = sender.tab ? sender.tab.windowId : chrome.windows.WINDOW_ID_CURRENT;
    chrome.tabs.captureVisibleTab(windowId, { format: 'png' }, (dataUrl) => {
      if (chrome.runtime.lastError) sendResponse({ error: chrome.runtime.lastError.message });
      else sendResponse({ dataUrl });
    });
    return true;
  }

  if (message.type === 'ANALYZE_VISUAL') {
    analyze(message.payload).then(sendResponse);
    return true;
  }

  if (message.type === 'CHECK_BACKEND') {
    checkBackend().then(sendResponse);
    return true;
  }

  return false;
});

async function analyze(payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ANALYZE_TIMEOUT_MS);

  try {
    const response = await fetch(`${BACKEND_URL}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    const body = await response.json().catch(() => null);

    if (!response.ok) {
      return {
        error: (body && body.error) || `The analysis server returned HTTP ${response.status}.`,
        hint: body && body.hint
      };
    }
    return { data: body };
  } catch (err) {
    if (err.name === 'AbortError') {
      return {
        error: 'The model took too long to answer.',
        hint: 'Try a smaller chart, or switch OLLAMA_MODEL to qwen3-vl:2b-instruct.'
      };
    }
    return {
      error: `Cannot reach the local analysis server at ${BACKEND_URL}.`,
      hint: 'Start it with "npm start" in the backend folder, and make sure Ollama is running.'
    };
  } finally {
    clearTimeout(timer);
  }
}

async function checkBackend() {
  try {
    const response = await fetch(`${BACKEND_URL}/health`, { cache: 'no-store' });
    const body = await response.json();
    return { reachable: true, ...body };
  } catch (err) {
    return {
      reachable: false,
      ok: false,
      message: `Backend not running at ${BACKEND_URL}.`,
      hint: 'Run "npm start" in the backend folder.'
    };
  }
}
