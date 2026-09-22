// content.js  (LOCAL VLM PIPELINE)
//
// Orchestrates one analysis, end to end:
//
//   user clicks a visual        selectionMode.js
//     -> capture it             visualCapture.js   (picture + where each colour is)
//     -> read the page round it contextCollector.js
//     -> ask the local model    background -> localhost:8787 -> localhost:11434
//     -> check the answer       confidence gates below
//     -> draw symbols           overlayManager.js
//
// The division of labour is the whole point of the project and is enforced
// here: the model is asked ONLY what a colour means. Where that colour sits,
// and what gets drawn on the page, is decided by deterministic code that the
// model never touches.
//
// Other pipelines: contentHardcode.js (fixed rules), contentAI.js (Gemini).

(function () {
  if (window.__aiColorA11yContentLoaded) return;
  window.__aiColorA11yContentLoaded = true;

  const {
    overlayManager, semanticMapper, selectionMode,
    visualCapture, contextCollector, usageTracker
  } = window.AIColorA11y;

  // Below this, the spec says do not transform at all.
  const MIN_OVERALL_CONFIDENCE = 0.6;
  // A single mapping can be weaker than the overall verdict; skip just that one.
  const MIN_MAPPING_CONFIDENCE = 0.5;
  const ARROW_SYMBOLS = { '↑': 'up', '↓': 'down' };

  let redrawObserver = null;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'PING') {
      sendResponse({ ok: true });
      return false;
    }

    if (message.type === 'SET_ENABLED') {
      if (!message.enabled) reset();
      sendResponse({ ok: true });
      return false;
    }

    if (message.type === 'START_SELECTION') {
      startSelection()
        .then(sendResponse)
        .catch((err) => sendResponse({ status: 'error', message: String(err && err.message || err) }));
      return true;
    }

    if (message.type === 'CLEAR_OVERLAYS') {
      reset();
      sendResponse({ ok: true });
      return false;
    }

    return false;
  });

  function reset() {
    selectionMode.exit();
    selectionMode.hideStatus();
    overlayManager.clearAll();
    if (redrawObserver) { redrawObserver.disconnect(); redrawObserver = null; }
  }

  async function startSelection() {
    const stored = await chrome.storage.local.get(['enabled']);
    if (!stored.enabled) {
      return { status: 'disabled', message: 'Turn the extension on first.' };
    }

    const quota = await usageTracker.checkQuota();
    if (!quota.allowed) {
      selectionMode.showStatus(
        `Free limit reached (${quota.used}/${quota.limit}). Resets ${usageTracker.describeReset(quota.resetsInMs)}.`,
        'error'
      );
      return { status: 'quota', ...quota };
    }

    overlayManager.clearAll();
    selectionMode.enter(handlePick);
    return { status: 'selecting', ...quota };
  }

  async function handlePick(el, kind) {
    selectionMode.showStatus('Analysing with the local model… this takes ~20s', 'busy');

    try {
      const captured = await visualCapture.captureVisual(el, kind);
      const colorsFound = Array.from(new Set(captured.regions.map((r) => r.color)));

      if (captured.regions.length === 0) {
        finish('No red, green, yellow, orange or blue regions were found in that.', 'error');
        return { status: 'no_color' };
      }

      const context = contextCollector.collect(el, kind, colorsFound);
      const response = await chrome.runtime.sendMessage({
        type: 'ANALYZE_VISUAL',
        payload: { image: captured.imageBase64, context }
      });

      if (!response || response.error) {
        const detail = response && response.hint ? ` ${response.hint}` : '';
        finish(`${(response && response.error) || 'Analysis failed.'}${detail}`, 'error');
        return { status: 'error' };
      }

      const analysis = response.data;
      await usageTracker.recordUse();
      await chrome.storage.local.set({
        lastAnalysis: {
          timestamp: Date.now(),
          visualType: analysis.visual_type,
          confidence: analysis.confidence,
          semantic: analysis.is_color_semantic,
          mappings: analysis.mappings.length
        }
      });

      applyAnalysis(el, captured, analysis);
      return { status: 'ok' };
    } catch (err) {
      finish(`Could not analyse that: ${err.message}`, 'error');
      return { status: 'error', message: err.message };
    }
  }

  function finish(text, tone) {
    selectionMode.showStatus(text, tone);
    if (tone !== 'busy') setTimeout(() => selectionMode.hideStatus(), 7000);
  }

  function applyAnalysis(el, captured, analysis) {
    // Gate 1 — the model itself says colour isn't carrying information here,
    // or the backend's guards overrode it (photograph, meaningless mappings).
    if (!analysis.is_color_semantic) {
      finish(analysis.rejected || 'Colour does not appear to carry meaning here, so the page was left unchanged.', 'done');
      return;
    }

    // Gate 2 — too unsure to act. Never guess on an accessibility aid.
    if (analysis.confidence < MIN_OVERALL_CONFIDENCE) {
      finish('Unable to confidently determine the meaning of the colours, so nothing was changed.', 'error');
      return;
    }

    const usable = analysis.mappings.filter((m) => m.confidence >= MIN_MAPPING_CONFIDENCE);
    const byColor = new Map();
    usable.forEach((m, index) => {
      byColor.set(m.color, { ...m, symbol: semanticMapper.getSymbol(m.meaning, m.symbol, index) });
    });

    // Amber, teal and similar in-between shades sit right on a bucket
    // boundary, so the model and the pixel classifier can legitimately land on
    // different names for the same swatch. If a mapping has no region of its
    // own, let it cover an unclaimed neighbouring bucket rather than silently
    // dropping a meaning the page really does use.
    const NEIGHBOURS = { yellow: 'orange', orange: 'yellow', red: 'orange', blue: 'green' };
    const presentColors = new Set(captured.regions.map((r) => r.color));
    for (const [color, mapping] of Array.from(byColor)) {
      if (presentColors.has(color)) continue;
      const neighbour = NEIGHBOURS[color];
      if (neighbour && presentColors.has(neighbour) && !byColor.has(neighbour)) {
        byColor.set(neighbour, mapping);
      }
    }

    let drawn = 0;
    for (const region of captured.regions) {
      const mapping = byColor.get(region.color);
      if (!mapping) continue; // a colour the model didn't consider meaningful
      drawRegion(region, mapping);
      drawn++;
    }

    if (drawn === 0) {
      finish('The model explained colours that could not be located in that graphic.', 'error');
      return;
    }

    drawLegend(captured, analysis, Array.from(byColor.values()));
    watchForRedraw(el);
    finish(`Done — ${drawn} symbol${drawn === 1 ? '' : 's'} added.`, 'done');
  }

  function drawRegion(region, mapping) {
    const label = semanticMapper.describe(mapping);
    const rect = region.pageRect;
    const direction = ARROW_SYMBOLS[mapping.symbol];

    // For a directional meaning on a tall region (a bar, a candle), draw a
    // scaled arrow instead of a fixed glyph so magnitude survives too.
    if (direction && rect.height >= 40) {
      overlayManager.addArrowOverlay(rect, direction, label);
      return;
    }

    const size = Math.max(16, Math.min(28, Math.min(rect.width, rect.height) || 18));
    const isSmall = rect.width < size * 1.6 || rect.height < size * 1.6;

    if (isSmall) {
      // Too tight to sit inside: perch at the top-right corner instead so the
      // page's own content stays readable.
      overlayManager.addSymbolOverlay(
        { left: rect.left + rect.width - size * 0.55, top: rect.top - size * 0.35, width: size, height: size },
        mapping.symbol, label
      );
      return;
    }

    overlayManager.addSymbolOverlay(
      { left: rect.left + rect.width / 2 - size / 2, top: rect.top + rect.height / 2 - size / 2, width: size, height: size },
      mapping.symbol, label
    );
  }

  function drawLegend(captured, analysis, mappings) {
    const rows = mappings.map((m) => ({ symbol: m.symbol, text: `= ${m.meaning}` }));
    const note = analysis.evidence
      ? `Based on: ${analysis.evidence}`
      : `Read as a ${String(analysis.visual_type).replace(/_/g, ' ')}.`;
    overlayManager.addLegendPanel(
      captured.elementPageRect,
      'What the colours mean here',
      rows,
      note
    );
  }

  // Charts re-render on resize and our overlays would be left pointing at
  // nothing. A stale symbol is worse than no symbol, so drop them all.
  function watchForRedraw(el) {
    if (redrawObserver) redrawObserver.disconnect();
    if (typeof ResizeObserver === 'undefined') return;

    let initial = true;
    redrawObserver = new ResizeObserver(() => {
      if (initial) { initial = false; return; }
      overlayManager.clearAll();
      selectionMode.showStatus('The chart changed size, so the symbols were removed.', 'error');
      setTimeout(() => selectionMode.hideStatus(), 5000);
      redrawObserver.disconnect();
      redrawObserver = null;
    });
    redrawObserver.observe(el);
  }
})();
