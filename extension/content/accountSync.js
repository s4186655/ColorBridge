// accountSync.js
//
// Runs ONLY on the ColorBridge website (http://localhost:5500/*  — see the
// second content_scripts entry in manifest.json, separate from the all_urls
// block that runs the actual analysis pipeline).
//
// This is the ONLY link between the website and the extension, and it is
// deliberately narrow: it copies just the account TIER into
// chrome.storage.local, so a Pro sign-in can lift the free-tier limit
// (see usageTracker.js). Nothing else about the account — name, email
// display, the upgrade box — has anything to do with the extension; that is
// all cosmetic and lives only in the website's own tab.
//
// There is no real backend on either side. The website keeps its session in
// localStorage; this script just reads that same key and relays it.

(function () {
  const SESSION_KEY = 'colorbridge_session';
  let lastSerialized = null;

  function readSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function sync() {
    const session = readSession();
    const serialized = JSON.stringify(session);
    if (serialized === lastSerialized) return; // nothing changed since last check
    lastSerialized = serialized;

    chrome.storage.local.set({
      linkedAccount: session
        ? { email: session.email, name: session.name, tier: session.tier }
        : null
    });
  }

  sync();
  // No 'storage' event fires for changes made by THIS SAME tab (only other
  // tabs of the same origin get notified), so this polls instead. Cheap and
  // simple beats a message-passing bridge for two localStorage reads a second.
  setInterval(sync, 1500);
})();
