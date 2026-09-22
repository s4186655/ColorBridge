// content.js  (HARDCODE PIPELINE — no AI involved)
//
// Orchestrator for the hardcoded, no-AI version of the extension. Wires
// together the local detectors (dom/svg/image) and overlayManager using only
// the fixed rule tables in semanticMapper.js. No network calls are made at
// all — CAPTURE_TAB (a screenshot, for cropping raster images) is the only
// message this file sends to the background service worker.
//
// Rules implemented here (see semanticMapper.js for the actual tables):
//   Part A (#financialChart, raster) : green candle -> up arrow, red -> down arrow,
//                                       arrow length scaled to the candle's own pixel height
//   Part B (quiz correctness, DOM)   : green -> ✓, red -> ✕
//   Part C (status badges, DOM)      : green -> ✓, red -> ✕ (kept text as-is; other colors untouched)
//   Part D (#teamPhoto, raster)      : green -> ✓..✓✓✓, red -> ✕..✕✕✕, count = shade darkness (1-3)
//   Part E (#ambiguousChart, raster) : identical rule to Part D
//   Part F (inline <svg> risk gauge) : green -> shield, red -> skull
//
// Only green and red are ever matched anywhere in this pipeline (see
// semanticMapper.js) — every other color is left exactly as the page rendered it.
//
// Analysis only ever runs in response to an explicit 'ANALYZE_PAGE' message
// (the user clicking "Analyze this page" in the popup) — never automatically.
//
// The AI-pipeline equivalent of this file is contentAI.js (unchanged) — there,
// each candidate's context is sent to the backend/Gemini instead of being
// matched against the fixed tables used here.

(function () {
  if (window.__aiColorA11yContentLoaded) return;
  window.__aiColorA11yContentLoaded = true;

  const { overlayManager, semanticMapper, domColorScanner, svgProcessor, imageProcessor } = window.AIColorA11y;
  const { ARROW_DIRECTION_MAP, PHOTO_SYMBOL_MAP } = semanticMapper;

  let enabled = false; // best-effort cache; ANALYZE_PAGE always re-checks storage directly

  chrome.storage.local.get(['enabled'], (data) => {
    enabled = Boolean(data.enabled);
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'PING') {
      // Lets popup.js check "is a content script already listening here?"
      // before deciding whether it needs to inject one — avoids repeatedly
      // re-injecting (and re-running) every content script file on every click.
      sendResponse({ ok: true });
      return false;
    }
    if (message.type === 'SET_ENABLED') {
      enabled = Boolean(message.enabled);
      if (!enabled) overlayManager.clearAll();
      sendResponse({ ok: true });
      return false;
    }
    if (message.type === 'ANALYZE_PAGE') {
      handleAnalyze()
        .then(sendResponse)
        .catch((err) => sendResponse({ status: 'error', message: String(err && err.message ? err.message : err) }));
      return true; // keep the message channel open for the async response
    }
    return false;
  });

  // chrome.tabs.captureVisibleTab is rate-limited by Chrome itself (about 2
  // calls/second) and fails with a lastError if called faster than that. Since
  // each image is now captured individually (see handleAnalyze), this spaces
  // consecutive calls out so a page with several images doesn't silently lose
  // a capture to the rate limit.
  let lastCaptureAt = 0;
  async function throttledCaptureTab() {
    const MIN_GAP_MS = 600;
    const elapsed = Date.now() - lastCaptureAt;
    if (elapsed < MIN_GAP_MS) {
      await new Promise((resolve) => setTimeout(resolve, MIN_GAP_MS - elapsed));
    }
    lastCaptureAt = Date.now();
    return chrome.runtime.sendMessage({ type: 'CAPTURE_TAB' });
  }

  function isFullyInViewport(el) {
    const r = el.getBoundingClientRect();
    return r.top >= 0 && r.left >= 0 && r.bottom <= window.innerHeight && r.right <= window.innerWidth;
  }

  // Waits for two animation frames, which is enough for the browser to have
  // actually painted a scroll change before we ask the background service
  // worker to screenshot the tab (a screenshot taken mid-scroll, before the
  // new position is painted, would still show the old position).
  function waitForNextPaint() {
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }

  function toPageRect(clientRect) {
    return {
      left: clientRect.left + window.scrollX,
      top: clientRect.top + window.scrollY,
      width: clientRect.width,
      height: clientRect.height
    };
  }

  function applyDomCandidates(candidates) {
    let applied = 0;
    for (const c of candidates) {
      const rect = toPageRect(c.el.getBoundingClientRect());
      const badgeRect = { left: rect.left + rect.width - 10, top: rect.top - 6, width: 18, height: 18 };
      overlayManager.addSymbolOverlay(badgeRect, c.symbol, c.label);
      applied++;
    }
    return applied;
  }

  function applySvgCandidates(candidates) {
    let applied = 0;
    for (const c of candidates) {
      const rect = toPageRect(c.shape.getBoundingClientRect());
      if (rect.width === 0 || rect.height === 0) continue;
      const size = Math.max(16, Math.min(28, Math.min(rect.width, rect.height)));
      const badgeRect = {
        left: rect.left + rect.width / 2 - size / 2,
        top: rect.top + rect.height / 2 - size / 2,
        width: size,
        height: size
      };
      overlayManager.addSymbolOverlay(badgeRect, c.symbol, c.label);
      applied++;
    }
    return applied;
  }

  // Part A: one arrow per candle blob, length proportional to the blob's own height.
  function applyArrowBlobs(crop, blobs) {
    let applied = 0;
    const dpr = window.devicePixelRatio || 1;
    for (const blob of blobs) {
      const direction = ARROW_DIRECTION_MAP[blob.color];
      if (!direction) continue;
      const pageRect = {
        left: crop.rect.left + window.scrollX + blob.box.x / dpr,
        top: crop.rect.top + window.scrollY + blob.box.y / dpr,
        width: blob.box.width / dpr,
        height: blob.box.height / dpr // arrow length = candle's own pixel height
      };
      overlayManager.addArrowOverlay(pageRect, direction, direction === 'up' ? 'increase' : 'decrease');
      applied++;
    }
    return applied;
  }

  // Part D / Part E: stacked ✓/✕, repeat count = the blob's own depth tier (1-3).
  function applyDepthSymbolBlobs(crop, blobs) {
    let applied = 0;
    const dpr = window.devicePixelRatio || 1;
    for (const blob of blobs) {
      const mapping = PHOTO_SYMBOL_MAP[blob.color];
      if (!mapping) continue;
      const pageRect = {
        left: crop.rect.left + window.scrollX + blob.box.x / dpr,
        top: crop.rect.top + window.scrollY + blob.box.y / dpr,
        width: blob.box.width / dpr,
        height: blob.box.height / dpr
      };
      overlayManager.addStackedSymbolOverlay(pageRect, mapping.symbol, blob.depthTier, mapping.label);
      applied++;
    }
    return applied;
  }

  // Builds the "what we found" legend panel content from the ACTUAL blobs
  // detected in one image (not a static table) — one row per distinct
  // (color, depth tier) combination actually present, using that blob's own
  // measured average color as the swatch. Only called after a successful
  // analysis, so it reads as "this is what the analysis just found."
  function showDepthLegend(crop, blobs) {
    const seen = new Map();
    for (const blob of blobs) {
      const mapping = PHOTO_SYMBOL_MAP[blob.color];
      if (!mapping) continue;
      const key = `${blob.color}-${blob.depthTier}`;
      if (!seen.has(key)) {
        seen.set(key, { color: blob.color, tier: blob.depthTier, symbol: mapping.symbol, avg: blob.avgColor });
      }
    }
    if (seen.size === 0) return;

    const rows = Array.from(seen.values())
      .sort((a, b) => (a.color === b.color ? b.tier - a.tier : a.color.localeCompare(b.color)))
      .map((entry) => {
        const c = entry.avg;
        return {
          colorCss: `rgb(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)})`,
          text: `${entry.symbol.repeat(entry.tier)}  (this shade → ${entry.tier}×)`
        };
      });

    const anchorRect = toPageRect(crop.rect);
    overlayManager.addLegendPanel(
      anchorRect,
      'Analysis result: shade → symbol count',
      rows,
      'Darker shade = more symbols. Lighter shade = fewer symbols.'
    );
  }

  async function handleAnalyze() {
    // Re-check storage directly (not the cached `enabled` var) to avoid a race
    // where this content script was just injected and hasn't finished its
    // initial storage read yet when ANALYZE_PAGE arrives.
    const stored = await chrome.storage.local.get(['enabled']);
    if (!stored.enabled) {
      return { status: 'disabled', message: 'Extension is off. Turn it on to analyze.' };
    }

    overlayManager.clearAll();

    const domCandidates = domColorScanner.findCandidates();
    const svgCandidates = svgProcessor.findCandidates();
    const imageCandidates = imageProcessor.findCandidates();

    // symbolsDrawn counts every individual ✓/✕/arrow/shield/skull actually
    // placed on the page (not just "1 per section"), so the number shown to
    // the user reflects everything that was processed, element by element.
    let symbolsDrawn = 0;
    let areasAffected = 0;
    let errors = 0;

    try {
      const n = applyDomCandidates(domCandidates);
      symbolsDrawn += n;
      if (n > 0) areasAffected++;
    } catch (e) { errors++; }

    try {
      const n = applySvgCandidates(svgCandidates);
      symbolsDrawn += n;
      if (n > 0) areasAffected++;
    } catch (e) { errors++; }

    // chrome.tabs.captureVisibleTab only captures what's currently visible in
    // the viewport — NOT the whole scrollable page. A single screenshot taken
    // once, up front, would miss any image the user wasn't scrolled to at the
    // moment they clicked "Analyze this page" (this is exactly why Part A's
    // candlestick chart was silently skipped when the page was scrolled down
    // to Part D). To process every image regardless of scroll position, each
    // one is scrolled into view and captured individually.
    if (imageCandidates.length > 0) {
      const originalScrollX = window.scrollX;
      const originalScrollY = window.scrollY;

      for (const candidate of imageCandidates) {
        try {
          if (!isFullyInViewport(candidate.img)) {
            candidate.img.scrollIntoView({ block: 'center', inline: 'center' });
            await waitForNextPaint();
          }

          const resp = await throttledCaptureTab();
          if (!resp || !resp.dataUrl) { errors++; continue; }

          const crop = await imageProcessor.cropToElement(resp.dataUrl, candidate.img);
          const blobs = imageProcessor.detectBlobs(crop.ctx, crop.ctx.canvas.width, crop.ctx.canvas.height);
          const n = candidate.mode === 'arrows' ? applyArrowBlobs(crop, blobs) : applyDepthSymbolBlobs(crop, blobs);
          symbolsDrawn += n;
          if (n > 0) {
            areasAffected++;
            if (candidate.mode === 'depth-symbols') showDepthLegend(crop, blobs);
          }
        } catch (err) {
          errors++;
        }
      }

      window.scrollTo(originalScrollX, originalScrollY);
    }

    const analyzed = domCandidates.length + svgCandidates.length + imageCandidates.length;

    return {
      status: 'ok',
      analyzed,
      symbolsDrawn,
      areasAffected,
      errors,
      timestamp: Date.now()
    };
  }
})();
