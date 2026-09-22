// usageTracker.js  (LOCAL VLM PIPELINE)
//
// Counts analyses so the free tier can be capped: 10 per rolling 24 hours,
// no rollover (using all 10, then waiting 24h, does not grant extras — it's a
// sliding window, not a daily refill). One click on a visual = one analysis =
// one unit, which is why the product uses click-to-select rather than
// scanning a whole page.
//
// The Pro override reads chrome.storage.local.linkedAccount, which is written
// by accountSync.js — a content script that runs ONLY on the ColorBridge
// website (http://localhost:5500) and copies over just the account tier when
// signed in there. See website/README.md#how-the-pro-link-works. There is no
// real account server; a Pro sign-in on the site is what lifts the limit here.

window.AIColorA11y = window.AIColorA11y || {};

window.AIColorA11y.usageTracker = (function () {
  const STORAGE_KEY = 'usage';
  const FREE_LIMIT = 10;
  const WINDOW_MS = 24 * 60 * 60 * 1000;

  async function read() {
    const stored = await chrome.storage.local.get([STORAGE_KEY]);
    const usage = stored[STORAGE_KEY];
    if (!usage || !Array.isArray(usage.timestamps)) return { timestamps: [] };
    return usage;
  }

  function withinWindow(timestamps) {
    const cutoff = Date.now() - WINDOW_MS;
    return timestamps.filter((t) => t > cutoff);
  }

  async function linkedAccount() {
    const stored = await chrome.storage.local.get(['linkedAccount']);
    return stored.linkedAccount || null;
  }

  // Returns { allowed, used, limit, resetsInMs, tier, accountEmail? }.
  async function checkQuota() {
    const account = await linkedAccount();
    if (account && account.tier === 'pro') {
      return {
        tier: 'pro',
        limit: Infinity,
        used: 0,
        allowed: true,
        resetsInMs: 0,
        accountEmail: account.email
      };
    }

    const usage = await read();
    const recent = withinWindow(usage.timestamps);
    const oldest = recent.length ? Math.min(...recent) : null;

    return {
      tier: account && account.tier === 'free' ? 'free' : 'anonymous',
      limit: FREE_LIMIT,
      used: recent.length,
      allowed: recent.length < FREE_LIMIT,
      resetsInMs: oldest ? Math.max(0, oldest + WINDOW_MS - Date.now()) : 0,
      accountEmail: account ? account.email : undefined
    };
  }

  // Pro is unlimited, so it isn't worth counting — keeps the stored list from
  // growing forever for an account that will never hit the limit anyway.
  async function recordUse() {
    const account = await linkedAccount();
    if (account && account.tier === 'pro') return 0;

    const usage = await read();
    const recent = withinWindow(usage.timestamps);
    recent.push(Date.now());
    await chrome.storage.local.set({ [STORAGE_KEY]: { timestamps: recent } });
    return recent.length;
  }

  function describeReset(ms) {
    const hours = Math.ceil(ms / (60 * 60 * 1000));
    return hours <= 1 ? 'in under an hour' : `in about ${hours} hours`;
  }

  return { checkQuota, recordUse, describeReset, FREE_LIMIT };
})();
