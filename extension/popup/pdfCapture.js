// pdfCapture.js
//
// The PDF flow: Chrome's built-in PDF viewer is a sandboxed extension page
// that no other extension's content script can reach (verified — this is a
// hard platform restriction, not a bug in this project), so none of the
// normal click-to-select machinery works there. This file replaces it with a
// self-contained flow that runs entirely inside the popup:
//
//   1. screenshot the tab (the one thing that DOES work on a PDF tab, since
//      chrome.tabs.captureVisibleTab needs no content script)
//   2. show that screenshot here and let the user drag a box over one chart
//   3. crop, detect colour regions, ask the local model — same pipeline the
//      page-based flow uses (colorDetector.js, imageProcessor.js, the same
//      ANALYZE_VISUAL backend call)
//   4. draw the answer directly onto the cropped image and list it as text,
//      since there is no page to draw an overlay on
//
// Reuses extension/content/colorDetector.js, imageProcessor.js,
// semanticMapper.js and usageTracker.js as-is (all included as <script> tags
// in popup.html) — a popup page has the same canvas/DOM APIs a content
// script does, so nothing about them needed to change.

window.PdfCapture = (function () {
  const { imageProcessor, semanticMapper, usageTracker } = window.AIColorA11y;

  const MIN_OVERALL_CONFIDENCE = 0.6;
  const MIN_MAPPING_CONFIDENCE = 0.5;
  const MAX_DISPLAY_WIDTH = 340;

  let fullImage = null; // the untouched full-resolution screenshot
  let displayScale = 1; // fullImage pixels -> pixels shown on screen
  let dragStart = null;
  let currentSelection = null; // {x, y, width, height} in FULL-RES pixels
  let statusCallback = () => {};

  const els = {};
  function cacheEls() {
    els.captureSection = document.getElementById('pdfCaptureSection');
    els.resultSection = document.getElementById('pdfResultSection');
    els.canvas = document.getElementById('pdfCanvas');
    els.selectionBox = document.getElementById('pdfSelectionBox');
    els.contextInput = document.getElementById('pdfContextInput');
    els.analyzeBtn = document.getElementById('pdfAnalyzeBtn');
    els.cancelBtn = document.getElementById('pdfCancelBtn');
    els.resultPreview = document.getElementById('pdfResultPreview');
    els.resultText = document.getElementById('pdfResultText');
    els.anotherBtn = document.getElementById('pdfAnotherBtn');
    els.doneBtn = document.getElementById('pdfDoneBtn');
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Could not load the screenshot.'));
      img.src = src;
    });
  }

  // Captures the tab and shows it scaled to fit the popup, ready for dragging.
  async function beginCapture(onStatus) {
    statusCallback = onStatus || (() => {});
    cacheEls();

    statusCallback('Capturing the page…', 'busy');
    const response = await chrome.runtime.sendMessage({ type: 'CAPTURE_TAB' });
    if (!response || !response.dataUrl) {
      throw new Error((response && response.error) || 'Could not capture this tab.');
    }

    fullImage = await loadImage(response.dataUrl);
    displayScale = Math.min(1, MAX_DISPLAY_WIDTH / fullImage.width);

    const canvas = els.canvas;
    canvas.width = Math.round(fullImage.width * displayScale);
    canvas.height = Math.round(fullImage.height * displayScale);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(fullImage, 0, 0, canvas.width, canvas.height);

    els.selectionBox.style.display = 'none';
    currentSelection = null;
    els.analyzeBtn.disabled = true;

    els.captureSection.hidden = false;
    els.resultSection.hidden = true;
    attachDragHandlers();
    statusCallback('Drag a box around the chart you want explained.', '');
  }

  function attachDragHandlers() {
    const wrap = els.canvas.parentElement;
    wrap.onpointerdown = onPointerDown;
    wrap.onpointermove = onPointerMove;
    wrap.onpointerup = onPointerUp;
  }

  function relativePos(event) {
    const rect = els.canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(rect.width, event.clientX - rect.left)),
      y: Math.max(0, Math.min(rect.height, event.clientY - rect.top))
    };
  }

  function onPointerDown(event) {
    dragStart = relativePos(event);
    els.selectionBox.style.display = 'block';
    updateSelectionBox(dragStart, dragStart);
  }

  function onPointerMove(event) {
    if (!dragStart) return;
    updateSelectionBox(dragStart, relativePos(event));
  }

  function onPointerUp(event) {
    if (!dragStart) return;
    const end = relativePos(event);
    updateSelectionBox(dragStart, end);

    const displayRect = boxFrom(dragStart, end);
    dragStart = null;

    // Convert from displayed pixels back to the full-resolution screenshot.
    currentSelection = {
      x: displayRect.left / displayScale,
      y: displayRect.top / displayScale,
      width: displayRect.width / displayScale,
      height: displayRect.height / displayScale
    };

    const tooSmall = displayRect.width < 12 || displayRect.height < 12;
    els.analyzeBtn.disabled = tooSmall;
    if (tooSmall) els.selectionBox.style.display = 'none';
  }

  function boxFrom(a, b) {
    return {
      left: Math.min(a.x, b.x),
      top: Math.min(a.y, b.y),
      width: Math.abs(a.x - b.x),
      height: Math.abs(a.y - b.y)
    };
  }

  function updateSelectionBox(a, b) {
    const box = boxFrom(a, b);
    Object.assign(els.selectionBox.style, {
      display: 'block',
      left: `${box.left}px`,
      top: `${box.top}px`,
      width: `${box.width}px`,
      height: `${box.height}px`
    });
  }

  function cropSelection() {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(currentSelection.width));
    canvas.height = Math.max(1, Math.round(currentSelection.height));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(
      fullImage,
      Math.round(currentSelection.x), Math.round(currentSelection.y),
      canvas.width, canvas.height,
      0, 0, canvas.width, canvas.height
    );
    return { canvas, ctx };
  }

  // One consistent "medium" size for every symbol on this crop, based on the
  // OVERALL image — not each individual coloured region. Sizing per-region
  // made symbols on a candlestick chart nearly invisible (~16px), because
  // each candle's own box is narrow; a wide chart with many thin bars should
  // still get readable symbols, not ones capped by its skinniest region.
  function mediumSymbolSize(canvasWidth, canvasHeight) {
    const scale = Math.min(canvasWidth, canvasHeight) / 10;
    return Math.max(26, Math.min(64, scale));
  }

  function drawSymbolOnCanvas(ctx, region, symbol, size) {
    const cx = region.box.x + region.box.width / 2;
    const cy = region.box.y + region.box.height / 2;

    ctx.save();
    ctx.font = `700 ${size}px -apple-system, Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = Math.max(3, size * 0.12);
    ctx.strokeStyle = '#ffffff';
    ctx.fillStyle = '#111111';
    ctx.strokeText(symbol, cx, cy);
    ctx.fillText(symbol, cx, cy);
    ctx.restore();
  }

  async function analyzeSelection(onStatus) {
    statusCallback = onStatus || statusCallback;

    if (!currentSelection) return;

    const quota = await usageTracker.checkQuota();
    if (!quota.allowed) {
      statusCallback(`Free limit reached (${quota.used}/${quota.limit}). Resets ${usageTracker.describeReset(quota.resetsInMs)}.`, 'error');
      return;
    }

    statusCallback('Analysing with the local model… this takes ~20s', 'busy');
    els.analyzeBtn.disabled = true;

    try {
      const { canvas, ctx } = cropSelection();
      const blobs = imageProcessor.detectBlobs(ctx, canvas.width, canvas.height);

      if (blobs.length === 0) {
        showResult(canvas, null, 'No red, green, yellow, orange or blue regions were found in that selection.', 'error');
        return;
      }

      const colorsFound = Array.from(new Set(blobs.map((b) => b.color)));
      const userContext = els.contextInput.value.trim();
      const context = {
        documentTitle: document.title,
        heading: '(from a PDF page — no page text could be read automatically)',
        nearbyText: userContext,
        legendText: userContext,
        visualKind: 'dom',
        colorsFound
      };

      const response = await chrome.runtime.sendMessage({
        type: 'ANALYZE_VISUAL',
        payload: { image: imageProcessor.toBase64(canvas), context }
      });

      if (!response || response.error) {
        const detail = response && response.hint ? ` ${response.hint}` : '';
        showResult(canvas, null, `${(response && response.error) || 'Analysis failed.'}${detail}`, 'error');
        return;
      }

      const analysis = response.data;
      await usageTracker.recordUse();

      if (!analysis.is_color_semantic) {
        showResult(canvas, null, analysis.rejected || 'Colour does not appear to carry meaning in that selection.', 'error');
        return;
      }
      if (analysis.confidence < MIN_OVERALL_CONFIDENCE) {
        showResult(canvas, null, 'Unable to confidently determine the meaning of the colours in that selection.', 'error');
        return;
      }

      const usable = analysis.mappings.filter((m) => m.confidence >= MIN_MAPPING_CONFIDENCE);
      const byColor = new Map();
      usable.forEach((m, index) => byColor.set(m.color, { ...m, symbol: semanticMapper.getSymbol(m.meaning, m.symbol, index) }));

      const symbolSize = mediumSymbolSize(canvas.width, canvas.height);
      let drawn = 0;
      for (const blob of blobs) {
        const mapping = byColor.get(blob.color);
        if (!mapping) continue;
        drawSymbolOnCanvas(ctx, blob, mapping.symbol, symbolSize);
        drawn++;
      }

      if (drawn === 0) {
        showResult(canvas, null, 'The model explained colours that could not be located in that selection.', 'error');
        return;
      }

      const lines = Array.from(byColor.values()).map((m) => `${m.symbol}  = ${m.meaning}`);
      showResult(canvas, lines, analysis.evidence ? `Based on: ${analysis.evidence}` : '', 'done');
    } catch (err) {
      statusCallback(`Could not analyse that: ${err.message}`, 'error');
      els.analyzeBtn.disabled = false;
    }
  }

  function showResult(canvas, lines, note, tone) {
    els.captureSection.hidden = true;
    els.resultSection.hidden = false;

    els.resultPreview.innerHTML = '';
    canvas.style.maxWidth = '100%';
    canvas.style.border = '1px solid #ccc';
    canvas.style.borderRadius = '6px';
    els.resultPreview.appendChild(canvas);

    els.resultText.innerHTML = '';
    if (lines && lines.length) {
      const ul = document.createElement('ul');
      ul.className = 'pdf-result-list';
      lines.forEach((line) => {
        const li = document.createElement('li');
        li.textContent = line;
        ul.appendChild(li);
      });
      els.resultText.appendChild(ul);
    }
    if (note) {
      const p = document.createElement('p');
      p.className = 'hint';
      p.textContent = note;
      els.resultText.appendChild(p);
    }

    statusCallback(tone === 'error' ? 'Nothing was changed.' : 'Done.', tone);
  }

  function reset() {
    fullImage = null;
    currentSelection = null;
    dragStart = null;
    if (els.captureSection) els.captureSection.hidden = true;
    if (els.resultSection) els.resultSection.hidden = true;
  }

  return { beginCapture, analyzeSelection, reset };
})();
