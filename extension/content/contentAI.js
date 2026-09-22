// content.js
//
// Purpose: the orchestrator. Wires together the local detectors (dom/svg/
// image), calls the backend (via the background service worker, which is the
// only place allowed to talk to the network) and applies results through
// overlayManager. This file makes NO decisions about color meaning itself —
// it only decides WHICH candidates to look at and WHERE to draw the result.
//
// Message contract (from popup.js / background):
//   { type: 'SET_ENABLED', enabled: boolean } -> clears overlays when turned off
//   { type: 'ANALYZE_PAGE' } -> runs the full pipeline once, returns a summary
//
// Analysis only ever runs in response to an explicit 'ANALYZE_PAGE' message
// (i.e. the user clicking "Analyze this page" in the popup) — never on page
// load, scroll, or a timer.

(function () {
  if (window.__aiColorA11yContentLoaded) return;
  window.__aiColorA11yContentLoaded = true;

  const { overlayManager, semanticMapper, domColorScanner, svgProcessor, imageProcessor } = window.AIColorA11y;

  let enabled = false; // best-effort cache; ANALYZE_PAGE always re-checks storage directly
  const analysisCache = new Map(); // signature -> validated backend result, avoids re-analyzing unchanged visuals

  chrome.storage.local.get(['enabled'], (data) => {
    enabled = Boolean(data.enabled);
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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

  function toPageRect(clientRect) {
    return {
      left: clientRect.left + window.scrollX,
      top: clientRect.top + window.scrollY,
      width: clientRect.width,
      height: clientRect.height
    };
  }

  function signatureFor(candidate) {
    if (candidate.type === 'dom') {
      return `dom:${candidate.context.heading}:${candidate.context.colorsFound.slice().sort().join(',')}:${candidate.items.length}`;
    }
    if (candidate.type === 'svg') {
      return `svg:${candidate.context.heading}:${candidate.context.colorsFound.slice().sort().join(',')}`;
    }
    return `img:${(candidate.img.getAttribute('src') || '').slice(0, 200)}`;
  }

  async function callBackend(payload) {
    const response = await chrome.runtime.sendMessage({ type: 'ANALYZE_CANDIDATE', payload });
    if (!response || response.error) {
      throw new Error((response && response.error) || 'Unknown backend error');
    }
    return response.data;
  }

  // Confidence gating (spec section 14):
  //   >= 0.85            -> apply
  //   0.6 - 0.85         -> apply only if local color detection corroborates it
  //   < 0.6 or no info   -> never apply
  function confidenceAllows(result, localColors) {
    if (!result || !result.has_color_encoded_information) return false;
    const confidence = typeof result.confidence === 'number' ? result.confidence : 0;
    if (confidence >= 0.85) return true;
    if (confidence >= 0.6) {
      const mappedColors = (result.mappings || []).map((m) => (m.color || '').toLowerCase());
      return mappedColors.some((c) => localColors.includes(c));
    }
    return false;
  }

  function buildPayload(candidate) {
    if (candidate.type === 'dom') {
      return { visualType: 'dom_color_coded_text', context: candidate.context };
    }
    return { visualType: 'svg_chart', context: candidate.context };
  }

  function applyDomResult(candidate, result) {
    let applied = 0;
    const mappingByColor = {};
    (result.mappings || []).forEach((m) => { mappingByColor[(m.color || '').toLowerCase()] = m; });

    for (const item of candidate.items) {
      const mapping = mappingByColor[item.color];
      if (!mapping) continue;
      const symbol = semanticMapper.getSymbol(mapping.meaning, mapping.symbol);
      const rect = toPageRect(item.el.getBoundingClientRect());
      const badgeRect = { left: rect.left + rect.width - 10, top: rect.top - 6, width: 18, height: 18 };
      overlayManager.addOverlay(badgeRect, symbol, `${mapping.meaning} (was ${item.color})`);
      applied++;
    }
    return applied;
  }

  function applySvgResult(candidate, result) {
    let applied = 0;
    const mappingByColor = {};
    (result.mappings || []).forEach((m) => { mappingByColor[(m.color || '').toLowerCase()] = m; });

    for (const shapeEntry of candidate.shapes) {
      const mapping = mappingByColor[shapeEntry.color];
      if (!mapping) continue;
      const symbol = semanticMapper.getSymbol(mapping.meaning, mapping.symbol);
      const rect = toPageRect(shapeEntry.shape.getBoundingClientRect());
      if (rect.width === 0 || rect.height === 0) continue;
      const size = Math.max(14, Math.min(24, Math.min(rect.width, rect.height)));
      const badgeRect = {
        left: rect.left + rect.width / 2 - size / 2,
        top: rect.top + rect.height / 2 - size / 2,
        width: size,
        height: size
      };
      overlayManager.addOverlay(badgeRect, symbol, `${mapping.meaning} (was ${shapeEntry.color})`);
      applied++;
    }
    return applied;
  }

  function applyImageBlobs(candidate, result, crop, blobs) {
    let applied = 0;
    const mappingByColor = {};
    (result.mappings || []).forEach((m) => { mappingByColor[(m.color || '').toLowerCase()] = m; });
    const dpr = window.devicePixelRatio || 1;

    for (const blob of blobs) {
      const mapping = mappingByColor[blob.color];
      if (!mapping) continue;
      const symbol = semanticMapper.getSymbol(mapping.meaning, mapping.symbol);
      const pageRect = {
        left: crop.rect.left + window.scrollX + blob.box.x / dpr,
        top: crop.rect.top + window.scrollY + blob.box.y / dpr,
        width: blob.box.width / dpr,
        height: blob.box.height / dpr
      };
      overlayManager.addOverlay(pageRect, symbol, `${mapping.meaning} (was ${blob.color})`);
      applied++;
    }
    return applied;
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
    const imageCandidates = imageProcessor.findCandidates().filter((c) => c.chartLike);
    const allCandidates = [...domCandidates, ...svgCandidates, ...imageCandidates];

    let screenshotDataUrl = null;
    if (imageCandidates.length > 0) {
      try {
        const resp = await chrome.runtime.sendMessage({ type: 'CAPTURE_TAB' });
        if (resp && resp.dataUrl) screenshotDataUrl = resp.dataUrl;
      } catch (e) {
        // Screenshot failure just disables image analysis for this run.
      }
    }

    let transformed = 0;
    let skippedLowConfidence = 0;
    let errors = 0;

    for (const candidate of allCandidates) {
      try {
        if (candidate.type === 'image') {
          if (!screenshotDataUrl) { skippedLowConfidence++; continue; }
          const crop = await imageProcessor.cropToElement(screenshotDataUrl, candidate.img);

          const signature = signatureFor(candidate);
          let result = analysisCache.get(signature);
          if (!result) {
            const imageBase64 = crop.canvas.toDataURL('image/png').split(',')[1];
            result = await callBackend({ visualType: 'raster_image', context: candidate.context, image: imageBase64 });
            analysisCache.set(signature, result);
          }

          const blobs = imageProcessor.detectBlobs(crop.ctx, crop.ctx.canvas.width, crop.ctx.canvas.height);
          const localColors = Array.from(new Set(blobs.map((b) => b.color)));
          if (!confidenceAllows(result, localColors)) { skippedLowConfidence++; continue; }

          const applied = applyImageBlobs(candidate, result, crop, blobs);
          if (applied > 0) transformed++;
          continue;
        }

        const signature = signatureFor(candidate);
        let result = analysisCache.get(signature);
        if (!result) {
          result = await callBackend(buildPayload(candidate));
          analysisCache.set(signature, result);
        }

        const localColors = candidate.context.colorsFound || [];
        if (!confidenceAllows(result, localColors)) { skippedLowConfidence++; continue; }

        const applied = candidate.type === 'dom' ? applyDomResult(candidate, result) : applySvgResult(candidate, result);
        if (applied > 0) transformed++;
      } catch (err) {
        errors++;
      }
    }

    return {
      status: 'ok',
      analyzed: allCandidates.length,
      transformed,
      skippedLowConfidence,
      errors,
      timestamp: Date.now()
    };
  }
})();
