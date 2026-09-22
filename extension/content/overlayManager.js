// overlayManager.js  (LOCAL VLM PIPELINE)
//
// The only file that draws on the host page. It never edits or removes the
// page's own content — it appends absolutely-positioned, non-interactive
// elements on top, every one of them tagged with data-ai-color-a11y.
//
// clearAll() removes them by querying the live DOM for that attribute rather
// than by walking an in-memory list. That difference matters: content scripts
// can be injected more than once, and a fresh copy of this module would have
// an empty list while the previous copy's overlays were still on the page.
// Sweeping the DOM makes "turn it off and everything goes" true regardless.
//
// The selection-mode chrome uses a DIFFERENT attribute (data-ai-color-a11y-ui)
// and lives in a shadow root, so the two never delete each other.
//
// Other pipelines: overlayManagerHardcode.js, overlayManagerAI.js.

window.AIColorA11y = window.AIColorA11y || {};

window.AIColorA11y.overlayManager = (function () {
  const OVERLAY_CLASS = 'ai-color-a11y-overlay';
  const ARROW_CLASS = 'ai-color-a11y-arrow';
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
    style.setAttribute(MARKER_ATTR, '1');
    style.textContent = `
      .${OVERLAY_CLASS} {
        position: absolute;
        pointer-events: none;
        z-index: 2147483000;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: -apple-system, "Segoe UI", Arial, sans-serif;
        font-weight: 700;
        color: #111111;
        background: rgba(255, 255, 255, 0.92);
        border: 1.5px solid #111111;
        border-radius: 4px;
        line-height: 1;
        box-sizing: border-box;
        overflow: hidden;
      }
      .${ARROW_CLASS} { position: absolute; pointer-events: none; z-index: 2147483000; box-sizing: border-box; }
      .${ARROW_CLASS} svg { display: block; width: 100%; height: 100%; }
      .${LEGEND_CLASS} {
        position: absolute;
        pointer-events: none;
        z-index: 2147483001;
        width: 250px;
        font-family: -apple-system, "Segoe UI", Arial, sans-serif;
        background: #ffffff;
        border: 1px solid #222222;
        border-radius: 8px;
        padding: 10px 12px;
        font-size: 12px;
        line-height: 1.45;
        color: #111111;
        box-sizing: border-box;
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);
      }
      .${LEGEND_CLASS} .ai-legend-title { font-weight: 700; margin: 0 0 6px; font-size: 12px; }
      .${LEGEND_CLASS} .ai-legend-row { display: flex; align-items: baseline; gap: 8px; margin: 5px 0; }
      .${LEGEND_CLASS} .ai-legend-symbol { font-size: 15px; font-weight: 700; min-width: 20px; text-align: center; }
      .${LEGEND_CLASS} .ai-legend-note { margin: 8px 0 0; padding-top: 7px; border-top: 1px solid #e2e2e2; color: #555555; font-style: italic; }
    `;
    document.head.appendChild(style);
    styleInjected = true;
  }

  function track(el) {
    el.setAttribute(MARKER_ATTR, '1');
    document.body.appendChild(el);
    overlays.push(el);
    return el;
  }

  // rect: {left, top, width, height} in PAGE coordinates (scroll already added).
  function addSymbolOverlay(rect, symbol, label) {
    injectStyle();
    const el = document.createElement('div');
    el.className = OVERLAY_CLASS;
    el.textContent = symbol;
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', label || symbol);
    if (label) el.title = label;

    const size = Math.max(15, Math.min(30, Math.round(Math.min(rect.width, rect.height) || 18)));
    el.style.left = `${rect.left}px`;
    el.style.top = `${rect.top}px`;
    el.style.width = `${Math.max(rect.width, size)}px`;
    el.style.height = `${Math.max(rect.height, size)}px`;
    el.style.fontSize = `${size * 0.78}px`;
    return track(el);
  }

  function buildArrowSvg(width, height, direction) {
    const midX = width / 2;
    const headWidth = Math.max(8, width * 0.55);
    const headBaseY = direction === 'up' ? height * 0.3 : height * 0.7;
    const tipY = direction === 'up' ? 2 : height - 2;
    const shaftFrom = direction === 'up' ? height - 3 : 3;
    return `
      <svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <line x1="${midX}" y1="${shaftFrom}" x2="${midX}" y2="${headBaseY}"
              stroke="#111111" stroke-width="3.5" stroke-linecap="round"/>
        <polygon points="${midX - headWidth / 2},${headBaseY} ${midX + headWidth / 2},${headBaseY} ${midX},${tipY}"
                 fill="#111111"/>
        <line x1="${midX}" y1="${shaftFrom}" x2="${midX}" y2="${headBaseY}"
              stroke="#ffffff" stroke-width="1" stroke-linecap="round" opacity="0.55"/>
      </svg>`;
  }

  // Draws an arrow as long as rect.height, so a taller bar/candle gets a
  // visibly longer arrow and magnitude survives the loss of colour.
  function addArrowOverlay(rect, direction, label) {
    injectStyle();
    const el = document.createElement('div');
    el.className = ARROW_CLASS;
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', label || (direction === 'up' ? 'increase' : 'decrease'));
    if (label) el.title = label;

    const width = Math.max(12, Math.min(rect.width, 46));
    const height = Math.max(20, rect.height);
    el.style.left = `${rect.left + rect.width / 2 - width / 2}px`;
    el.style.top = `${rect.top}px`;
    el.style.width = `${width}px`;
    el.style.height = `${height}px`;
    el.innerHTML = buildArrowSvg(width, height, direction);
    return track(el);
  }

  // The "what the model found" panel, shown beside the analysed element.
  // rows: [{ symbol, text }]
  function addLegendPanel(anchorRect, title, rows, note) {
    injectStyle();
    const PANEL_WIDTH = 250;
    const GAP = 12;

    const el = document.createElement('div');
    el.className = LEGEND_CLASS;
    el.setAttribute('role', 'note');
    el.setAttribute('aria-label', title);

    const fitsRight = anchorRect.left + anchorRect.width + GAP + PANEL_WIDTH <= window.scrollX + window.innerWidth;
    if (fitsRight) {
      el.style.left = `${anchorRect.left + anchorRect.width + GAP}px`;
      el.style.top = `${anchorRect.top}px`;
    } else {
      // No room beside it: drop below rather than spill over the neighbour.
      el.style.left = `${Math.max(0, Math.min(anchorRect.left, window.scrollX + window.innerWidth - PANEL_WIDTH - 8))}px`;
      el.style.top = `${anchorRect.top + anchorRect.height + GAP}px`;
    }

    const titleEl = document.createElement('p');
    titleEl.className = 'ai-legend-title';
    titleEl.textContent = title;
    el.appendChild(titleEl);

    rows.forEach((row) => {
      const rowEl = document.createElement('div');
      rowEl.className = 'ai-legend-row';
      const sym = document.createElement('span');
      sym.className = 'ai-legend-symbol';
      sym.textContent = row.symbol;
      const text = document.createElement('span');
      text.textContent = row.text;
      rowEl.append(sym, text);
      el.appendChild(rowEl);
    });

    if (note) {
      const noteEl = document.createElement('p');
      noteEl.className = 'ai-legend-note';
      noteEl.textContent = note;
      el.appendChild(noteEl);
    }
    return track(el);
  }

  function clearAll() {
    document.querySelectorAll(`[${MARKER_ATTR}]`).forEach((el) => el.remove());
    overlays = [];
    styleInjected = false;
  }

  function count() {
    return overlays.length;
  }

  return { addSymbolOverlay, addArrowOverlay, addLegendPanel, clearAll, count, MARKER_ATTR };
})();
