// popup.js
//
// Two very different modes live here:
//
//   Normal web pages — the popup is a launcher, not a dashboard. It checks
//   the local stack is up, arms selection mode on the page, and CLOSES
//   (window.close()) because the next thing the user does is click the page,
//   which would dismiss the popup anyway. Progress and results are drawn on
//   the page itself (see selectionMode.js).
//
//   PDF tabs — Chrome's built-in PDF viewer cannot host a content script (a
//   hard platform restriction, verified), so none of the above works. The
//   popup stays open instead and becomes the whole UI: capture, drag-select,
//   analyse and show the result, all inside pdfCapture.js.

const CONTENT_SCRIPT_FILES = [
  'content/colorDetector.js',
  'content/semanticMapper.js',
  'content/overlayManager.js',
  'content/imageProcessor.js',
  'content/svgProcessor.js',
  'content/domColorScanner.js',
  'content/contextCollector.js',
  'content/visualCapture.js',
  'content/selectionMode.js',
  'content/usageTracker.js',
  'content/content.js'
];

const WEBSITE_URL = 'http://localhost:5500/';
const PDF_URL_PATTERN = /\.pdf(?:[?#]|$)/i;

const toggleBtn = document.getElementById('enabledToggle');
const toggleText = document.getElementById('toggleText');
const analyzeBtn = document.getElementById('analyzeBtn');
const statusText = document.getElementById('statusText');
const statusHint = document.getElementById('statusHint');
const usageText = document.getElementById('usageText');
const lastAnalysisText = document.getElementById('lastAnalysisText');
const settingsBtn = document.getElementById('settingsBtn');
const settingsPanel = document.getElementById('settingsPanel');
const signinLink = document.getElementById('signinLink');
const accountLine = document.getElementById('accountLine');

const normalModeRow = document.getElementById('normalModeRow');
const pdfModeRow = document.getElementById('pdfModeRow');
const pdfStartBtn = document.getElementById('pdfStartBtn');
const pdfCaptureSection = document.getElementById('pdfCaptureSection');
const pdfResultSection = document.getElementById('pdfResultSection');
const pdfAnalyzeBtn = document.getElementById('pdfAnalyzeBtn');
const pdfCancelBtn = document.getElementById('pdfCancelBtn');
const pdfAnotherBtn = document.getElementById('pdfAnotherBtn');
const pdfDoneBtn = document.getElementById('pdfDoneBtn');

let enabled = false;
let backendReady = false;
let activeTab = null;
let isPdfTab = false;

function refreshButton() {
  analyzeBtn.disabled = !(enabled && backendReady);
  pdfStartBtn.disabled = !(enabled && backendReady);
}

function setToggleUI(isEnabled) {
  enabled = isEnabled;
  toggleBtn.setAttribute('aria-checked', String(isEnabled));
  toggleText.textContent = isEnabled ? 'ON' : 'OFF';
  refreshButton();
}

function setStatus(text, hint) {
  statusText.textContent = text;
  if (hint) {
    statusHint.textContent = hint;
    statusHint.hidden = false;
  } else {
    statusHint.hidden = true;
  }
}

function formatLastAnalysis(entry) {
  if (!entry) return 'Not analysed yet';
  const time = new Date(entry.timestamp).toLocaleTimeString();
  if (!entry.semantic) return `${time} — colour carried no meaning there`;
  const type = String(entry.visualType || 'visual').replace(/_/g, ' ');
  return `${time} — ${type}, ${entry.mappings} colour${entry.mappings === 1 ? '' : 's'} explained`;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

// Only injects when nothing is listening yet. Re-running the content scripts
// on a page that already has them would create a second, disconnected copy of
// every module.
async function ensureContentScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'PING' });
    return true;
  } catch (e) {
    // nothing there yet
  }
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: CONTENT_SCRIPT_FILES });
    return true;
  } catch (e) {
    return false; // restricted page (chrome://, the Web Store, a PDF viewer)
  }
}

async function checkBackend() {
  const health = await chrome.runtime.sendMessage({ type: 'CHECK_BACKEND' });

  if (!health || !health.reachable) {
    backendReady = false;
    setStatus('Analysis server not running', health && health.hint);
  } else if (!health.ok) {
    backendReady = false;
    setStatus(health.message || 'Model not ready', health.hint);
  } else {
    backendReady = true;
    setStatus(`Ready — ${health.model}`);
  }
  refreshButton();
}

function formatUsage(quota) {
  if (quota.tier === 'pro') return `Unlimited (Pro account linked)`;
  const who = quota.tier === 'free' ? ' (signed in, free)' : ' (not signed in)';
  return `${quota.used} of ${quota.limit} used today${who}`;
}

async function refreshUsage() {
  const quota = await window.AIColorA11y.usageTracker.checkQuota();
  usageText.textContent = formatUsage(quota);
}

async function refreshAccountLine() {
  const { linkedAccount } = await chrome.storage.local.get(['linkedAccount']);
  if (!linkedAccount) {
    accountLine.hidden = true;
    signinLink.textContent = 'Sign in';
    return;
  }
  accountLine.hidden = false;
  accountLine.textContent = `Linked to ColorBridge: ${linkedAccount.name} (${linkedAccount.tier})`;
  signinLink.textContent = 'Manage account';
}

function applyPdfMode() {
  normalModeRow.hidden = isPdfTab;
  pdfModeRow.hidden = !isPdfTab;
  if (!isPdfTab) {
    pdfCaptureSection.hidden = true;
    pdfResultSection.hidden = true;
    window.PdfCapture.reset();
  }
}

async function init() {
  const data = await chrome.storage.local.get(['enabled', 'lastAnalysis']);
  setToggleUI(Boolean(data.enabled));
  lastAnalysisText.textContent = formatLastAnalysis(data.lastAnalysis);

  activeTab = await getActiveTab();
  isPdfTab = Boolean(activeTab && activeTab.url && PDF_URL_PATTERN.test(activeTab.url));
  applyPdfMode();

  await Promise.all([checkBackend(), refreshUsage(), refreshAccountLine()]);
}

toggleBtn.addEventListener('click', async () => {
  const next = !enabled;
  setToggleUI(next);
  await chrome.storage.local.set({ enabled: next });

  if (isPdfTab || !activeTab || !activeTab.id) return; // nothing to toggle on a PDF page
  try {
    await ensureContentScript(activeTab.id);
    await chrome.tabs.sendMessage(activeTab.id, { type: 'SET_ENABLED', enabled: next });
  } catch (e) {
    // Restricted page; nothing to turn off there anyway.
  }
});

analyzeBtn.addEventListener('click', async () => {
  if (!activeTab || !activeTab.id) return;

  const injected = await ensureContentScript(activeTab.id);
  if (!injected) {
    setStatus('This page cannot be analysed', 'Chrome blocks extensions on pages like chrome:// and the Web Store.');
    return;
  }

  try {
    const result = await chrome.tabs.sendMessage(activeTab.id, { type: 'START_SELECTION' });
    if (result && result.status === 'quota') {
      setStatus('Free limit reached', `Used ${result.used} of ${result.limit}. Resets later today.`);
      return;
    }
    // Hand the page over to the user — instructions now appear on the page.
    window.close();
  } catch (err) {
    setStatus('This page cannot be analysed', 'Try reloading the tab first.');
  }
});

// ---- PDF flow: the popup stays open and does everything itself ----

pdfStartBtn.addEventListener('click', async () => {
  pdfCaptureSection.hidden = false;
  pdfResultSection.hidden = true;
  try {
    await window.PdfCapture.beginCapture(setStatus);
  } catch (err) {
    setStatus('Could not capture this PDF', err.message);
    pdfCaptureSection.hidden = true;
  }
});

pdfAnalyzeBtn.addEventListener('click', async () => {
  await window.PdfCapture.analyzeSelection(setStatus);
  refreshUsage();
});

pdfCancelBtn.addEventListener('click', () => {
  window.PdfCapture.reset();
  pdfCaptureSection.hidden = true;
  setStatus('Ready', '');
});

pdfAnotherBtn.addEventListener('click', async () => {
  pdfResultSection.hidden = true;
  pdfCaptureSection.hidden = false;
  await window.PdfCapture.beginCapture(setStatus);
});

pdfDoneBtn.addEventListener('click', () => {
  window.PdfCapture.reset();
  pdfResultSection.hidden = true;
  setStatus('Ready', '');
});

// ---- account ----

signinLink.addEventListener('click', () => {
  chrome.tabs.create({ url: WEBSITE_URL });
});

settingsBtn.addEventListener('click', () => {
  const isOpen = !settingsPanel.hidden;
  settingsPanel.hidden = isOpen;
  settingsBtn.setAttribute('aria-expanded', String(!isOpen));
});

init();
