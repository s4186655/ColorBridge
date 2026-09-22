// overlayManager.js  (HARDCODE PIPELINE — no AI involved)
//
// The only file that touches the live page's visual output. Never deletes or
// rewrites existing page content — only adds small, absolutely-positioned,
// non-interactive elements on top of it, all removable at once (used when the
// user turns the extension OFF, or before re-running analysis).
//
// Adds four overlay kinds on top of the AI-pipeline's single symbol badge:
//   addSymbolOverlay()          one glyph in a badge (Part B/C/F)
//   addStackedSymbolOverlay()   N copies of a glyph, N = 1-3 (Part D/E)
//   addArrowOverlay()           a drawn arrow whose length scales with rect height (Part A)
//   addLegendPanel()            a small "what we found" panel next to an image (Part D/E)
//
// clearAll() removes every element this module (or an earlier generation of
// it — the extension may re-inject content scripts) has ever tagged with
// data-ai-color-a11y, by querying the live DOM directly rather than only
// trusting its own in-memory `overlays` array. This is what guarantees that
// turning the extension OFF always removes 100% of what was drawn, even if
// some of it was added by a previous copy of this module.
//
// The AI-pipeline equivalent of this file is overlayManagerAI.js (unchanged).

window.AIColorA11y = window.AIColorA11y || {};

window.AIColorA11y.overlayManager = (function () {
  const OVERLAY_CLASS = 'ai-color-a11y-overlay';
  const ARROW_CLASS = 'ai-color-a11y-arrow-overlay';
  const LEGEND_CLASS = 'ai-color-a11y-legend';
  const MARKER_ATTR = 'data-ai-color-a11y';
  let overlays = [];
  let styleInjected = false;

  function injectStyle() {
    if (styleInjected || document.getElementById('ai-color-a11y-style')) {
      styleInjected = true;
      return;
    }
    const style = document.createElement('style');
    style.id = 'ai-color-a11y-style';
    style.textContent = `
      .${OVERLAY_CLASS} {
        position: absolute;
        pointer-events: none;
        z-index: 2147483000;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 1px;
        font-family: -apple-system, "Segoe UI", Arial, sans-serif;
        font-weight: 700;
        color: #111111;
        background: rgba(255, 255, 255, 0.9);
        border: 1.5px solid #111111;
        border-radius: 4px;
        line-height: 1;
        box-sizing: border-box;
        overflow: hidden;
      }
      .${ARROW_CLASS} {
        position: absolute;
        pointer-events: none;
        z-index: 2147483000;
        box-sizing: border-box;
      }
      .${ARROW_CLASS} svg { display: block; width: 100%; height: 100%; }
      .${LEGEND_CLASS} {
        position: absolute;
        pointer-events: none;
        z-index: 2147483000;
        font-family: -apple-system, "Segoe UI", Arial, sans-serif;
        background: rgba(255, 255, 255, 0.97);
        border: 1px solid #333333;
        border-radius: 6px;
        padding: 8px 10px;
        font-size: 12px;
        color: #111111;
        box-sizing: border-box;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
      }
      .${LEGEND_CLASS} .ai-legend-title { font-weight: 700; margin: 0 0 6px; }
      .${LEGEND_CLASS} .ai-legend-row { display: flex; align-items: center; gap: 6px; margin: 3px 0; }
      .${LEGEND_CLASS} .ai-legend-swatch { width: 12px; height: 12px; border-radius: 3px; flex-shrink: 0; border: 1px solid rgba(0,0,0,0.25); }
      .${LEGEND_CLASS} .ai-legend-note { margin: 6px 0 0; color: #444444; font-style: italic; }
    `;
    document.head.appendChild(style);
    styleInjected = true;
  }

  // rect: {left, top, width, height} in PAGE coordinates (already includes scroll offset).
  function addSymbolOverlay(rect, symbol, label) {
    injectStyle();
    const el = document.createElement('div');
    el.className = OVERLAY_CLASS;
    el.setAttribute(MARKER_ATTR, '1');
    el.textContent = symbol;
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', label || symbol);
    if (label) el.title = label;

    const size = Math.max(14, Math.min(28, Math.round(Math.min(rect.width, rect.height) || 18)));
    el.style.left = `${rect.left}px`;
    el.style.top = `${rect.top}px`;
    el.style.width = `${Math.max(rect.width, size)}px`;
    el.style.height = `${Math.max(rect.height, size)}px`;
    el.style.fontSize = `${size * 0.8}px`;

    document.body.appendChild(el);
    overlays.push(el);
    return el;
  }

  // Same as addSymbolOverlay but repeats `symbol` `count` times (1-3), used
  // for the darkness-based repeat count in Part D/E.
  //
  // If laying the symbols out in a ROW would need more width than the target
  // element actually has (rect.width), that row would spill out sideways and
  // cover whatever is next to it (the neighboring shirt/bar). In that case we
  // switch the container to a COLUMN instead, stacking the symbols downward
  // within the element's own width so they no longer bleed into neighbors.
  function addStackedSymbolOverlay(rect, symbol, count, label) {
    injectStyle();
    const safeCount = Math.max(1, Math.min(3, Math.round(count) || 1));
    const el = document.createElement('div');
    el.className = OVERLAY_CLASS;
    el.setAttribute(MARKER_ATTR, '1');
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', label || `${symbol} x${safeCount}`);
    if (label) el.title = `${label} (${safeCount}x)`;

    const size = Math.max(12, Math.min(22, Math.round(Math.min(rect.width, rect.height) || 16)));
    const gap = 2;
    const neededRowWidth = size * safeCount + gap * (safeCount - 1) + 4;
    const fitsAsRow = neededRowWidth <= rect.width || safeCount === 1;

    el.style.left = `${rect.left}px`;
    el.style.top = `${rect.top}px`;
    el.style.gap = `${gap}px`;
    el.style.flexDirection = fitsAsRow ? 'row' : 'column';

    if (fitsAsRow) {
      el.style.width = `${Math.max(rect.width, neededRowWidth)}px`;
      el.style.height = `${Math.max(rect.height, size)}px`;
    } else {
      const neededColHeight = size * safeCount + gap * (safeCount - 1) + 4;
      el.style.width = `${Math.max(rect.width, size)}px`;
      el.style.height = `${Math.max(rect.height, neededColHeight)}px`;
    }
    el.style.fontSize = `${size * 0.75}px`;

    for (let i = 0; i < safeCount; i++) {
      const span = document.createElement('span');
      span.textContent = symbol;
      el.appendChild(span);
    }

    document.body.appendChild(el);
    overlays.push(el);
    return el;
  }

  function buildArrowSvg(width, height, direction) {
    const midX = width / 2;
    const shaftTop = direction === 'up' ? height * 0.28 : 4;
    const shaftBottom = direction === 'up' ? height - 4 : height * 0.72;
    const tipY = direction === 'up' ? 2 : height - 2;
    const headBaseY = direction === 'up' ? height * 0.28 : height * 0.72;
    const headWidth = Math.max(6, width * 0.5);

    return `
      <svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
        <line x1="${midX}" y1="${shaftTop}" x2="${midX}" y2="${shaftBottom}" stroke="#111111" stroke-width="3" stroke-linecap="round"/>
        <polygon points="${midX - headWidth / 2},${headBaseY} ${midX + headWidth / 2},${headBaseY} ${midX},${tipY}" fill="#111111"/>
      </svg>
    `;
  }

  // Draws an up/down arrow whose length is rect.height — the caller (Part A's
  // candlestick handling) sets rect.height proportional to the candle's own
  // pixel height, so bigger candles get visibly longer arrows.
  function addArrowOverlay(rect, direction, label) {
    injectStyle();
    const el = document.createElement('div');
    el.className = ARROW_CLASS;
    el.setAttribute(MARKER_ATTR, '1');
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', label || (direction === 'up' ? 'increase' : 'decrease'));
    if (label) el.title = label;

    const width = Math.max(10, rect.width);
    const height = Math.max(16, rect.height);
    el.style.left = `${rect.left + rect.width / 2 - width / 2}px`;
    el.style.top = `${rect.top}px`;
    el.style.width = `${width}px`;
    el.style.height = `${height}px`;
    el.innerHTML = buildArrowSvg(width, height, direction);

    document.body.appendChild(el);
    overlays.push(el);
    return el;
  }

  // Small "what we found" panel placed next to an analyzed image (Part D/E),
  // built from the ACTUAL colors/counts detected in that image — not a
  // static table. Appears only when called from content.js's ANALYZE_PAGE
  // handler, i.e. only after the user clicks "Analyze this page".
  //
  // anchorRect: {left, top, width, height} in PAGE coordinates of the image
  // it explains. rows: [{ colorCss, text }]. note: one short closing line.
  function addLegendPanel(anchorRect, title, rows, note) {
    injectStyle();
    const PANEL_WIDTH = 200;
    const GAP = 10;

    const el = document.createElement('div');
    el.className = LEGEND_CLASS;
    el.setAttribute(MARKER_ATTR, '1');
    el.setAttribute('role', 'note');
    el.setAttribute('aria-label', title);
    el.style.width = `${PANEL_WIDTH}px`;

    const fitsToRight = anchorRect.left + anchorRect.width + GAP + PANEL_WIDTH <= window.scrollX + window.innerWidth;
    if (fitsToRight) {
      el.style.left = `${anchorRect.left + anchorRect.width + GAP}px`;
      el.style.top = `${anchorRect.top}px`;
    } else {
      // Not enough room beside it — stack below instead, same idea as the
      // row->column fallback in addStackedSymbolOverlay: never let it spill
      // over neighboring content.
      el.style.left = `${anchorRect.left}px`;
      el.style.top = `${anchorRect.top + anchorRect.height + GAP}px`;
    }

    const titleEl = document.createElement('p');
    titleEl.className = 'ai-legend-title';
    titleEl.textContent = title;
    el.appendChild(titleEl);

    rows.forEach((row) => {
      const rowEl = document.createElement('div');
      rowEl.className = 'ai-legend-row';
      const swatch = document.createElement('span');
      swatch.className = 'ai-legend-swatch';
      swatch.style.background = row.colorCss;
      const text = document.createElement('span');
      text.textContent = row.text;
      rowEl.appendChild(swatch);
      rowEl.appendChild(text);
      el.appendChild(rowEl);
    });

    if (note) {
      const noteEl = document.createElement('p');
      noteEl.className = 'ai-legend-note';
      noteEl.textContent = note;
      el.appendChild(noteEl);
    }

    document.body.appendChild(el);
    overlays.push(el);
    return el;
  }

  // Removes every overlay this pipeline has ever added. Queries the live DOM
  // by marker attribute (not just the in-memory `overlays` array) so this is
  // guaranteed to work even if the content script was re-injected in between
  // (which would otherwise leave an earlier generation's elements orphaned).
  function clearAll() {
    document.querySelectorAll(`[${MARKER_ATTR}]`).forEach((el) => el.remove());
    overlays = [];
  }

  function count() {
    return overlays.length;
  }

  return { addSymbolOverlay, addStackedSymbolOverlay, addArrowOverlay, addLegendPanel, clearAll, count };
})();
